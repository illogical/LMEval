import { join } from 'path';
import {
  readJson, writeJson, ensureDir, listDir, generateId,
  MODEL_SELECTION_DIR, RECOMMENDATIONS_DIR, EVALUATIONS_DIR,
} from './FileService';
import { EvaluationService } from './EvaluationService';
import { CampaignValidationService, campaignPhaseInput } from './CampaignValidationService';
import { PromptService } from './PromptService';
import type { ModelSelectionCampaignInput, CampaignPhase, CampaignDraftFromEvaluationInput } from '../../src/types/eval';
import { ExecutionService } from './ExecutionService';
import { computeClassificationMetrics, computeTaggingMetrics, computeSummarizationMetrics } from './SummaryService';
import { PurposeTemplateService } from './PurposeTemplateService';
import { TestSuiteService } from './TestSuiteService';
import { JudgeQualificationService } from './JudgeQualificationService';
import { LatencyBudgetService } from './LatencyBudgetService';
import { tieGroupsByOverlappingCI, percentile, type TieGroupInput } from './StatisticsService';
import { DEFAULT_COMPRESSION_RANGE } from './summarizationChecks';
import type {
  ModelSelectionCampaign, ModelCandidateMeta, ModelRecommendation, ModelSelectionOrdering,
  EvaluationConfig, EvaluationSummary, EvalMatrixCell, TestCase, TaskMetrics, AssertionStrategy,
  ConfidenceInterval,
} from '../../src/types/eval';

export type Task = 'classification' | 'tagging' | 'summarization';

interface CreateCampaignInput {
  tasks: Task[];
  incumbentModelId: string;
  candidateSlate: ModelCandidateMeta[];
  promptIdsByTask: Record<string, string[]>;
  testSuiteIdByTask: Record<string, string>;
  totalVramBudgetGb?: number;
  judgeModelId?: string;
}

function campaignPath(id: string): string {
  return join(MODEL_SELECTION_DIR, id, 'campaign.json');
}

function recommendationPath(campaignId: string, task: Task): string {
  return join(RECOMMENDATIONS_DIR, `${campaignId}-${task}.json`);
}

/** Dispatches to the task-appropriate compute*Metrics function over an arbitrary cell subset (a prompt group in phase 1, a single model+prompt confirmation set in phase 3). Mirrors SummaryService's private computeTaskMetrics, but exposed here since ModelSelectionService groups by prompt, not by model. */
function computeGroupTaskMetrics(
  cells: EvalMatrixCell[],
  testCases: TestCase[],
  purposeCategory: Task,
  assertionStrategy: AssertionStrategy | null | undefined,
  runsPerCell: number,
  judgeQualified?: boolean
): TaskMetrics | undefined {
  const testCaseById = new Map(testCases.map(tc => [tc.id, tc]));
  if (purposeCategory === 'classification' && assertionStrategy?.type === 'exact-label') {
    return computeClassificationMetrics(cells, testCaseById, assertionStrategy.config.labels, runsPerCell);
  }
  if (purposeCategory === 'tagging' && assertionStrategy?.type === 'label-overlap') {
    return computeTaggingMetrics(cells, testCaseById, assertionStrategy.config.vocabulary);
  }
  if (purposeCategory === 'summarization' && assertionStrategy?.type === 'grounded-summary') {
    return computeSummarizationMetrics(
      cells, testCaseById,
      assertionStrategy.config.compressionRange ?? DEFAULT_COMPRESSION_RANGE,
      false,
      judgeQualified
    );
  }
  return undefined;
}

// Exported for InsightsIndexService, which needs the exact same primary-metric
// selection when indexing a run for the cross-run dashboard (single source of
// truth for "what counts as the headline metric per task type").
export function primaryMetricValue(tm: TaskMetrics): number {
  if (tm.taskType === 'classification') return tm.accuracy;
  if (tm.taskType === 'tagging') return tm.gateMetric === 'microRecall' ? tm.microRecall : tm.jaccardMean;
  return tm.medianRubric.weighted;
}

export function primaryMetricName(task: Task, metrics?: TaskMetrics): string {
  if (task === 'classification') return 'accuracy';
  if (task === 'tagging') return metrics?.taskType === 'tagging' && metrics.gateMetric === 'microRecall' ? 'microRecall' : 'jaccardMean';
  return 'weightedRubric';
}

export function primaryMetricCI(tm: TaskMetrics): ConfidenceInterval {
  const point = primaryMetricValue(tm);
  if (tm.taskType === 'classification') return tm.accuracyCI ?? { point, lower: point, upper: point };
  if (tm.taskType === 'tagging') return tm.jaccardCI ?? { point, lower: point, upper: point };
  return tm.weightedCI ?? { point, lower: point, upper: point };
}

function runToRunAgreementOf(tm: TaskMetrics): number | undefined {
  return tm.taskType === 'classification' ? tm.runToRunAgreement : undefined;
}

export function computeP95LatencyMs(cells: EvalMatrixCell[], modelId: string): number {
  const durations = cells
    .filter(c => c.modelId === modelId && c.status === 'completed' && c.durationMs != null)
    .map(c => c.durationMs as number)
    .sort((a, b) => a - b);
  return percentile(durations, 0.95);
}

function avgOutputTokensOf(cells: EvalMatrixCell[], modelId: string): number {
  const modelCells = cells.filter(c => c.modelId === modelId && c.status === 'completed');
  if (modelCells.length === 0) return 0;
  return modelCells.reduce((s, c) => s + (c.outputTokens ?? 0), 0) / modelCells.length;
}

function readEvalCells(evalId: string): EvalMatrixCell[] {
  return readJson<EvalMatrixCell[]>(join(EVALUATIONS_DIR, evalId, 'results.json')) ?? [];
}

function readEvalTestCases(evalId: string): TestCase[] {
  return readJson<TestCase[]>(join(EVALUATIONS_DIR, evalId, 'testcases.json')) ?? [];
}

function readEvalSummary(evalId: string): EvaluationSummary | null {
  return readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
}

function readEvalConfig(evalId: string): EvaluationConfig | null {
  return readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
}

async function runEvaluation(campaign: ModelSelectionCampaign, task: Task, phase: CampaignPhase, promptId?: string, modelId?: string): Promise<string> {
  if (ModelSelectionService.getCampaign(campaign.id)?.status === 'cancelled') throw new Error('Campaign cancelled');
  const input = campaign as ModelSelectionCampaign & ModelSelectionCampaignInput;
  const pin = promptId ? input.promptPinsByTask[task]?.find(p => p.promptId === promptId) : undefined;
  if (promptId && !pin) throw new Error('Winning prompt pin is missing');
  const { evaluation } = await EvaluationService.create(campaignPhaseInput(input, task, phase, pin, modelId), 'pending');
  if (ModelSelectionService.getCampaign(campaign.id)?.status === 'cancelled') {
    evaluation.status = 'cancelled'; writeJson(join(EVALUATIONS_DIR, evaluation.id, 'config.json'), evaluation);
    throw new Error('Campaign cancelled');
  }
  const map = phase === 'prompt-sweep' ? campaign.phase1EvalIds : phase === 'model-sweep' ? campaign.phase2EvalIds : campaign.phase3EvalIds;
  map[task] = evaluation.id;
  if (phase === 'confirmation') ((campaign.phase3AttemptEvalIds ??= {})[task] ??= []).push(evaluation.id);
  const now = new Date().toISOString();
  campaign.activeWork = { task, phase, evaluationId: evaluation.id, startedAt: now, updatedAt: now };
  ModelSelectionService.persist(campaign);
  await ExecutionService.run(evaluation.id);
  if (ModelSelectionService.getCampaign(campaign.id)?.status === 'cancelled') throw new Error('Campaign cancelled');
  campaign.activeWork = undefined;
  ModelSelectionService.persist(campaign);
  const final = EvaluationService.get(evaluation.id);
  const summary = readEvalSummary(evaluation.id);
  if (final?.status !== 'completed' || !summary || summary.failedCells > 0 || summary.completedCells !== summary.totalCells || summary.completedCells === 0) {
    throw new Error(`Phase ${phase} ended without complete successful execution. Inspect evaluation ${evaluation.id}; no winner inferred from partial evidence.`);
  }
  return evaluation.id;
}
const starting = new Set<string>();
export const ModelSelectionService = {
  async createDraftFromEvaluation(request: CampaignDraftFromEvaluationInput): Promise<ModelSelectionCampaign> {
    const evaluation = EvaluationService.get(request.evalId);
    if (!evaluation) throw Object.assign(new Error('Evaluation not found'), { status: 404 });
    const purpose = evaluation.purposeTemplateId ? PurposeTemplateService.get(evaluation.purposeTemplateId) : null;
    const task = purpose?.purposeCategory;
    if (!task || !['classification', 'tagging', 'summarization'].includes(task)) {
      throw Object.assign(new Error('Guided model selection requires a classification, tagging, or summarization purpose template'), { status: 400 });
    }
    if (!evaluation.testSuiteId) {
      throw Object.assign(new Error('Guided model selection requires a saved benchmark suite'), { status: 400 });
    }
    const pins = evaluation.promptVersions ?? evaluation.promptIds.map(promptId => ({
      promptId, version: PromptService.get(promptId)?.versions.at(-1)?.version ?? 0,
    }));
    const input: ModelSelectionCampaignInput = {
      tasks: [task as Task],
      incumbentModelId: request.incumbentModelId,
      candidateSlate: request.candidateSlate,
      promptPinsByTask: { [task]: pins },
      testSuiteIdByTask: { [task]: evaluation.testSuiteId },
      judgeModelId: task === 'summarization' ? evaluation.judgeModelId : undefined,
      totalVramBudgetGb: request.totalVramBudgetGb,
    };
    const campaign = await this.createDraft(input);
    if (evaluation.status === 'draft') {
      await EvaluationService.patchDraft(evaluation.id, { campaignId: campaign.id, campaignRole: 'supplemental' });
    }
    return campaign;
  },
  async createDraft(input: ModelSelectionCampaignInput): Promise<ModelSelectionCampaign> {
    const validation = await CampaignValidationService.validate(input);
    if (!validation.valid) throw Object.assign(new Error('Campaign configuration is invalid'), { status: 400, validation });
    const campaign = this.createCampaign({ ...input, promptIdsByTask: Object.fromEntries(Object.entries(input.promptPinsByTask).map(([t, pins]) => [t, pins.map(p => p.promptId)])) });
    campaign.status = 'draft'; campaign.promptPinsByTask = input.promptPinsByTask; this.persist(campaign); return campaign;
  },
  async patchDraft(id: string, input: ModelSelectionCampaignInput): Promise<ModelSelectionCampaign> {
    const existing = this.getCampaign(id);
    if (!existing) throw Object.assign(new Error('Campaign not found'), { status: 404 });
    if (existing.status !== 'draft' || starting.has(id)) throw Object.assign(new Error('Only idle drafts can be edited'), { status: 409 });
    starting.add(id);
    try {
      const validation = await CampaignValidationService.validate(input);
      if (!validation.valid) throw Object.assign(new Error('Campaign configuration is invalid'), { status: 400, validation });
      const campaign = { ...existing, tasks: input.tasks, incumbentModelId: input.incumbentModelId, candidateSlate: input.candidateSlate,
        promptPinsByTask: input.promptPinsByTask, testSuiteIdByTask: input.testSuiteIdByTask, judgeModelId: input.judgeModelId,
        totalVramBudgetGb: input.totalVramBudgetGb, acknowledgedWarningCodes: [],
        promptIdsByTask: Object.fromEntries(Object.entries(input.promptPinsByTask).map(([t, pins]) => [t, pins.map(p => p.promptId)])) };
      this.persist(campaign); return campaign;
    } finally { starting.delete(id); }
  },
  async startDraft(id: string, codes: string[] = []): Promise<ModelSelectionCampaign> {
    const campaign = this.getCampaign(id);
    if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
    if (campaign.status !== 'draft' || starting.has(id)) throw Object.assign(new Error('Campaign already started'), { status: 409 });
    starting.add(id);
    try {
      const validation = await CampaignValidationService.validate(campaign);
      if (!validation.valid || validation.issues.some(i => i.requiresAcknowledgement && !codes.includes(i.code)))
        throw Object.assign(new Error('Resolve errors and acknowledge current warnings before starting'), { status: 400, validation });
      campaign.acknowledgedWarningCodes = validation.issues.filter(i => i.severity === 'warning' && codes.includes(i.code)).map(i => i.code);
      campaign.status = 'pending'; this.persist(campaign); return campaign;
    } finally { starting.delete(id); }
  },
  interruptCampaigns(): void {
    for (const c of this.listCampaigns()) if (c.status === 'running' || c.status === 'pending') {
      c.status = 'failed'; c.error = 'Interrupted by host restart. Clone to a new draft to retry; partial phases were not resumed.'; this.persist(c);
    }
  },
  createCampaign(input: CreateCampaignInput): ModelSelectionCampaign {
    if (!input.incumbentModelId) throw new Error('incumbentModelId is required');
    if (!input.candidateSlate || input.candidateSlate.length === 0) throw new Error('candidateSlate must be non-empty');
    if (!input.tasks || input.tasks.length === 0) throw new Error('tasks must be non-empty');
    for (const task of input.tasks) {
      if (!input.promptIdsByTask[task]?.length) throw new Error(`promptIdsByTask is missing prompts for task "${task}"`);
      if (!input.testSuiteIdByTask[task]) throw new Error(`testSuiteIdByTask is missing a suite for task "${task}"`);
    }

    const now = new Date().toISOString();
    const campaign: ModelSelectionCampaign = {
      id: generateId('campaign'),
      status: 'pending',
      tasks: input.tasks,
      incumbentModelId: input.incumbentModelId,
      candidateSlate: input.candidateSlate,
      promptIdsByTask: input.promptIdsByTask,
      promptPinsByTask: Object.fromEntries(Object.entries(input.promptIdsByTask).map(([t, ids]) => [t, ids.map(promptId => ({ promptId, version: PromptService.get(promptId)?.versions.at(-1)?.version ?? 0 }))])),
      phase3AttemptEvalIds: {},
      testSuiteIdByTask: input.testSuiteIdByTask,
      totalVramBudgetGb: input.totalVramBudgetGb,
      judgeModelId: input.judgeModelId,
      phase1EvalIds: {},
      phase2EvalIds: {},
      phase3EvalIds: {},
      recommendations: {},
      createdAt: now,
      updatedAt: now,
    };
    this.persist(campaign);
    return campaign;
  },

  persist(campaign: ModelSelectionCampaign): void {
    campaign.updatedAt = new Date().toISOString();
    writeJson(campaignPath(campaign.id), campaign);
  },

  getCampaign(id: string): ModelSelectionCampaign | null {
    return readJson<ModelSelectionCampaign>(campaignPath(id));
  },

  listCampaigns(): ModelSelectionCampaign[] {
    ensureDir(MODEL_SELECTION_DIR);
    const campaigns: ModelSelectionCampaign[] = [];
    for (const id of listDir(MODEL_SELECTION_DIR)) {
      const c = readJson<ModelSelectionCampaign>(campaignPath(id));
      if (c) campaigns.push(c);
    }
    return campaigns.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async runPhase1(campaign: ModelSelectionCampaign, task: Task): Promise<{
    evalId: string; promotedPromptId: string; promotedPromptVersion: number; advisory: boolean;
  }> {
    const purposeTemplate = PurposeTemplateService.get(task);
    if (!purposeTemplate) throw new Error(`No built-in purpose template for task "${task}"`);

    const evalId = await runEvaluation(campaign, task, 'prompt-sweep');

    const cells = readEvalCells(evalId);
    const testCases = readEvalTestCases(evalId);
    const judgeQualified = task === 'summarization' && campaign.judgeModelId
      ? JudgeQualificationService.isQualified(campaign.judgeModelId)
      : undefined;

    const byPrompt = new Map<string, EvalMatrixCell[]>();
    for (const cell of cells) {
      const list = byPrompt.get(cell.promptId) ?? [];
      list.push(cell);
      byPrompt.set(cell.promptId, list);
    }

    const perPrompt: Array<{ promptId: string; promptVersion: number; metrics: TaskMetrics }> = [];
    for (const [promptId, promptCells] of byPrompt) {
      const metrics = computeGroupTaskMetrics(
        promptCells, testCases, task, purposeTemplate.assertionStrategy, 3, judgeQualified
      );
      if (metrics) {
        perPrompt.push({ promptId, promptVersion: promptCells[0]?.promptVersion ?? 1, metrics });
      }
    }
    if (perPrompt.length === 0) throw new Error(`Phase 1 produced no scoreable prompts for task "${task}"`);

    const gatePassing = perPrompt.filter(p => p.metrics.gate.verdict === 'pass');
    const pool = gatePassing.length > 0 ? gatePassing : perPrompt;
    const best = pool.reduce((a, b) => (primaryMetricValue(b.metrics) > primaryMetricValue(a.metrics) ? b : a));

    return {
      evalId,
      promotedPromptId: best.promptId,
      promotedPromptVersion: best.promptVersion,
      // Settled decision: a phase-1 gate miss still promotes the best-metric prompt, flagged advisory downstream.
      advisory: gatePassing.length === 0,
    };
  },

  async runPhase2(campaign: ModelSelectionCampaign, task: Task, promotedPromptId: string): Promise<{
    evalId: string; summary: EvaluationSummary; cells: EvalMatrixCell[];
  }> {
    const evalId = await runEvaluation(campaign, task, 'model-sweep', promotedPromptId);

    const summary = readEvalSummary(evalId);
    if (!summary) throw new Error(`Phase 2 eval ${evalId} produced no summary`);
    return { evalId, summary, cells: readEvalCells(evalId) };
  },

  async runPhase3(campaign: ModelSelectionCampaign, task: Task, modelId: string, promptId: string): Promise<{
    evalId: string; passed: boolean; reason?: string; taskMetrics?: TaskMetrics;
  }> {
    const purposeTemplate = PurposeTemplateService.get(task);
    if (!purposeTemplate) throw new Error(`No built-in purpose template for task "${task}"`);

    const evalId = await runEvaluation(campaign, task, 'confirmation', promptId, modelId);

    const cells = readEvalCells(evalId);
    const testCases = readEvalTestCases(evalId);
    const judgeQualified = task === 'summarization' && campaign.judgeModelId
      ? JudgeQualificationService.isQualified(campaign.judgeModelId)
      : undefined;
    const taskMetrics = computeGroupTaskMetrics(cells, testCases, task, purposeTemplate.assertionStrategy, 3, judgeQualified);
    if (!taskMetrics) return { evalId, passed: false, reason: 'confirmation run produced no scoreable metrics' };

    const passed = taskMetrics.gate.verdict === 'pass';
    return { evalId, passed, reason: passed ? undefined : taskMetrics.gate.failures.join('; '), taskMetrics };
  },

  /**
   * A9 selection rule, in order: gate -> quality (tie groups over overlapping
   * CIs) -> budget (p95 latency vs. the task's configured share, reordering
   * within a tie group only) -> stability (agreement, then output tokens).
   */
  selectModel(
    task: Task,
    summary: EvaluationSummary,
    cells: EvalMatrixCell[]
  ): ModelSelectionOrdering & { winner?: string; runnerUp?: string } {
    const perModel = summary.perModelTaskMetrics ?? {};
    const allModelIds = Object.keys(perModel);

    const discardedByGate: Array<{ modelId: string; reason: string }> = [];
    let survivors = allModelIds.filter(modelId => {
      const verdict = perModel[modelId].gate.verdict;
      if (verdict === 'fail') {
        discardedByGate.push({ modelId, reason: perModel[modelId].gate.failures.join('; ') || 'gate failed' });
        return false;
      }
      return true;
    });
    // If every candidate fails the gate, fall back to all of them rather than
    // producing a selection with no members — same spirit as phase 1's
    // gate-miss promotion, just at the model-selection step.
    if (survivors.length === 0) survivors = allModelIds;

    const p95LatencyMs: Record<string, number> = {};
    const primaryMetrics: NonNullable<ModelSelectionOrdering['primaryMetrics']> = {};
    const stability: ModelSelectionOrdering['stability'] = {};
    for (const modelId of allModelIds) {
      p95LatencyMs[modelId] = computeP95LatencyMs(cells, modelId);
      const ci = primaryMetricCI(perModel[modelId]);
      primaryMetrics[modelId] = { value: primaryMetricValue(perModel[modelId]), ci95: [ci.lower, ci.upper] };
      stability[modelId] = {
        runToRunAgreement: runToRunAgreementOf(perModel[modelId]),
        avgOutputTokens: avgOutputTokensOf(cells, modelId),
      };
    }

    const tieInputs: TieGroupInput[] = survivors.map(modelId => ({
      id: modelId,
      ci: primaryMetricCI(perModel[modelId]),
    }));
    const tieGroups = tieGroupsByOverlappingCI(tieInputs);

    const budgets = LatencyBudgetService.get();
    const budgetMs = budgets?.[task];
    let latencyBudgetNote: string | undefined;
    if (budgetMs == null) {
      latencyBudgetNote = `No latency budget configured for "${task}" — tie groups ordered by quality and stability only.`;
    }

    for (const group of tieGroups) {
      group.modelIds.sort((a, b) => {
        if (budgetMs != null) {
          const diff = p95LatencyMs[a] - p95LatencyMs[b];
          if (diff !== 0) return diff;
        }
        const agreeA = stability[a]?.runToRunAgreement ?? -1;
        const agreeB = stability[b]?.runToRunAgreement ?? -1;
        if (agreeA !== agreeB) return agreeB - agreeA;
        return (stability[a]?.avgOutputTokens ?? Infinity) - (stability[b]?.avgOutputTokens ?? Infinity);
      });
    }

    const winner = tieGroups[0]?.modelIds[0];
    const runnerUp = tieGroups[0]?.modelIds[1] ?? tieGroups[1]?.modelIds[0];

    return { tieGroups, discardedByGate, primaryMetrics, p95LatencyMs, stability, latencyBudgetNote, winner, runnerUp };
  },

  async runCampaign(campaignId: string): Promise<void> {
    const campaign = this.getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

    if (campaign.status !== 'pending') return;
    campaign.status = 'running';
    this.persist(campaign);

    try {
      for (const task of campaign.tasks) {
        const phase1 = await this.runPhase1(campaign, task);
        campaign.phase1EvalIds[task] = phase1.evalId;
        this.persist(campaign);

        const phase2 = await this.runPhase2(campaign, task, phase1.promotedPromptId);
        campaign.phase2EvalIds[task] = phase2.evalId;
        this.persist(campaign);

        const selection = this.selectModel(task, phase2.summary, phase2.cells);
        if (!selection.winner) throw new Error(`Phase 2 for task "${task}" produced no candidates to select from`);

        let winnerModelId = selection.winner;
        let confirmation = await this.runPhase3(campaign, task, winnerModelId, phase1.promotedPromptId);
        const confirmationAttempts = [{ evaluationId: confirmation.evalId, modelId: winnerModelId, passed: confirmation.passed, reason: confirmation.reason }];
        let fallbackReason: string | undefined;
        campaign.phase3EvalIds[task] = confirmation.evalId;

        if (!confirmation.passed && selection.runnerUp) {
          fallbackReason = `${winnerModelId} did not pass confirmation; the runner-up was evaluated.`;
          const runnerConfirmation = await this.runPhase3(campaign, task, selection.runnerUp, phase1.promotedPromptId);
          confirmationAttempts.push({ evaluationId: runnerConfirmation.evalId, modelId: selection.runnerUp, passed: runnerConfirmation.passed, reason: runnerConfirmation.reason });
          campaign.phase3EvalIds[task] = runnerConfirmation.evalId;
          if (runnerConfirmation.passed) {
            winnerModelId = selection.runnerUp;
          }
          confirmation = runnerConfirmation;
        }
        this.persist(campaign);

        const recommendation = this.buildRecommendation(campaign, task, {
          winnerModelId,
          runnerUpModelIds: selection.runnerUp && selection.runnerUp !== winnerModelId ? [selection.runnerUp] : [],
          ordering: selection,
          promptId: phase1.promotedPromptId,
          promptVersion: phase1.promotedPromptVersion,
          phase2EvalId: phase2.evalId,
          confirmation,
          confirmationAttempts,
          fallbackReason,
          advisory: phase1.advisory || !confirmation.passed,
        });

        campaign.recommendations[task] = recommendation;
        ensureDir(RECOMMENDATIONS_DIR);
        writeJson(recommendationPath(campaignId, task), recommendation);
        this.persist(campaign);
      }

      const best = this.computeBestSingleModel(campaign);
      campaign.bestSingleModel = best;
      campaign.crossServerFlag = this.computeCrossServerFlag(campaign);
      // vramBudgetExceeded is deliberately left unset: LMEval has no VRAM
      // footprint data for a declared candidate (parameterSize/quantization
      // are free text), and TASK.md is explicit that LMEval "structurally
      // cannot see" resident-model cost — faking a number here would violate
      // the "never a silent default" principle that governs the rest of A9.
      campaign.status = 'completed';
    } catch (err) {
      if (this.getCampaign(campaignId)?.status === 'cancelled') return;
      campaign.status = 'failed';
      campaign.error = (err as Error).message;
    }
    this.persist(campaign);
  },

  buildRecommendation(
    campaign: ModelSelectionCampaign,
    task: Task,
    args: {
      winnerModelId: string;
      runnerUpModelIds: string[];
      ordering: ModelSelectionOrdering;
      promptId: string;
      promptVersion: number;
      phase2EvalId: string;
      confirmation: { evalId: string; passed: boolean; reason?: string };
      confirmationAttempts?: Array<{ evaluationId: string; modelId: string; passed: boolean; reason?: string }>;
      fallbackReason?: string;
      advisory: boolean;
    }
  ): ModelRecommendation {
    const phase2Summary = readEvalSummary(args.phase2EvalId);
    const phase2Config = readEvalConfig(args.phase2EvalId);
    const winnerMetrics = phase2Summary?.perModelTaskMetrics?.[args.winnerModelId];
    const suite = TestSuiteService.get(campaign.testSuiteIdByTask[task]);

    const metricValue = winnerMetrics ? primaryMetricValue(winnerMetrics) : 0;
    const ci = winnerMetrics ? primaryMetricCI(winnerMetrics) : { point: 0, lower: 0, upper: 0 };

    return {
      task,
      recommendedModelId: args.winnerModelId,
      runnerUpModelIds: args.runnerUpModelIds,
      discardedByGate: args.ordering.discardedByGate,
      primaryMetric: { name: primaryMetricName(task, winnerMetrics), value: metricValue, ci95: [ci.lower, ci.upper] },
      p95LatencyMs: args.ordering.p95LatencyMs[args.winnerModelId] ?? 0,
      inference: {
        temperature: phase2Config?.resolvedInference?.temperature ?? 0.3,
        maxTokens: phase2Config?.resolvedInference?.maxTokens ?? 1000,
      },
      promptId: args.promptId,
      promptVersion: args.promptVersion,
      suiteId: campaign.testSuiteIdByTask[task],
      suiteVersion: suite?.version ?? 'unknown',
      provenance: {
        taxonomySha256: suite?.provenance?.taxonomySha256 ?? '',
        datasetSha256: suite?.provenance?.datasetSha256 ?? '',
        sourceRevision: suite?.provenance?.sourceRevision ?? '',
      },
      evaluationId: args.confirmation.evalId,
      judgeQualificationId: task === 'summarization' && campaign.judgeModelId ? campaign.judgeModelId : undefined,
      generatedAt: new Date().toISOString(),
      ordering: args.ordering,
      confirmation: { ranModelId: args.confirmationAttempts?.at(-1)?.modelId ?? args.winnerModelId, passed: args.confirmation.passed, reason: args.confirmation.reason },
      confirmationAttempts: args.confirmationAttempts,
      fallbackReason: args.fallbackReason,
      advisory: args.advisory || suite?.provenance?.reviewStatus !== 'approved' || winnerMetrics?.gate.verdict !== 'pass' || undefined,
    };
  },

  /**
   * "Best single model across all three tasks" per TASK.md A9: since LMEval
   * cannot see MemoryApi's per-model residency cost, this reports the
   * candidate that minimizes total quality distance from each task's own
   * winner (an implementation choice — the design left the exact tie-break
   * rule for this cross-task comparison open), restricted to models scored
   * in every task's phase 2.
   */
  computeBestSingleModel(campaign: ModelSelectionCampaign): { modelId: string; qualityDelta: Record<string, number> } | undefined {
    const perTaskValues: Record<string, Record<string, number>> = {};
    for (const task of campaign.tasks) {
      const evalId = campaign.phase2EvalIds[task];
      const summary = evalId ? readEvalSummary(evalId) : null;
      perTaskValues[task] = {};
      for (const [modelId, tm] of Object.entries(summary?.perModelTaskMetrics ?? {})) {
        perTaskValues[task][modelId] = primaryMetricValue(tm);
      }
    }

    const commonModelIds = campaign.candidateSlate
      .map(c => c.modelId)
      .filter(modelId => campaign.tasks.every(task => perTaskValues[task][modelId] != null));
    if (commonModelIds.length === 0) return undefined;

    let best: { modelId: string; totalDelta: number; qualityDelta: Record<string, number> } | null = null;
    for (const modelId of commonModelIds) {
      const qualityDelta: Record<string, number> = {};
      let totalDelta = 0;
      for (const task of campaign.tasks) {
        const values = Object.values(perTaskValues[task]);
        const winnerValue = values.length > 0 ? Math.max(...values) : 0;
        const delta = perTaskValues[task][modelId] - winnerValue;
        qualityDelta[task] = delta;
        totalDelta += Math.abs(delta);
      }
      if (!best || totalDelta < best.totalDelta) best = { modelId, totalDelta, qualityDelta };
    }
    return best ? { modelId: best.modelId, qualityDelta: best.qualityDelta } : undefined;
  },

  computeCrossServerFlag(campaign: ModelSelectionCampaign): boolean {
    const servers = new Set<string>();
    for (const task of campaign.tasks) {
      const rec = campaign.recommendations[task];
      if (!rec) continue;
      const meta = campaign.candidateSlate.find(c => c.modelId === rec.recommendedModelId);
      if (meta) servers.add(meta.lmapiServer);
    }
    const incumbentMeta = campaign.candidateSlate.find(c => c.modelId === campaign.incumbentModelId);
    if (incumbentMeta) servers.add(incumbentMeta.lmapiServer);
    return servers.size > 1;
  },

  /** Used by ReportService's model-selection report section to look up the recommendation produced from a given phase-3 confirmation evaluation. */
  findRecommendationByEvaluationId(evalId: string): ModelRecommendation | null {
    ensureDir(RECOMMENDATIONS_DIR);
    for (const file of listDir(RECOMMENDATIONS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const rec = readJson<ModelRecommendation>(join(RECOMMENDATIONS_DIR, file));
      if (rec?.evaluationId === evalId) return rec;
    }
    return null;
  },

  cancel(campaignId: string): boolean {
    const campaign = this.getCampaign(campaignId);
    if (!campaign) return false;
    if (!['pending', 'running'].includes(campaign.status)) return false;
    campaign.status = 'cancelled'; this.persist(campaign);
    if (campaign.activeWork) ExecutionService.cancel(campaign.activeWork.evaluationId);
    return true;
  },
};
