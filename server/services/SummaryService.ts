import type { EvaluationResults, EvaluationSummary, EvalMatrixCell, JudgeResult, ModelRanking, PromptRanking } from '../../src/types/eval.ts';
import { MetricsService } from './MetricsService.ts';

// Regression thresholds - ±2% for scores, ±5% for latency
const SCORE_THRESHOLD = 0.02;
const LATENCY_THRESHOLD = 0.05;

export class SummaryService {
  static computeSummary(
    evalId: string,
    results: EvaluationResults,
    perspectives: Array<{ id: string; weight: number }>
  ): EvaluationSummary {
    const { matrix, judgeResults } = results;

    // Build cell composite scores
    const cellScores = new Map<string, number>();
    if (judgeResults.length > 0 && perspectives.length > 0) {
      for (const cell of matrix) {
        const cellJudgments = judgeResults.filter(j => j.cellId === cell.id);
        if (cellJudgments.length === 0) continue;

        let composite = 0;
        let totalWeight = 0;
        for (const perspective of perspectives) {
          const judgment = cellJudgments.find(j => j.perspectiveId === perspective.id);
          if (judgment) {
            composite += judgment.score * perspective.weight;
            totalWeight += perspective.weight;
          }
        }
        if (totalWeight > 0) {
          cellScores.set(cell.id, composite / totalWeight);
        }
      }
    }

    // Per-model rankings
    const modelIds = [...new Set(matrix.map(c => c.modelId))];
    const modelRankings: ModelRanking[] = modelIds.map(modelId => {
      const cells = matrix.filter(c => c.modelId === modelId && c.status === 'completed');
      if (cells.length === 0) {
        return {
          modelId,
          compositeScore: 0,
          perspectiveScores: {},
          deterministicPassRate: 0,
          avgLatencyMs: 0,
          avgTokensPerSecond: 0
        };
      }

      const avgLatency = cells.reduce((s, c) => s + c.metrics.durationMs, 0) / cells.length;
      const avgTPS = cells.reduce((s, c) => s + c.metrics.tokensPerSecond, 0) / cells.length;
      const passRates = cells.map(c => MetricsService.deterministicPassRate(c));
      const avgPassRate = passRates.reduce((s, r) => s + r, 0) / passRates.length;

      // Composite score (if judge ran)
      const scores = cells.map(c => cellScores.get(c.id)).filter((s): s is number => s !== undefined);
      const compositeScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;

      // Per-perspective average
      const perspectiveScores: Record<string, number> = {};
      for (const perspective of perspectives) {
        const pJudgments = judgeResults.filter(
          j => cells.some(c => c.id === j.cellId) && j.perspectiveId === perspective.id
        );
        if (pJudgments.length > 0) {
          perspectiveScores[perspective.id] = pJudgments.reduce((s, j) => s + j.score, 0) / pJudgments.length;
        }
      }

      return {
        modelId,
        compositeScore,
        perspectiveScores,
        deterministicPassRate: avgPassRate,
        avgLatencyMs: avgLatency,
        avgTokensPerSecond: avgTPS
      };
    }).sort((a, b) => b.compositeScore - a.compositeScore || b.deterministicPassRate - a.deterministicPassRate);

    // Per-prompt rankings
    const promptIds = [...new Set(matrix.map(c => c.promptId))];
    const promptRankings: PromptRanking[] = promptIds.map(promptId => {
      const cells = matrix.filter(c => c.promptId === promptId && c.status === 'completed');
      if (cells.length === 0) {
        return { promptId, version: 1, compositeScore: 0, perspectiveScores: {} };
      }

      const scores = cells.map(c => cellScores.get(c.id)).filter((s): s is number => s !== undefined);
      const compositeScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;

      const perspectiveScores: Record<string, number> = {};
      for (const perspective of perspectives) {
        const pJudgments = judgeResults.filter(
          j => cells.some(c => c.id === j.cellId) && j.perspectiveId === perspective.id
        );
        if (pJudgments.length > 0) {
          perspectiveScores[perspective.id] = pJudgments.reduce((s, j) => s + j.score, 0) / pJudgments.length;
        }
      }

      const version = cells[0].promptVersion;
      return { promptId, version, compositeScore, perspectiveScores };
    }).sort((a, b) => b.compositeScore - a.compositeScore);

    return {
      evalId,
      modelRankings,
      promptRankings,
      generatedAt: new Date().toISOString()
    };
  }

  static computeRegression(
    current: EvaluationSummary,
    baseline: EvaluationSummary
  ): EvaluationSummary['regression'] {
    const details: Record<string, { before: number; after: number; delta: number }> = {};
    const improved: string[] = [];
    const regressed: string[] = [];
    const unchanged: string[] = [];

    // Compare per-model composite scores
    for (const currentModel of current.modelRankings) {
      const baseModel = baseline.modelRankings.find(m => m.modelId === currentModel.modelId);
      if (!baseModel) continue;

      const scoreKey = `${currentModel.modelId}:compositeScore`;
      const delta = currentModel.compositeScore - baseModel.compositeScore;
      details[scoreKey] = { before: baseModel.compositeScore, after: currentModel.compositeScore, delta };

      if (delta > SCORE_THRESHOLD) improved.push(scoreKey);
      else if (delta < -SCORE_THRESHOLD) regressed.push(scoreKey);
      else unchanged.push(scoreKey);

      // Latency comparison
      const latencyKey = `${currentModel.modelId}:avgLatencyMs`;
      const latencyDelta = currentModel.avgLatencyMs - baseModel.avgLatencyMs;
      details[latencyKey] = { before: baseModel.avgLatencyMs, after: currentModel.avgLatencyMs, delta: latencyDelta };

      const latencyPctChange = baseModel.avgLatencyMs > 0 ? latencyDelta / baseModel.avgLatencyMs : 0;
      if (latencyPctChange < -LATENCY_THRESHOLD) improved.push(latencyKey); // faster = improved
      else if (latencyPctChange > LATENCY_THRESHOLD) regressed.push(latencyKey);
      else unchanged.push(latencyKey);
    }

    return {
      baselineId: baseline.evalId,
      improved,
      regressed,
      unchanged,
      details
    };
  }

  static computeConsistency(matrix: EvalMatrixCell[]): Record<string, number> {
    // Group cells by promptId + modelId + testCaseId (ignoring runNumber)
    const groups = new Map<string, EvalMatrixCell[]>();
    for (const cell of matrix) {
      const key = `${cell.promptId}:${cell.modelId}:${cell.testCaseId}`;
      const group = groups.get(key) ?? [];
      group.push(cell);
      groups.set(key, group);
    }

    const result: Record<string, number> = {};
    for (const [key, cells] of groups) {
      if (cells.length < 2) continue;
      const scores = cells.map(c => MetricsService.deterministicPassRate(c));
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length;
      result[key] = Math.sqrt(variance); // standard deviation
    }
    return result;
  }
}
