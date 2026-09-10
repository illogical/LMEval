import { existsSync } from 'fs';
import { join } from 'path';
import { EVALUATIONS_DIR, readJson, readText } from './FileService';
import { browserPaths } from './EvaluationService';
import { EvaluationValidationService, ModelCatalogUnavailableError } from './EvaluationValidationService';
import type {
  EvaluationConfig, EvaluationFeedback, EvaluationProgress, EvaluationSummary, EvalMatrixCell, TaskMetrics,
  EvaluationAttempt, EvaluationFailure, EvaluationRunState, EvaluationWorkPlan,
} from '../../src/types/eval';
import { EvaluationCheckpointService } from './EvaluationCheckpointService';
import { EvaluationAttemptService } from './EvaluationAttemptService';

function verdictFor(metrics: TaskMetrics | undefined): EvaluationFeedback['verdict'] {
  if (!metrics) return null;
  const gate = metrics.gate;
  const common = { taskType: metrics.taskType, verdict: gate.verdict, caseCount: gate.caseCount, reason: gate.failures.join('; ') || undefined };
  if (metrics.taskType === 'classification') return { ...common, primaryMetric: { name: 'accuracy', value: metrics.accuracy, confidenceInterval: metrics.accuracyCI } };
  if (metrics.taskType === 'tagging') return { ...common, primaryMetric: { name: metrics.gateMetric ?? 'jaccardMean', value: metrics.gateMetric === 'microRecall' ? metrics.microRecall : metrics.jaccardMean, confidenceInterval: metrics.jaccardCI } };
  return { ...common, primaryMetric: { name: 'weightedRubric', value: metrics.medianRubric.weighted, confidenceInterval: metrics.weightedCI } };
}

export const EvaluationFeedbackService = {
  async get(evalId: string, appBasePath = '/'): Promise<EvaluationFeedback | null> {
    const dir = join(EVALUATIONS_DIR, evalId);
    const config = readJson<EvaluationConfig>(join(dir, 'config.json'));
    if (!config) return null;
    const results = readJson<EvalMatrixCell[]>(join(dir, 'results.json')) ?? [];
    const summary = readJson<EvaluationSummary>(join(dir, 'summary.json'));
    const runError = readJson<{ error: string }>(join(dir, 'error.json'));
    const savedProgress = readJson<EvaluationProgress>(join(dir, 'progress.json'));
    const total = savedProgress?.total ?? summary?.totalCells ?? results.length;
    const completed = savedProgress?.completed ?? summary?.completedCells ?? results.filter(cell => cell.status === 'completed').length;
    const failed = savedProgress?.failed ?? summary?.failedCells ?? results.filter(cell => cell.status === 'failed').length;
    let validation = { valid: true, errors: [], warnings: [] } as Awaited<ReturnType<typeof EvaluationValidationService.validate>>;
    // Drafts are mutable and benefit from current catalog validation. Once a
    // run starts, feedback is intentionally local/durable: a catalog outage
    // must not hide checkpoints or turn polling into provider discovery.
    if (config.status === 'draft' || config.status === 'pending') {
      try {
        validation = await EvaluationValidationService.validate(config);
      } catch (error) {
        validation = {
          valid: false,
          errors: [{ code: error instanceof ModelCatalogUnavailableError ? 'MODEL_CATALOG_UNAVAILABLE' : 'VALIDATION_UNAVAILABLE', message: (error as Error).message }],
          warnings: [],
        };
      }
    }
    const plan = readJson<EvaluationWorkPlan>(join(dir, 'work-plan.json'));
    const runState = readJson<EvaluationRunState>(join(dir, 'run-state.json'));
    const checkpointScan = plan ? EvaluationCheckpointService.scan(evalId, plan) : null;
    const attempts = EvaluationAttemptService.list(evalId);
    const lastAttempt = attempts.at(-1) as EvaluationAttempt | undefined;
    const journal = readText(join(dir, 'failures.jsonl'))?.trim().split(/\r?\n/).filter(Boolean)
      .flatMap(line => { try { return [JSON.parse(line) as EvaluationFailure]; } catch { return []; } }) ?? [];
    const recovery = runState?.recovery ?? (
      config.status === 'completed' ? { state: 'not-needed' as const, reusedCells: 0, remainingCells: 0, requiresModelCalls: false }
        : ['failed', 'cancelled', 'interrupted'].includes(config.status)
          ? { state: 'legacy-unrecoverable' as const, reasonCode: 'LEGACY_NO_CHECKPOINTS' as const, reusedCells: 0, remainingCells: total, requiresModelCalls: true }
          : undefined
    );
    return {
      evalId,
      status: config.status,
      progress: {
        total: plan?.items.length ?? total,
        completed: checkpointScan ? checkpointScan.checkpoints.filter(value => value.cell.status === 'completed').length : completed,
        failed: checkpointScan?.terminalFailed ?? failed,
        observedCompleted: savedProgress?.observedCompleted,
        durablyCommitted: checkpointScan?.committedIds.size ?? savedProgress?.durablyCommitted,
        remaining: checkpointScan?.remaining ?? savedProgress?.remaining,
        attemptId: savedProgress?.attemptId,
        sequence: savedProgress?.sequence,
        updatedAt: savedProgress?.updatedAt ?? config.updatedAt,
      },
      validation,
      failures: [
        ...(runError ? [{ error: runError.error }] : []),
        ...journal.map(failure => ({ cellId: failure.cellId, modelId: failure.model?.canonicalId, error: `[${failure.code}] ${failure.message}` })),
        ...results.filter(cell => cell.status === 'failed').map(cell => ({ cellId: cell.id, promptId: cell.promptId, modelId: cell.modelId, error: cell.error ?? 'Cell failed' })),
      ],
      readiness: {
        results: existsSync(join(dir, 'results.json')),
        summary: existsSync(join(dir, 'summary.json')),
        regression: config.status === 'completed' && existsSync(join(dir, 'summary.json')),
        summaryAnalysis: existsSync(join(dir, 'analysis.json')),
      },
      verdict: verdictFor(summary?.taskMetrics),
      appBasePath,
      browserPaths: browserPaths(evalId, appBasePath),
      attempt: attempts.length ? { currentAttemptId: runState?.currentAttemptId, attemptCount: attempts.length, status: runState?.currentAttemptId ? EvaluationAttemptService.loadAttempt(evalId, runState.currentAttemptId)?.status : lastAttempt?.status } : undefined,
      recovery,
    };
  },
};
