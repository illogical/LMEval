import type {
  EvalMatrixCell,
  EvaluationSummary,
  EvalModelSummary,
  EvalPromptSummary,
  RegressionResult,
  MetricRegression,
  PairwiseRanking,
} from '../../src/types/eval';

// Minimum relative change required before a metric is considered regressed or improved
const SCORE_REGRESSION_THRESHOLD = 0.02; // 2% change in composite score
const LATENCY_REGRESSION_THRESHOLD = 0.05; // 5% change in latency

export const SummaryService = {
  computeSummary(evalId: string, cells: EvalMatrixCell[], pairwiseRankings?: PairwiseRanking[]): EvaluationSummary {
    const completed = cells.filter(c => c.status === 'completed');
    const failed = cells.filter(c => c.status === 'failed');

    const modelMap = new Map<string, EvalMatrixCell[]>();
    for (const cell of completed) {
      const list = modelMap.get(cell.modelId) ?? [];
      list.push(cell);
      modelMap.set(cell.modelId, list);
    }

    const modelSummaries: EvalModelSummary[] = [];
    for (const [modelId, modelCells] of modelMap) {
      const n = modelCells.length;
      const totalCellsForModel = cells.filter(c => c.modelId === modelId).length;
      const avgDurationMs = modelCells.reduce((s, c) => s + (c.durationMs ?? 0), 0) / n;
      const avgInputTokens = modelCells.reduce((s, c) => s + (c.inputTokens ?? 0), 0) / n;
      const avgOutputTokens = modelCells.reduce((s, c) => s + (c.outputTokens ?? 0), 0) / n;
      const avgTokensPerSecond = modelCells.reduce((s, c) => s + (c.tokensPerSecond ?? 0), 0) / n;
      const successRate = n / totalCellsForModel;

      const hasScores = modelCells.some(c => c.compositeScore != null);
      const avgCompositeScore = hasScores
        ? modelCells.reduce((s, c) => s + (c.compositeScore ?? 0), 0) / n
        : undefined;

      const perspectiveScores: Record<string, number> = {};
      const perspectiveCounts: Record<string, number> = {};
      for (const cell of modelCells) {
        for (const jr of cell.judgeResults ?? []) {
          perspectiveScores[jr.perspectiveId] = (perspectiveScores[jr.perspectiveId] ?? 0) + jr.score;
          perspectiveCounts[jr.perspectiveId] = (perspectiveCounts[jr.perspectiveId] ?? 0) + 1;
        }
      }
      const avgPerspectiveScores: Record<string, number> = {};
      for (const [id, total] of Object.entries(perspectiveScores)) {
        avgPerspectiveScores[id] = total / perspectiveCounts[id];
      }

      modelSummaries.push({
        modelId,
        avgCompositeScore,
        avgDurationMs,
        avgInputTokens,
        avgOutputTokens,
        avgTokensPerSecond,
        successRate,
        perspectiveScores: Object.keys(avgPerspectiveScores).length > 0 ? avgPerspectiveScores : undefined,
      });
    }

    modelSummaries.sort((a, b) => {
      if (a.avgCompositeScore != null && b.avgCompositeScore != null) {
        return b.avgCompositeScore - a.avgCompositeScore;
      }
      return b.successRate - a.successRate;
    });
    modelSummaries.forEach((m, i) => { m.rank = i + 1; });

    const promptMap = new Map<string, EvalMatrixCell[]>();
    for (const cell of completed) {
      const key = `${cell.promptId}:${cell.promptVersion}`;
      const list = promptMap.get(key) ?? [];
      list.push(cell);
      promptMap.set(key, list);
    }

    const promptSummaries: EvalPromptSummary[] = [];
    for (const [, promptCells] of promptMap) {
      const n = promptCells.length;
      const first = promptCells[0];
      const totalCellsForPrompt = cells.filter(
        c => c.promptId === first.promptId && c.promptVersion === first.promptVersion
      ).length;
      const avgDurationMs = promptCells.reduce((s, c) => s + (c.durationMs ?? 0), 0) / n;
      const successRate = n / totalCellsForPrompt;

      const hasScores = promptCells.some(c => c.compositeScore != null);
      const avgCompositeScore = hasScores
        ? promptCells.reduce((s, c) => s + (c.compositeScore ?? 0), 0) / n
        : undefined;

      promptSummaries.push({
        promptId: first.promptId,
        promptVersion: first.promptVersion,
        avgCompositeScore,
        avgDurationMs,
        successRate,
      });
    }

    return {
      evalId,
      totalCells: cells.length,
      completedCells: completed.length,
      failedCells: failed.length,
      modelSummaries,
      promptSummaries,
      pairwiseRankings: pairwiseRankings && pairwiseRankings.length > 0 ? pairwiseRankings : undefined,
      completedAt: new Date().toISOString(),
    };
  },

  computeConsistency(cells: EvalMatrixCell[]): Record<string, number> {
    const byModel = new Map<string, number[]>();
    for (const cell of cells) {
      if (cell.compositeScore == null) continue;
      const list = byModel.get(cell.modelId) ?? [];
      list.push(cell.compositeScore);
      byModel.set(cell.modelId, list);
    }
    const result: Record<string, number> = {};
    for (const [modelId, scores] of byModel) {
      if (scores.length < 2) { result[modelId] = 0; continue; }
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
      result[modelId] = Math.sqrt(variance);
    }
    return result;
  },

  computeRegression(
    current: EvaluationSummary,
    baseline: EvaluationSummary
  ): RegressionResult {
    const metrics: MetricRegression[] = [];

    function addMetric(
      name: string,
      currentVal: number,
      baselineVal: number,
      threshold: number
    ) {
      const delta = currentVal - baselineVal;
      const pct = baselineVal !== 0 ? Math.abs(delta) / Math.abs(baselineVal) : 0;
      let status: 'improved' | 'regressed' | 'unchanged' = 'unchanged';
      if (pct >= threshold) {
        status = delta > 0 ? 'improved' : 'regressed';
      }
      metrics.push({ metric: name, baseline: baselineVal, current: currentVal, delta, status });
    }

    const currentAvgScore = current.modelSummaries
      .filter(m => m.avgCompositeScore != null)
      .reduce((s, m) => s + (m.avgCompositeScore ?? 0), 0) / (current.modelSummaries.length || 1);

    const baselineAvgScore = baseline.modelSummaries
      .filter(m => m.avgCompositeScore != null)
      .reduce((s, m) => s + (m.avgCompositeScore ?? 0), 0) / (baseline.modelSummaries.length || 1);

    if (currentAvgScore > 0 || baselineAvgScore > 0) {
      addMetric('compositeScore', currentAvgScore, baselineAvgScore, SCORE_REGRESSION_THRESHOLD);
    }

    const currentAvgLatency = current.modelSummaries
      .reduce((s, m) => s + m.avgDurationMs, 0) / (current.modelSummaries.length || 1);
    const baselineAvgLatency = baseline.modelSummaries
      .reduce((s, m) => s + m.avgDurationMs, 0) / (baseline.modelSummaries.length || 1);

    if (currentAvgLatency > 0 || baselineAvgLatency > 0) {
      const latencyDelta = currentAvgLatency - baselineAvgLatency;
      const pct = baselineAvgLatency !== 0 ? Math.abs(latencyDelta) / baselineAvgLatency : 0;
      let status: 'improved' | 'regressed' | 'unchanged' = 'unchanged';
      if (pct >= LATENCY_REGRESSION_THRESHOLD) {
        status = latencyDelta < 0 ? 'improved' : 'regressed';
      }
      metrics.push({
        metric: 'avgLatencyMs',
        baseline: baselineAvgLatency,
        current: currentAvgLatency,
        delta: latencyDelta,
        status,
      });
    }

    return {
      metrics,
      hasRegressions: metrics.some(m => m.status === 'regressed'),
      hasImprovements: metrics.some(m => m.status === 'improved'),
    };
  },
};
