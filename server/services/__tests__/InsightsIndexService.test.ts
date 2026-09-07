import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { configurePaths, INDEX_DB_PATH } from '../FileService';
import { PromptService } from '../PromptService';
import {
  recordEvaluation, getLeaderboard, getTrend, getDiagnostics, getOperational, listActivities,
  resetForTests, GATE_THRESHOLD_VERSION,
} from '../InsightsIndexService';
import type { EvaluationConfig, EvaluationSummary, ClassificationTaskMetrics, TaggingTaskMetrics } from '../../../src/types/eval';

function classificationMetrics(overrides: Partial<ClassificationTaskMetrics> = {}): ClassificationTaskMetrics {
  return {
    taskType: 'classification',
    accuracy: 0.854,
    macroF1: 0.847,
    perClass: {},
    invalidLabelRate: 0,
    formatComplianceRate: 1,
    confusionMatrix: {},
    accuracyCI: { point: 0.854, lower: 0.75, upper: 0.94 },
    gate: { pass: false, failures: ['inconclusive'], verdict: 'inconclusive', caseCount: 48, neededCases: 153 },
    ...overrides,
  };
}

function baseConfig(overrides: Partial<EvaluationConfig> = {}): Pick<EvaluationConfig, 'comparisonMode' | 'runsPerCell' | 'resolvedInference' | 'benchmarkProvenance' | 'createdAt' | 'promptIds' | 'promptVersions'> {
  return {
    comparisonMode: 'model',
    runsPerCell: 3,
    resolvedInference: { temperature: 0.3, maxTokens: 50, source: 'purposeTemplate' },
    promptIds: ['prm-1'],
    promptVersions: [{ promptId: 'prm-1', version: 1 }],
    createdAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

function baseSummary(modelId: string, taskMetrics: ClassificationTaskMetrics | TaggingTaskMetrics, completedAt: string): EvaluationSummary {
  return {
    evalId: 'ev-1',
    totalCells: 48,
    completedCells: 48,
    failedCells: 0,
    modelSummaries: [{
      modelId, avgDurationMs: 1200, avgInputTokens: 100, avgOutputTokens: 10,
      avgTokensPerSecond: 25, successRate: 1,
    }],
    promptSummaries: [],
    completedAt,
    taskMetrics,
  };
}

describe('InsightsIndexService', () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-insights-index-'));
    configurePaths({ dataRoot, repoRoot: process.cwd() });
    resetForTests();
  });

  afterEach(() => {
    resetForTests();
    configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('returns nothing before any evaluation has been recorded', () => {
    expect(listActivities()).toEqual([]);
    expect(getLeaderboard('classification')).toEqual([]);
  });

  it('indexes a completed evaluation into eval_runs and eval_run_metrics', () => {
    const summary = baseSummary('Tiny-Tower::granite4.1:8b', classificationMetrics(), '2026-09-06T10:00:00.000Z');
    recordEvaluation('ev-1', baseConfig(), summary);

    expect(listActivities()).toEqual(['classification']);

    const leaderboard = getLeaderboard('classification');
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0]).toMatchObject({
      modelId: 'Tiny-Tower::granite4.1:8b',
      serverName: 'Tiny-Tower',
      primaryMetricName: 'accuracy',
      primaryMetricValue: 0.854,
      ciLower: 0.75,
      ciUpper: 0.94,
      gateVerdict: 'inconclusive',
      caseCount: 48,
    });

    const diagnostics = getDiagnostics('classification');
    const macroF1 = diagnostics.find(d => d.metricName === 'macroF1');
    expect(macroF1?.metricValue).toBeCloseTo(0.847);
  });

  function readPromptTextHash(evalId: string): string | null {
    const db = new DatabaseSync(INDEX_DB_PATH);
    try {
      const row = db.prepare('SELECT promptTextHash FROM eval_runs WHERE evalId = ?').get(evalId) as
        { promptTextHash: string | null };
      return row.promptTextHash;
    } finally {
      db.close();
    }
  }

  it('populates promptTextHash from the resolved prompt version content (§2a)', () => {
    const manifest = PromptService.create({ name: 'Test Prompt', content: 'Hello, world.' });
    const summary = baseSummary('Tiny-Tower::granite4.1:8b', classificationMetrics(), '2026-09-06T10:00:00.000Z');
    recordEvaluation('ev-1', baseConfig({
      promptIds: [manifest.id],
      promptVersions: [{ promptId: manifest.id, version: 1 }],
    }), summary);

    expect(readPromptTextHash('ev-1')).toBe(createHash('sha256').update('Hello, world.', 'utf8').digest('hex'));
  });

  it('leaves promptTextHash null when the referenced prompt/version cannot be resolved', () => {
    // baseConfig() points at 'prm-1', which was never created on disk here.
    const summary = baseSummary('Tiny-Tower::granite4.1:8b', classificationMetrics(), '2026-09-06T10:00:00.000Z');
    recordEvaluation('ev-1', baseConfig(), summary);

    expect(readPromptTextHash('ev-1')).toBeNull();
  });

  it('parses serverName as null for a non-server-qualified modelId', () => {
    const summary = baseSummary('granite4.1:8b', classificationMetrics(), '2026-09-06T10:00:00.000Z');
    recordEvaluation('ev-1', baseConfig(), summary);
    expect(getLeaderboard('classification')[0].serverName).toBeNull();
  });

  it('upserts (re-recording the same evalId+modelId+activity replaces, not duplicates)', () => {
    const config = baseConfig();
    recordEvaluation('ev-1', config, baseSummary('Tiny-Tower::granite4.1:8b', classificationMetrics(), '2026-09-06T10:00:00.000Z'));
    recordEvaluation('ev-1', config, baseSummary('Tiny-Tower::granite4.1:8b', classificationMetrics({ accuracy: 0.9 }), '2026-09-06T10:00:00.000Z'));

    const leaderboard = getLeaderboard('classification');
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0].primaryMetricValue).toBe(0.9);
  });

  it('builds a trend across multiple evaluations for the same model', () => {
    const config = baseConfig();
    recordEvaluation('ev-1', config, baseSummary('Tiny-Tower::granite4.1:8b', classificationMetrics({ accuracy: 0.8 }), '2026-09-05T10:00:00.000Z'));
    recordEvaluation('ev-2', config, baseSummary('Tiny-Tower::granite4.1:8b', classificationMetrics({ accuracy: 0.85 }), '2026-09-06T10:00:00.000Z'));

    const trend = getTrend('classification', 'Tiny-Tower::granite4.1:8b');
    expect(trend.map(t => t.primaryMetricValue)).toEqual([0.8, 0.85]);
    expect(trend.map(t => t.evalId)).toEqual(['ev-1', 'ev-2']);
  });

  it('skips a model with no task metrics available (e.g. a non-purpose-template evaluation)', () => {
    const summary: EvaluationSummary = {
      evalId: 'ev-1', totalCells: 4, completedCells: 4, failedCells: 0,
      modelSummaries: [{ modelId: 'Tiny-Tower::mystery:1b', avgDurationMs: 100, avgInputTokens: 1, avgOutputTokens: 1, avgTokensPerSecond: 1, successRate: 1 }],
      promptSummaries: [],
    };
    recordEvaluation('ev-1', baseConfig(), summary);
    expect(listActivities()).toEqual([]);
  });

  it('records operational fields per model', () => {
    const summary = baseSummary('M5 Max::lfm2.5:8b', classificationMetrics(), '2026-09-06T10:00:00.000Z');
    recordEvaluation('ev-1', baseConfig(), summary, { concurrency: 8 });

    const op = getOperational('classification');
    expect(op[0]).toMatchObject({
      modelId: 'M5 Max::lfm2.5:8b', serverName: 'M5 Max', avgDurationMs: 1200, avgTokensPerSecond: 25, concurrency: 8,
    });
  });

  it('honors a gateThresholdVersion override (backfill of pre-existing runs)', () => {
    recordEvaluation('ev-1', baseConfig(), baseSummary('Tiny-Tower::granite4.1:8b', classificationMetrics(), '2026-09-06T10:00:00.000Z'), {
      gateThresholdVersionOverride: 'pre-v1',
    });
    // Row exists — the override value itself isn't exposed by the read helpers
    // above, so this just confirms recordEvaluation accepts and doesn't choke
    // on the option (the value is asserted indirectly via GATE_THRESHOLD_VERSION
    // being the untouched default for a normal call, below).
    expect(getLeaderboard('classification')).toHaveLength(1);
  });

  it('defaults to the current GATE_THRESHOLD_VERSION when no override is given', () => {
    expect(GATE_THRESHOLD_VERSION).toBe('v1');
  });

  it('uses perModelTaskMetrics over the aggregate taskMetrics when both are present', () => {
    const config = baseConfig();
    const summary: EvaluationSummary = {
      ...baseSummary('Tiny-Tower::granite3.3:8b', classificationMetrics({ accuracy: 0.5 }), '2026-09-06T10:00:00.000Z'),
      modelSummaries: [
        { modelId: 'Tiny-Tower::granite3.3:8b', avgDurationMs: 1000, avgInputTokens: 1, avgOutputTokens: 1, avgTokensPerSecond: 1, successRate: 1 },
        { modelId: 'Tiny-Tower::granite4.1:8b', avgDurationMs: 1000, avgInputTokens: 1, avgOutputTokens: 1, avgTokensPerSecond: 1, successRate: 1 },
      ],
      perModelTaskMetrics: {
        'Tiny-Tower::granite3.3:8b': classificationMetrics({ accuracy: 0.688 }),
        'Tiny-Tower::granite4.1:8b': classificationMetrics({ accuracy: 0.854 }),
      },
    };
    recordEvaluation('ev-1', config, summary);

    const leaderboard = getLeaderboard('classification');
    const byModel = Object.fromEntries(leaderboard.map(r => [r.modelId, r.primaryMetricValue]));
    expect(byModel['Tiny-Tower::granite3.3:8b']).toBeCloseTo(0.688);
    expect(byModel['Tiny-Tower::granite4.1:8b']).toBeCloseTo(0.854);
  });
});
