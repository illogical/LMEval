import { existsSync } from 'fs';
import { join } from 'path';
import { EVALUATIONS_DIR, readJson } from './FileService';
import { browserPaths } from './EvaluationService';
import { EvaluationValidationService, ModelCatalogUnavailableError } from './EvaluationValidationService';
import type {
  EvaluationConfig, EvaluationFeedback, EvaluationProgress, EvaluationSummary, EvalMatrixCell, TaskMetrics,
} from '../../src/types/eval';

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
    let validation;
    try {
      validation = await EvaluationValidationService.validate(config);
    } catch (error) {
      validation = {
        valid: false,
        errors: [{ code: error instanceof ModelCatalogUnavailableError ? 'MODEL_CATALOG_UNAVAILABLE' : 'VALIDATION_UNAVAILABLE', message: (error as Error).message }],
        warnings: [],
      };
    }
    return {
      evalId,
      status: config.status,
      progress: { total, completed, failed, updatedAt: savedProgress?.updatedAt ?? config.updatedAt },
      validation,
      failures: [
        ...(runError ? [{ error: runError.error }] : []),
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
    };
  },
};
