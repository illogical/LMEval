import { join } from 'node:path';
import { EVALUATIONS_DIR, readJson, writeJsonAtomic } from './FileService';
import { PromptService } from './PromptService';
import { TestSuiteService } from './TestSuiteService';
import { EvaluationPlanService } from './EvaluationPlanService';
import { EvaluationCheckpointService } from './EvaluationCheckpointService';
import { EvaluationAttemptService } from './EvaluationAttemptService';
import { EvaluationFailureService } from './EvaluationFailureService';
import { LmapiClient } from './LmapiClient';
import { artifactIdentityCheck, routeAvailabilityCheck } from './ServerQualifiedModelService';
import { JudgeQualificationService } from './JudgeQualificationService';
import type {
  CancellationResult, EvalMatrixCell, EvaluationAttempt, EvaluationConfig,
  EvaluationExecutionInputs, EvaluationRecoveryCheck, EvaluationSummary,
  EvaluationWorkItem, EvaluationWorkPlan, ResumeEvaluationResponse,
} from '../../src/types/eval';
import type { CellFilterTriple } from './ExecutionService';

const CONCURRENCY = Math.max(1, parseInt(process.env.EVAL_CONCURRENCY ?? '8', 10) || 8);
const controllers = new Map<string, AbortController>();
const cancellationRequested = new Set<string>();

function paths(evalId: string, appBasePath = '/') {
  const base = `/${appBasePath.split('/').filter(Boolean).join('/')}`;
  const prefix = base === '/' ? '' : base;
  return {
    config: `${prefix}/eval/config/${evalId}`,
    run: `${prefix}/eval/run/${evalId}`,
    results: `${prefix}/eval/results/${evalId}`,
    summary: `${prefix}/eval/summary/${evalId}`,
  };
}

export const DurableExecutionService = {
  activeIds(): string[] { return [...controllers.keys()]; },

  progress(evalId: string, plan: EvaluationWorkPlan, attemptId?: string): void {
    const scan = EvaluationCheckpointService.scan(evalId, plan);
    writeJsonAtomic(join(EVALUATIONS_DIR, evalId, 'progress.json'), {
      total: plan.items.length,
      completed: scan.checkpoints.filter(value => value.cell.status === 'completed').length,
      failed: scan.terminalFailed,
      observedCompleted: scan.committedIds.size,
      durablyCommitted: scan.committedIds.size,
      remaining: scan.remaining,
      attemptId,
      updatedAt: new Date().toISOString(),
    });
  },

  async prepare(evalId: string, cellFilter?: CellFilterTriple[]): Promise<{ config: EvaluationConfig; inputs: EvaluationExecutionInputs; plan: EvaluationWorkPlan; attempt: EvaluationAttempt }> {
    const evalDir = join(EVALUATIONS_DIR, evalId);
    const config = readJson<EvaluationConfig>(join(evalDir, 'config.json'));
    if (!config) throw Object.assign(new Error('Evaluation not found'), { code: 'EVALUATION_NOT_FOUND' });
    if (config.status !== 'pending') throw Object.assign(new Error(`Evaluation cannot start from ${config.status}`), { code: 'EVALUATION_ALREADY_STARTED' });
    const { ExecutionService, narrowForCellFilter, resolveInferenceAndProvenance } = await import('./ExecutionService');
    let testCases = ExecutionService.resolveTestCases(config);
    if (cellFilter?.length) {
      const narrowed = narrowForCellFilter(config.promptIds, config.modelIds, testCases, cellFilter);
      config.promptIds = narrowed.promptIds;
      config.modelIds = narrowed.modelIds;
      testCases = narrowed.testCases;
      config.runsPerCell = 1;
    }
    if (!testCases.length || !config.promptIds.length || !config.modelIds.length) throw new Error('No test cases, prompts, or models found for evaluation');
    const { TemplateService } = await import('./TemplateService');
    const { PurposeTemplateService } = await import('./PurposeTemplateService');
    const { JudgeQualificationService } = await import('./JudgeQualificationService');
    const template = config.templateId ? TemplateService.get(config.templateId) : null;
    const purposeTemplate = config.purposeTemplateId ? PurposeTemplateService.get(config.purposeTemplateId) : null;
    Object.assign(config, resolveInferenceAndProvenance(config, purposeTemplate));
    const prompts = config.promptIds.map(promptId => {
      const manifest = PromptService.get(promptId);
      if (!manifest) throw new Error(`Prompt not found: ${promptId}`);
      const version = config.promptVersions?.find(pin => pin.promptId === promptId)?.version ?? manifest.versions.at(-1)?.version ?? 1;
      const content = PromptService.getVersionContent(promptId, version);
      if (content == null) throw new Error(`Prompt version not found: ${promptId}@${version}`);
      return { manifest, version, content };
    });
    if (config.testSuiteId) {
      const suite = TestSuiteService.get(config.testSuiteId);
      if (suite?.builtIn && suite.provenance) {
        config.benchmarkMode ??= 'calibration';
        const promotion = config.benchmarkMode === 'promotion-check';
        config.benchmarkProvenance = {
          suiteId: suite.id, version: suite.version, datasetSha256: suite.provenance.datasetSha256,
          reviewStatus: suite.provenance.reviewStatus,
          includedSplits: promotion ? ['calibration', 'regression'] : ['calibration'],
          promptVersions: prompts.map(value => ({ promptId: value.manifest.id, version: value.version })),
          regressionExposedAt: promotion ? new Date().toISOString() : undefined,
        };
      }
    }
    const qualification = config.judgeModelId ? JudgeQualificationService.get(config.judgeModelId) ?? undefined : undefined;
    const planned = EvaluationPlanService.create({ config, prompts, testCases, template, purposeTemplate, judgeQualification: qualification });
    EvaluationPlanService.persist(evalId, planned.inputs, planned.plan);
    writeJsonAtomic(join(evalDir, 'testcases.json'), testCases);
    writeJsonAtomic(join(evalDir, 'cells.json'), planned.plan.items.map(item => ({
      id: item.cellId, evalId, promptId: item.promptId, promptVersion: item.promptVersion,
      modelId: item.model.canonicalId, testCaseId: item.testCaseId, run: item.repetition,
      status: 'pending', cellKey: item.cellKey,
    } satisfies EvalMatrixCell)));
    const attempt = EvaluationAttemptService.acquire(evalId, planned.plan);
    config.status = 'running';
    config.startedAt = new Date().toISOString();
    config.updatedAt = config.startedAt;
    writeJsonAtomic(join(evalDir, 'config.json'), config);
    this.progress(evalId, planned.plan, attempt.attemptId);
    return { config, ...planned, attempt };
  },

  async executeCell(evalId: string, config: EvaluationConfig, inputs: EvaluationExecutionInputs, plan: EvaluationWorkPlan, item: EvaluationWorkItem, attemptId: string, controller: AbortController): Promise<void> {
    const prompt = inputs.prompts.find(value => value.promptId === item.promptId && value.version === item.promptVersion);
    const testCase = inputs.testCases.find(value => value.id === item.testCaseId);
    if (!prompt || !testCase) throw Object.assign(new Error(`Immutable inputs missing for ${item.cellId}`), { code: 'EXECUTION_INPUT_MISMATCH' });
    const pending: EvalMatrixCell = {
      id: item.cellId, evalId, promptId: item.promptId, promptVersion: item.promptVersion,
      modelId: item.model.canonicalId, testCaseId: item.testCaseId, run: item.repetition,
      status: 'pending', cellKey: item.cellKey,
    };
    const singleConfig: EvaluationConfig = {
      ...config, promptIds: [item.promptId], modelIds: [item.model.canonicalId],
      promptVersions: [{ promptId: item.promptId, version: item.promptVersion }], runsPerCell: 1,
      judgeModelId: inputs.judge?.model.canonicalId, resolvedInference: inputs.resolvedInference,
    };
    const { ExecutionService } = await import('./ExecutionService');
    const result = await ExecutionService.runPromptfoo(
      evalId, singleConfig, [pending], [testCase], inputs.template, inputs.assertionStrategy,
      controller, Date.parse(config.startedAt ?? new Date().toISOString()),
      { promptContents: [{ promptId: prompt.promptId, content: prompt.content, tools: prompt.tools }], onObserved: () => {} }
    );
    if (result.length !== 1 || !['completed', 'failed'].includes(result[0].status)) {
      throw Object.assign(new Error(`Promptfoo did not return one terminal row for ${item.cellId}`), { code: 'PROMPTFOO_RESULT_UNMAPPABLE' });
    }
    EvaluationCheckpointService.commit(evalId, plan, item.cellId, result[0], attemptId);
    this.progress(evalId, plan, attemptId);
    EvaluationAttemptService.heartbeat(evalId, attemptId, plan);
  },

  async finalize(evalId: string, attemptId: string, config: EvaluationConfig, inputs: EvaluationExecutionInputs, plan: EvaluationWorkPlan): Promise<EvaluationSummary> {
    const scan = EvaluationCheckpointService.scan(evalId, plan);
    if (scan.errors.length || scan.remaining) throw Object.assign(new Error('Finalization requires one valid checkpoint per planned cell'), { code: 'FINALIZATION_INCOMPLETE' });
    const cells = EvaluationCheckpointService.orderedCells(plan, scan);
    const selfJudge = !!(inputs.purposeCategory === 'summarization' && inputs.judge && inputs.candidates.some(value => value.canonicalId === inputs.judge?.model.canonicalId));
    const { ExecutionService } = await import('./ExecutionService');
    const summary = await ExecutionService.aggregate(evalId, cells, undefined, {
      runsPerCell: inputs.runsPerCell,
      perspectiveOrder: inputs.template?.perspectives.map(value => value.name),
      resolvedInference: inputs.resolvedInference,
      transportProvenance: inputs.transportProvenance,
      testCases: inputs.testCases,
      purposeCategory: inputs.purposeCategory,
      assertionStrategy: inputs.assertionStrategy,
      selfJudgeGuardViolated: selfJudge,
      judgeQualified: inputs.judge?.qualificationSnapshot?.qualified,
      benchmarkProvenance: inputs.benchmarkProvenance,
      comparisonMode: inputs.comparisonMode,
      evaluationConfig: config,
    });
    EvaluationAttemptService.transition(evalId, attemptId, 'completed', plan);
    config.status = 'completed';
    config.updatedAt = new Date().toISOString();
    writeJsonAtomic(join(EVALUATIONS_DIR, evalId, 'config.json'), config);
    this.progress(evalId, plan, attemptId);
    return summary;
  },

  async execute(evalId: string, attemptId: string): Promise<void> {
    const loaded = EvaluationPlanService.load(evalId);
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    if (!loaded || !config) throw new Error(`Recovery artifacts missing for ${evalId}`);
    const controller = new AbortController();
    controllers.set(evalId, controller);
    const heartbeat = setInterval(() => {
      try { EvaluationAttemptService.heartbeat(evalId, attemptId, loaded.plan); } catch { controller.abort(); }
    }, 10_000);
    try {
      const scan = EvaluationCheckpointService.scan(evalId, loaded.plan);
      if (scan.errors.length) throw Object.assign(new Error('Checkpoint integrity validation failed'), { code: 'CHECKPOINT_CORRUPT' });
      const queue = loaded.plan.items.filter(item => !scan.committedIds.has(item.cellId));
      let cursor = 0;
      let fatal: unknown;
      const worker = async () => {
        while (!controller.signal.aborted && fatal == null) {
          const item = queue[cursor++];
          if (!item) return;
          try { await this.executeCell(evalId, config, loaded.inputs, loaded.plan, item, attemptId, controller); }
          catch (error) { fatal = error; controller.abort(); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      if (fatal) throw fatal;
      if (cancellationRequested.has(evalId) || controller.signal.aborted) throw new DOMException('Evaluation cancelled', 'AbortError');
      await this.finalize(evalId, attemptId, config, loaded.inputs, loaded.plan);
    } catch (error) {
      const cancelled = cancellationRequested.has(evalId) || (error instanceof Error && error.name === 'AbortError');
      cancellationRequested.delete(evalId);
      const failure = EvaluationFailureService.record({
        evaluationId: evalId, attemptId, stage: cancelled ? 'cancellation' : 'promptfoo', scope: 'run',
        code: cancelled ? 'EVALUATION_CANCELLED' : ((error as { code?: string }).code ?? 'EVALUATION_EXECUTION_FAILED'),
        message: (error as Error).message, errorClass: (error as Error).name, retriable: !cancelled, cancelled,
      });
      EvaluationFailureService.terminalSummary(evalId, failure);
      EvaluationAttemptService.transition(evalId, attemptId, cancelled ? 'cancelled' : 'failed', loaded.plan, failure.failureId);
      config.status = cancelled ? 'cancelled' : 'failed';
      config.updatedAt = new Date().toISOString();
      writeJsonAtomic(join(EVALUATIONS_DIR, evalId, 'config.json'), config);
    } finally {
      clearInterval(heartbeat);
      controllers.delete(evalId);
    }
  },

  async start(evalId: string, cellFilter?: CellFilterTriple[]): Promise<EvaluationAttempt> {
    const prepared = await this.prepare(evalId, cellFilter);
    void this.execute(evalId, prepared.attempt.attemptId).catch(error => console.error(`[DurableExecutionService] ${evalId}:`, error));
    return prepared.attempt;
  },

  async run(evalId: string, cellFilter?: CellFilterTriple[]): Promise<void> {
    const prepared = await this.prepare(evalId, cellFilter);
    await this.execute(evalId, prepared.attempt.attemptId);
  },

  cancel(evalId: string): CancellationResult | null {
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    if (!config) return null;
    const loaded = EvaluationPlanService.load(evalId);
    const scan = loaded ? EvaluationCheckpointService.scan(evalId, loaded.plan) : null;
    const state = EvaluationAttemptService.loadState(evalId);
    const controller = controllers.get(evalId);
    if (controller) {
      cancellationRequested.add(evalId);
      controller.abort();
      return { state: 'cancellation-requested', evaluationId: evalId, attemptId: state?.currentAttemptId, controllerOwned: true, durablyCommitted: scan?.committedIds.size ?? 0, remaining: scan?.remaining ?? 0 };
    }
    if (config.status === 'running') {
      config.status = 'interrupted';
      config.updatedAt = new Date().toISOString();
      writeJsonAtomic(join(EVALUATIONS_DIR, evalId, 'config.json'), config);
      return { state: 'reconciled-interrupted', evaluationId: evalId, attemptId: state?.currentAttemptId, controllerOwned: false, durablyCommitted: scan?.committedIds.size ?? 0, remaining: scan?.remaining ?? 0 };
    }
    return null;
  },

  async resume(evalId: string, appBasePath = '/'): Promise<ResumeEvaluationResponse> {
    const evalDir = join(EVALUATIONS_DIR, evalId);
    const config = readJson<EvaluationConfig>(join(evalDir, 'config.json'));
    if (!config) throw Object.assign(new Error('Evaluation not found'), { code: 'EVALUATION_NOT_FOUND', status: 404 });
    const loaded = EvaluationPlanService.load(evalId);
    if (!loaded) throw Object.assign(new Error('Legacy evaluation has no exact checkpoints; use Full rerun'), { code: 'EVALUATION_NOT_RESUMABLE', status: 409, reasonCode: 'LEGACY_NO_CHECKPOINTS' });
    const checks: EvaluationRecoveryCheck[] = EvaluationPlanService.validate(loaded.inputs, loaded.plan)
      .map(code => ({ code: code as EvaluationRecoveryCheck['code'], compatible: false, message: code }));
    if (config.status === 'completed') checks.push({ code: 'ALREADY_COMPLETE', compatible: false, message: 'Evaluation is already complete' });
    if (config.campaignContext?.role === 'protocol-phase') checks.push({ code: 'CAMPAIGN_MANAGED_RUN', compatible: false, message: 'Campaign protocol work is managed by its campaign' });
    const scan = EvaluationCheckpointService.scan(evalId, loaded.plan);
    if (scan.errors.some(error => error.code === 'CHECKPOINT_SCHEMA_UNSUPPORTED')) checks.push({ code: 'CHECKPOINT_SCHEMA_UNSUPPORTED', compatible: false, message: 'One or more checkpoints use a schema version this build cannot read' });
    if (scan.errors.some(error => error.code === 'CHECKPOINT_CORRUPT')) checks.push({ code: 'CHECKPOINT_CORRUPT', compatible: false, message: 'Checkpoint integrity failed' });
    if (scan.remaining === 0 && readJson<EvaluationSummary>(join(evalDir, 'summary.json'))) checks.push({ code: 'NO_UNFINISHED_WORK', compatible: false, message: 'No unfinished work remains' });
    if (!['interrupted', 'failed', 'cancelled'].includes(config.status)) checks.push({ code: 'ACTIVE_OWNER', compatible: false, message: `Status ${config.status} is not resumable` });
    if (scan.remaining > 0) {
      const snapshotJudgeId = loaded.inputs.judge?.model.canonicalId;
      if ((config.judgeModelId ?? undefined) !== snapshotJudgeId) {
        checks.push({ code: 'JUDGE_POLICY_MISMATCH', compatible: false, message: "The evaluation record's judge selection no longer matches its immutable snapshot" });
      }
      if (loaded.inputs.judge?.policy === 'qualified-required') {
        const status = JudgeQualificationService.status(loaded.inputs.judge.model.canonicalId);
        const snapshot = loaded.inputs.judge.qualificationSnapshot;
        const stale = !status.current || status.record?.qualified !== true
          || (!!snapshot && status.record?.calibrationSetHash !== snapshot.calibrationSetHash)
          || (!!snapshot && status.record?.settingsSha256 !== snapshot.settingsSha256);
        checks.push({
          code: 'JUDGE_QUALIFICATION_STALE', compatible: !stale,
          message: stale
            ? `Judge qualification for ${loaded.inputs.judge.model.canonicalId} is no longer valid for this run's qualified-required policy`
            : 'Judge qualification remains valid',
        });
      }
      try {
        const servers = await LmapiClient.getServers();
        for (const model of [...loaded.inputs.candidates, ...(loaded.inputs.judge ? [loaded.inputs.judge.model] : [])]) {
          checks.push(routeAvailabilityCheck(model, servers));
          checks.push(artifactIdentityCheck(model));
        }
      } catch (error) {
        checks.push({ code: 'MODEL_CATALOG_UNAVAILABLE', compatible: false, message: (error as Error).message });
      }
    }
    const failed = checks.filter(check => !check.compatible && !check.informational);
    if (failed.length) throw Object.assign(new Error('Evaluation resume preflight failed'), { code: failed.some(check => check.code === 'ACTIVE_OWNER') ? 'EVALUATION_ALREADY_RUNNING' : 'RESUME_INCOMPATIBLE', status: 409, checks });
    const previous = EvaluationAttemptService.loadState(evalId)?.lastAttemptId;
    const attempt = EvaluationAttemptService.acquire(evalId, loaded.plan, previous);
    config.status = 'running';
    config.updatedAt = new Date().toISOString();
    writeJsonAtomic(join(evalDir, 'config.json'), config);
    this.progress(evalId, loaded.plan, attempt.attemptId);
    void this.execute(evalId, attempt.attemptId).catch(error => console.error(`[DurableExecutionService] resume ${evalId}:`, error));
    return {
      evaluationId: evalId, attemptId: attempt.attemptId, resumedFromAttemptId: previous,
      mode: scan.remaining === 0 ? 'finalization-only' : 'execute-remaining',
      counts: { total: loaded.plan.items.length, reused: scan.committedIds.size, remaining: scan.remaining, inFlightLimit: CONCURRENCY },
      preflight: { compatible: true, checks }, browserPaths: paths(evalId, appBasePath),
    };
  },

  async dispose(): Promise<void> {
    for (const evalId of this.activeIds()) this.cancel(evalId);
    await Promise.resolve();
  },
};
