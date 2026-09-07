import { join } from 'path';
import { evaluate } from 'promptfoo';
import type { EvaluateResult } from 'promptfoo';
import {
  readJson, writeJson, generateId, EVALUATIONS_DIR,
} from './FileService';
import { PromptfooAdapter, type PromptContentEntry } from './PromptfooAdapter';
import { SummaryService } from './SummaryService';
import { PromptService } from './PromptService';
import { TestSuiteService } from './TestSuiteService';
import type {
  EvaluationConfig, EvalMatrixCell, EvaluationSummary, TestCase,
  EvalTemplate, PairwiseRanking, EvalStreamEvent, AssertionStrategy, EvalPurposeTemplate,
  PurposeCategory,
} from '../../src/types/eval';

// Promptfoo distinguishes an assertion miss (the model ran successfully) from
// an execution/provider error. Only the latter is a failed lifecycle cell.
export function isPromptfooExecutionFailure(failureReason: number): boolean {
  return failureReason === 2;
}

const CONCURRENCY_LIMIT = Math.max(1, parseInt(process.env.EVAL_CONCURRENCY ?? '8', 10) || 8);

/**
 * Resolution order: per-run config -> purpose template default -> none ("none" is
 * today's status quo: omit temperature/max_tokens entirely and let LMApi/the model's
 * own default apply). Exported standalone so the resolution logic is unit-testable
 * without mocking ExecutionService.run()'s promptfoo/FileService dependencies.
 */
export function resolveInferenceAndProvenance(
  config: EvaluationConfig,
  purposeTemplate: EvalPurposeTemplate | null
): Pick<EvaluationConfig, 'resolvedInference' | 'inferenceParametersUnspecified' | 'transportProvenance'> {
  let resolvedInference: EvaluationConfig['resolvedInference'];
  if (config.inference) {
    resolvedInference = { ...config.inference, source: 'config' };
  } else if (purposeTemplate?.inference) {
    resolvedInference = { ...purposeTemplate.inference, source: 'purposeTemplate' };
  }

  const serverPinnedCount = config.modelIds.filter(id => id.includes('::')).length;
  const endpointPaths: string[] = [];
  if (serverPinnedCount > 0) endpointPaths.push('/api/chat/completions/server');
  if (serverPinnedCount < config.modelIds.length) endpointPaths.push('/api/chat/completions/any');

  return {
    resolvedInference,
    inferenceParametersUnspecified: resolvedInference == null,
    // LMApi's ChatCompletionSchema added `seed` on 2026-09-04 (see
    // LMApi/docs/plans/2026-09-04-sampling-parameter-support.md) — Ollama's compat
    // endpoint already accepted it, so this is honored end-to-end as soon as it's sent.
    transportProvenance: { endpointPaths, messageShape: 'chat-messages', seedHonored: true },
  };
}

export type CellFilterTriple = { promptId: string; modelId: string; testCaseId: string };

/**
 * B2 cell-scoped retry: narrows a config's promptIds/modelIds and the
 * resolved test-case list down to exactly what a cellFilter's triples touch,
 * so the matrix promptfoo builds shrinks with the filter instead of the
 * `failedCellsOnly` bug this replaces (accepted but never implemented,
 * silently re-running the whole evaluation — see TASK.md B2). A scoped retry
 * is also always a single fresh attempt, not another run-to-run sample.
 * Pure and exported so it's unit-testable without mocking promptfoo/FileService.
 */
export function narrowForCellFilter(
  promptIds: string[],
  modelIds: string[],
  testCases: TestCase[],
  cellFilter: CellFilterTriple[]
): { promptIds: string[]; modelIds: string[]; testCases: TestCase[] } {
  const filterTestCaseIds = new Set(cellFilter.map(f => f.testCaseId));
  const filterPromptIds = new Set(cellFilter.map(f => f.promptId));
  const filterModelIds = new Set(cellFilter.map(f => f.modelId));
  return {
    promptIds: promptIds.filter(id => filterPromptIds.has(id)),
    modelIds: modelIds.filter(id => filterModelIds.has(id)),
    testCases: testCases.filter(tc => filterTestCaseIds.has(tc.id)),
  };
}

/**
 * Trims any residual combos a narrowed prompt/model/test-case cross product
 * still produces beyond the exact requested triples (e.g. 2 prompts x 2
 * models but only 2 of the 4 combos were actually requested) — a documented
 * tradeoff: a handful of extra graded cells in that edge case, never a
 * silent full re-run.
 */
export function filterCellsByAllowList(cells: EvalMatrixCell[], cellFilter: CellFilterTriple[]): EvalMatrixCell[] {
  const allow = new Set(cellFilter.map(f => `${f.promptId}::${f.modelId}::${f.testCaseId}`));
  return cells.filter(c => allow.has(`${c.promptId}::${c.modelId}::${c.testCaseId}`));
}

type BroadcastFn = (event: EvalStreamEvent) => void;

let broadcast: BroadcastFn = () => {};

export function setBroadcast(fn: BroadcastFn) {
  broadcast = fn;
}

const activeControllers = new Map<string, AbortController>();
const cancelledEvals = new Set<string>();

/**
 * Maps a promptfoo GradingResult (top-level or one of gradingResult.componentResults)
 * into our EvalMatrixCell.assertionResults entry shape.
 */
function toAssertionResult(gr: { pass: boolean; score: number; reason: string; assertion?: { type: string; weight?: number; metric?: string } }) {
  return {
    type: gr.assertion?.type ?? 'unknown',
    pass: gr.pass,
    score: gr.score,
    reason: gr.reason,
    metric: gr.assertion?.metric,
  };
}

/**
 * Rescales an llm-rubric assertion's promptfoo score (0.0-1.0) onto the 1-5 scale
 * the existing UI (scoreToColor, leaderboards) assumes, matching the old
 * JudgeService rubric's 1-5 scoring guide.
 */
function rescaleRubricScore(score01: number): number {
  return 1 + Math.max(0, Math.min(1, score01)) * 4;
}

function computeCompositeScore(assertionResults: ReturnType<typeof toAssertionResult>[]): number | undefined {
  const rubricResults = assertionResults.filter(a => a.type === 'llm-rubric' && a.score != null);
  if (rubricResults.length === 0) return undefined;
  // Weight is not preserved on the mapped assertionResult (only type/pass/score/reason/metric),
  // so component weights are recovered from the original template at the call site instead —
  // this fallback (unweighted average) only applies when that's unavailable.
  const total = rubricResults.reduce((s, r) => s + rescaleRubricScore(r.score!), 0);
  return total / rubricResults.length;
}

export const ExecutionService = {
  /** In-flight eval ids — lets the hosted adapter's getActiveWork() honor HomeBase's shutdown grace window. */
  getActiveEvalIds(): string[] {
    return [...activeControllers.keys()];
  },

  /** Resolves an EvaluationConfig's test cases (suite / inline / single userMessage), shared by run() and the /:id/testcases route. */
  resolveTestCases(config: EvaluationConfig): TestCase[] {
    if (config.testSuiteId) {
      const suite = TestSuiteService.get(config.testSuiteId);
      if (!suite) return [];
      if (!suite.builtIn || config.benchmarkMode === 'promotion-check') return suite.testCases;
      return suite.testCases.filter(testCase => testCase.caseTags?.includes('split:calibration'));
    }
    if (config.inlineTestCases && config.inlineTestCases.length > 0) {
      return config.inlineTestCases;
    }
    if (config.userMessage) {
      return [{ id: generateId('tc'), userMessage: config.userMessage }];
    }
    return [];
  },

  buildMatrix(config: EvaluationConfig, testCases: TestCase[]): EvalMatrixCell[] {
    const cells: EvalMatrixCell[] = [];
    const runsPerCell = config.runsPerCell ?? 1;

    for (const promptId of config.promptIds) {
      const prompt = PromptService.get(promptId);
      if (!prompt) continue;
      const promptVersion = config.promptVersions?.find(pin => pin.promptId === promptId)?.version
        ?? prompt.versions.at(-1)?.version ?? 1;

      for (const modelId of config.modelIds) {
        for (const testCase of testCases) {
          for (let run = 1; run <= runsPerCell; run++) {
            cells.push({
              id: generateId('cell'),
              evalId: config.id,
              promptId,
              promptVersion,
              modelId,
              testCaseId: testCase.id,
              run,
              status: 'pending',
            });
          }
        }
      }
    }
    return cells;
  },

  estimateCost(
    config: EvaluationConfig,
    testCases: TestCase[]
  ): { totalCells: number; estimatedMinutes: number } {
    const cells = this.buildMatrix(config, testCases);
    return {
      totalCells: cells.length,
      estimatedMinutes: Math.ceil(cells.length * 0.5),
    };
  },

  /**
   * Runs the matrix through promptfoo's evaluate(). Replaces the old
   * runCompletions()+runJudging() phases: promptfoo owns dispatch, retries
   * (via our custom LmapiClient-backed provider), and grading (deterministic
   * assertions + llm-rubric + select-best) in one pass.
   *
   * IMPORTANT known limitation (see docs/plans/2026-09-03-promptfoo-adoption-
   * and-purpose-templates.md, Phase 10 progressCallback note): promptfoo's
   * progressCallback fires per completed step but does NOT hand back that
   * step's response/grading — only cumulative totals (confirmed against the
   * installed 0.122.2 type definitions; RunEvalOptions is the step's input
   * config, not its result). So live per-cell data (response, latency,
   * assertionResults) is only available once evaluate() fully resolves and we
   * walk the final results array below — cell:completed events with real data
   * arrive in a burst near the end of the run rather than streamed throughout,
   * unlike the old hand-rolled Semaphore loop. eval:progress (completed count)
   * still ticks up live via progressCallback. A true incremental feed would
   * require promptfoo's file-based `afterEach` extension hook mechanism
   * (writes a temp JS module promptfoo requires() mid-run) — not implemented
   * here; flagged as follow-up work for real-time dashboard testing.
   */
  async runPromptfoo(
    evalId: string,
    config: EvaluationConfig,
    cells: EvalMatrixCell[],
    testCases: TestCase[],
    template: EvalTemplate | null,
    purposeStrategy: AssertionStrategy | null,
    controller: AbortController,
    startMs: number
  ): Promise<EvalMatrixCell[]> {
    const promptContents: PromptContentEntry[] = [];
    for (const promptId of config.promptIds) {
      const prompt = PromptService.get(promptId);
      if (!prompt) continue;
      const version = config.promptVersions?.find(pin => pin.promptId === promptId)?.version
        ?? prompt.versions.at(-1)?.version ?? 1;
      const content = PromptService.getVersionContent(promptId, version) ?? '';
      promptContents.push({ promptId, content, tools: prompt.tools });
    }

    const { testSuite, promptOrder, testCaseOrder } = PromptfooAdapter.buildTestSuite({
      evalId, config, promptContents, testCases, template, purposeStrategy,
    });

    let completedSoFar = 0;
    const totalSteps = cells.length;

    const evalRecord = await evaluate(testSuite, {
      maxConcurrency: CONCURRENCY_LIMIT,
      cache: false,
      abortSignal: controller.signal,
      progressCallback: () => {
        completedSoFar++;
        writeJson(join(EVALUATIONS_DIR, evalId, 'progress.json'), {
          total: totalSteps,
          completed: Math.min(completedSoFar, totalSteps),
          failed: 0,
          updatedAt: new Date().toISOString(),
        });
        broadcast({
          type: 'eval:progress',
          evalId,
          data: {
            phase: 2,
            totalPhases: 2,
            completedCells: Math.min(completedSoFar, totalSteps),
            totalCells: totalSteps,
            elapsedMs: Date.now() - startMs,
          },
          timestamp: Date.now(),
        });
      },
    });

    const summary = await evalRecord.toEvaluateSummary();
    const results = summary.results as EvaluateResult[];

    // Group pending cell ids by (promptId, modelId, testCaseId), preserving
    // buildMatrix()'s run-ascending order so repeats consume in sequence.
    const pendingByKey = new Map<string, string[]>();
    for (const cell of cells) {
      const key = `${cell.promptId}::${cell.modelId}::${cell.testCaseId}`;
      const arr = pendingByKey.get(key) ?? [];
      arr.push(cell.id);
      pendingByKey.set(key, arr);
    }

    const cellById = new Map(cells.map(c => [c.id, c]));

    for (const result of results) {
      // Promptfoo's promptIdx indexes rendered prompt/provider combinations,
      // not just LMEval prompt manifests. Resolve by the actual prompt text;
      // retain the positional lookup for older/single-provider summaries.
      const promptId = promptContents.find(entry => entry.content === result.prompt?.raw)?.promptId
        ?? promptOrder[result.promptIdx];
      const testCaseId = testCaseOrder[result.testIdx];
      const responseMetadata = result.response?.metadata as
        | { modelId?: string; retryAttempts?: EvalMatrixCell['retryAttempts']; serverName?: string; durationMs?: number; finishReason?: string }
        | undefined;
      // Promptfoo may report the first provider's id/label for every row when
      // function-valued in-process providers are used. The provider itself
      // persists its exact model identity with the response, so prefer that.
      const modelId = [responseMetadata?.modelId, result.provider?.label, result.provider?.id]
        .map(value => String(value ?? ''))
        .find(value => config.modelIds.includes(value));
      if (!promptId || !testCaseId || !modelId) {
        throw new Error(`Could not map Promptfoo result: ${JSON.stringify({
          promptIdx: result.promptIdx, testIdx: result.testIdx,
          provider: result.provider, prompt: result.prompt, responseMetadata,
        })}`);
      }

      const key = `${promptId}::${modelId}::${testCaseId}`;
      const queue = pendingByKey.get(key);
      const cellId = queue?.shift();
      if (!cellId) continue;

      const existing = cellById.get(cellId);
      if (!existing) continue;

      const gradingResult = result.gradingResult;
      const componentResults = gradingResult?.componentResults ?? (gradingResult ? [gradingResult] : []);
      const assertionResults = componentResults.map(toAssertionResult);

      const rubricPerspectiveWeights = template
        ? new Map(template.perspectives.map(p => [p.name, p.weight]))
        : null;
      let compositeScore = computeCompositeScore(assertionResults);
      if (rubricPerspectiveWeights) {
        const rubricEntries = assertionResults.filter(a => a.type === 'llm-rubric' && a.score != null);
        let weightedSum = 0;
        let totalWeight = 0;
        for (const entry of rubricEntries) {
          const weight = entry.metric ? (rubricPerspectiveWeights.get(entry.metric) ?? 1) : 1;
          weightedSum += rescaleRubricScore(entry.score!) * weight;
          totalWeight += weight;
        }
        if (totalWeight > 0) compositeScore = weightedSum / totalWeight;
      }

      const outputTokens = result.tokenUsage?.completion;
      const durationMs = responseMetadata?.durationMs ?? result.latencyMs;

      const responseOutput = result.response?.output;
      const responseText = typeof responseOutput === 'string' ? responseOutput : JSON.stringify(responseOutput ?? '');

      const executionFailed = isPromptfooExecutionFailure(result.failureReason);
      cellById.set(cellId, {
        ...existing,
        status: executionFailed ? 'failed' : 'completed',
        request: {
          systemPrompt: promptContents.find(p => p.promptId === promptId)?.content ?? '',
          userMessage: String((result.vars as Record<string, unknown> | undefined)?.userMessage ?? ''),
          model: modelId,
        },
        response: responseText,
        finishReason: responseMetadata?.finishReason,
        inputTokens: result.tokenUsage?.prompt,
        outputTokens,
        durationMs,
        tokensPerSecond: outputTokens && durationMs > 0 ? Math.round((outputTokens / durationMs) * 1000) : undefined,
        serverName: responseMetadata?.serverName,
        assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
        compositeScore,
        error: executionFailed ? result.error ?? 'Model execution failed' : undefined,
        retryAttempts: responseMetadata?.retryAttempts?.length ? responseMetadata.retryAttempts : undefined,
      });

      broadcast({ type: 'cell:started', evalId, data: { cellId }, timestamp: Date.now() });
      if (executionFailed) {
        broadcast({ type: 'cell:failed', evalId, data: { cellId, error: result.error }, timestamp: Date.now() });
      } else {
        broadcast({
          type: 'cell:completed',
          evalId,
          data: { cellId, modelId, durationMs, inputTokens: result.tokenUsage?.prompt, outputTokens },
          timestamp: Date.now(),
        });
      }
    }

    return [...cellById.values()];
  },

  buildPairwiseRankings(cells: EvalMatrixCell[]): PairwiseRanking[] {
    // select-best assertions grade all outputs for a test case together (not
    // pairwise A/B), so we synthesize PairwiseRanking entries from each
    // completed cell's select-best assertionResult for UI compatibility —
    // every cell in a test-case group gets a ranking against the group's
    // winner rather than every unique pair getting its own judged comparison
    // (a real behavior change from the old JudgeService pairwise flow, traded
    // for eliminating ~130 lines of hand-rolled pairwise prompt/parse code —
    // see plan doc's Phase 10 open-question #2 resolution).
    const rankings: PairwiseRanking[] = [];
    const byTestCase = new Map<string, EvalMatrixCell[]>();
    for (const cell of cells) {
      if (cell.status !== 'completed') continue;
      const list = byTestCase.get(cell.testCaseId) ?? [];
      list.push(cell);
      byTestCase.set(cell.testCaseId, list);
    }
    for (const [, groupCells] of byTestCase) {
      const withPairwise = groupCells.filter(c => c.assertionResults?.some(a => a.type === 'select-best'));
      if (withPairwise.length < 2) continue;
      const winner = withPairwise.find(c => c.assertionResults?.find(a => a.type === 'select-best')?.pass);
      if (!winner) continue;
      for (const cell of withPairwise) {
        if (cell.id === winner.id) continue;
        rankings.push({
          cellIdA: winner.id,
          cellIdB: cell.id,
          winner: 'A',
          justification: winner.assertionResults?.find(a => a.type === 'select-best')?.reason ?? '',
        });
      }
    }
    return rankings;
  },

  async aggregate(
    evalId: string,
    cells: EvalMatrixCell[],
    pairwiseRankings?: PairwiseRanking[],
    options?: {
      runsPerCell?: number;
      perspectiveOrder?: string[];
      resolvedInference?: EvaluationConfig['resolvedInference'];
      transportProvenance?: EvaluationConfig['transportProvenance'];
      testCases?: TestCase[];
      purposeCategory?: PurposeCategory;
      assertionStrategy?: AssertionStrategy | null;
      selfJudgeGuardViolated?: boolean;
      judgeQualified?: boolean;
      benchmarkProvenance?: EvaluationConfig['benchmarkProvenance'];
      comparisonMode?: EvaluationConfig['comparisonMode'];
    }
  ): Promise<EvaluationSummary> {
    const summary = SummaryService.computeSummary(evalId, cells, pairwiseRankings, options);
    const evalDir = join(EVALUATIONS_DIR, evalId);
    writeJson(join(evalDir, 'results.json'), cells);
    writeJson(join(evalDir, 'summary.json'), summary);
    return summary;
  },

  cancel(evalId: string): boolean {
    cancelledEvals.add(evalId);
    const controller = activeControllers.get(evalId);
    if (!controller) return false;
    controller.abort();
    activeControllers.delete(evalId);
    return true;
  },

  async run(
    evalId: string,
    options?: { cellFilter?: CellFilterTriple[] }
  ): Promise<void> {
    const evalDir = join(EVALUATIONS_DIR, evalId);
    const config = readJson<EvaluationConfig>(join(evalDir, 'config.json'));
    if (!config) {
      console.error(`[ExecutionService] No config found for eval ${evalId}`);
      return;
    }
    if (config.status !== 'pending' || activeControllers.has(evalId)) {
      console.error(`[ExecutionService] Refusing to start ${evalId} from status ${config.status}`);
      return;
    }

    const controller = new AbortController();
    activeControllers.set(evalId, controller);
    const startMs = Date.now();

    config.status = 'running';
    config.startedAt = new Date(startMs).toISOString();
    config.updatedAt = new Date().toISOString();
    writeJson(join(evalDir, 'config.json'), config);

    try {
      let testCases = this.resolveTestCases(config);

      if (options?.cellFilter && options.cellFilter.length > 0) {
        const narrowed = narrowForCellFilter(config.promptIds, config.modelIds, testCases, options.cellFilter);
        config.promptIds = narrowed.promptIds;
        config.modelIds = narrowed.modelIds;
        testCases = narrowed.testCases;
        // A scoped retry is a single fresh attempt, not another run-to-run
        // agreement sample.
        config.runsPerCell = 1;
      }

      if (testCases.length === 0 || config.promptIds.length === 0 || config.modelIds.length === 0) {
        throw new Error(
          options?.cellFilter?.length
            ? 'No matching cells found to retry'
            : 'No test cases found for evaluation'
        );
      }

      // Persisted so /:id/testcases can label rows with the real user message
      // later — resolveTestCases() alone isn't safe to re-call for that because
      // the userMessage quick-mode branch mints a fresh id each call.
      writeJson(join(evalDir, 'testcases.json'), testCases);

      let template: EvalTemplate | null = null;
      let purposeStrategy: AssertionStrategy | null = null;
      let purposeTemplate: EvalPurposeTemplate | null = null;
      if (config.templateId) {
        const { TemplateService } = await import('./TemplateService');
        template = TemplateService.get(config.templateId);
      }
      if (config.purposeTemplateId) {
        const { PurposeTemplateService } = await import('./PurposeTemplateService');
        purposeTemplate = PurposeTemplateService.get(config.purposeTemplateId);
        purposeStrategy = purposeTemplate?.assertionStrategy ?? null;
      }

      // A7: classification/tagging gates need repeated runs to compute
      // run-to-run agreement and bootstrap CIs — default to production's
      // t=0.3 / 3 runs when a built-in purpose template left both unset,
      // rather than silently forfeiting those metrics at runsPerCell=1.
      const category = purposeTemplate?.purposeCategory;
      if ((category === 'classification' || category === 'tagging')
        && config.runsPerCell == null && config.inference == null) {
        config.runsPerCell = 3;
        config.inference = { temperature: 0.3, maxTokens: 1000 };
      }

      let cells = this.buildMatrix(config, testCases);
      if (options?.cellFilter && options.cellFilter.length > 0) {
        cells = filterCellsByAllowList(cells, options.cellFilter);
      }
      if (config.testSuiteId) {
        const suite = TestSuiteService.get(config.testSuiteId);
        if (suite?.builtIn && suite.provenance) {
          config.benchmarkMode ??= 'calibration';
          const promotionCheck = config.benchmarkMode === 'promotion-check';
          config.benchmarkProvenance = {
            suiteId: suite.id,
            version: suite.version,
            datasetSha256: suite.provenance.datasetSha256,
            reviewStatus: suite.provenance.reviewStatus,
            includedSplits: promotionCheck ? ['calibration', 'regression'] : ['calibration'],
            promptVersions: [...new Map(cells.map(cell => [cell.promptId, cell.promptVersion])).entries()]
              .map(([promptId, version]) => ({ promptId, version })),
            regressionExposedAt: promotionCheck ? new Date().toISOString() : undefined,
          };
        }
      }
      writeJson(join(evalDir, 'cells.json'), cells);
      writeJson(join(evalDir, 'progress.json'), {
        total: cells.length,
        completed: 0,
        failed: 0,
        updatedAt: new Date().toISOString(),
      });

      Object.assign(config, resolveInferenceAndProvenance(config, purposeTemplate));
      writeJson(join(evalDir, 'config.json'), config);

      const finalCells = await this.runPromptfoo(
        evalId, config, cells, testCases, template, purposeStrategy, controller, startMs
      );

      const pairwiseRankings = config.enablePairwise
        ? this.buildPairwiseRankings(finalCells)
        : undefined;

      // R6 self-judge guard: a model may never judge its own summarization output.
      const selfJudgeGuardViolated = !!(
        purposeTemplate?.purposeCategory === 'summarization' &&
        config.judgeModelId &&
        config.modelIds.includes(config.judgeModelId)
      );

      // A8: a summarization gate can only pass outright when its judge model
      // has been qualified against a calibration set — otherwise the result
      // stays advisory regardless of score.
      let judgeQualified: boolean | undefined;
      if (purposeTemplate?.purposeCategory === 'summarization' && config.judgeModelId) {
        const { JudgeQualificationService } = await import('./JudgeQualificationService');
        judgeQualified = JudgeQualificationService.get(config.judgeModelId)?.qualified;
      }

      await this.aggregate(evalId, finalCells, pairwiseRankings, {
        runsPerCell: config.runsPerCell,
        perspectiveOrder: template?.perspectives.map(p => p.name),
        resolvedInference: config.resolvedInference,
        transportProvenance: config.transportProvenance,
        testCases,
        purposeCategory: purposeTemplate?.purposeCategory,
        assertionStrategy: purposeStrategy,
        selfJudgeGuardViolated,
        judgeQualified,
        benchmarkProvenance: config.benchmarkProvenance,
        comparisonMode: config.comparisonMode,
      });
      writeJson(join(evalDir, 'progress.json'), {
        total: finalCells.length,
        completed: finalCells.filter(cell => cell.status === 'completed').length,
        failed: finalCells.filter(cell => cell.status === 'failed').length,
        updatedAt: new Date().toISOString(),
      });

      const wasCancelled = cancelledEvals.has(evalId);
      cancelledEvals.delete(evalId);
      config.status = wasCancelled ? 'cancelled' : 'completed';
      config.updatedAt = new Date().toISOString();
      writeJson(join(evalDir, 'config.json'), config);

      broadcast({ type: wasCancelled ? 'eval:cancelled' : 'eval:completed', evalId, data: {}, timestamp: Date.now() });

      if (config.sessionId) {
        try {
          const { SessionService } = await import('./SessionService');
          const runs = SessionService.listEvalRuns(config.sessionId);
          const run = runs.find(r => r.evalId === evalId);
          if (run) {
            const summary = readJson<EvaluationSummary>(join(evalDir, 'summary.json'));
            const promptSummaries = summary?.promptSummaries ?? [];
            const scoreSummary = {
              totalCells: summary?.totalCells ?? 0,
              completedCells: summary?.completedCells ?? 0,
              failedCells: summary?.failedCells ?? 0,
              promptAScore: promptSummaries[0]?.avgCompositeScore,
              promptBScore: promptSummaries[1]?.avgCompositeScore,
              scoreDelta:
                promptSummaries[1]?.avgCompositeScore != null &&
                promptSummaries[0]?.avgCompositeScore != null
                  ? promptSummaries[1].avgCompositeScore - promptSummaries[0].avgCompositeScore
                  : undefined,
            };
            SessionService.updateEvalRun(config.sessionId, run.id, {
              status: 'completed',
              completedAt: new Date().toISOString(),
              scoreSummary,
            });
          }
        } catch (e) {
          console.error('[ExecutionService] Failed to update session run:', e);
        }
      }
    } catch (err) {
      const wasCancelled = cancelledEvals.has(evalId);
      cancelledEvals.delete(evalId);
      config.status = wasCancelled ? 'cancelled' : 'failed';
      config.updatedAt = new Date().toISOString();
      writeJson(join(evalDir, 'config.json'), config);
      writeJson(join(evalDir, 'error.json'), { error: (err as Error).message, updatedAt: config.updatedAt });

      broadcast({
        type: wasCancelled ? 'eval:cancelled' : 'eval:failed',
        evalId,
        data: { error: (err as Error).message },
        timestamp: Date.now(),
      });

      if (config.sessionId) {
        try {
          const { SessionService } = await import('./SessionService');
          const runs = SessionService.listEvalRuns(config.sessionId);
          const run = runs.find(r => r.evalId === evalId);
          if (run) {
            SessionService.updateEvalRun(config.sessionId, run.id, {
              status: 'failed',
              completedAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.error('[ExecutionService] Failed to update session run on failure:', e);
        }
      }
    } finally {
      activeControllers.delete(evalId);
    }
  },
};
