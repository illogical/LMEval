import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configurePaths } from '../FileService';
import { ModelSelectionService, computeP95LatencyMs } from '../ModelSelectionService';
import { LatencyBudgetService } from '../LatencyBudgetService';
import type {
  EvalMatrixCell, EvaluationSummary, ClassificationTaskMetrics, ModelSelectionCampaign,
} from '../../../src/types/eval';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-model-selection-'));
  configurePaths({ dataRoot, repoRoot: process.cwd() });
});

afterEach(() => {
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(dataRoot, { recursive: true, force: true });
});

function classificationMetrics(overrides: Partial<ClassificationTaskMetrics> & { accuracyCI: ClassificationTaskMetrics['accuracyCI'] }): ClassificationTaskMetrics {
  return {
    taskType: 'classification',
    accuracy: overrides.accuracyCI!.point,
    macroF1: overrides.accuracyCI!.point,
    perClass: {},
    invalidLabelRate: 0,
    formatComplianceRate: 1,
    confusionMatrix: {},
    gate: { pass: true, failures: [], verdict: 'pass', caseCount: 20 },
    ...overrides,
  };
}

function cell(overrides: Partial<EvalMatrixCell>): EvalMatrixCell {
  return {
    id: overrides.id ?? `cell-${Math.random()}`,
    evalId: 'eval-1',
    promptId: 'p1',
    promptVersion: 1,
    modelId: 'm1',
    testCaseId: 'tc1',
    run: 1,
    status: 'completed',
    ...overrides,
  };
}

function baseCampaign(overrides: Partial<ModelSelectionCampaign> = {}): ModelSelectionCampaign {
  return {
    id: 'campaign-1',
    status: 'pending',
    tasks: ['classification'],
    incumbentModelId: 'incumbent',
    candidateSlate: [
      { modelId: 'incumbent', lmapiServer: 'server-a' },
      { modelId: 'model-b', lmapiServer: 'server-a' },
      { modelId: 'model-c', lmapiServer: 'server-b' },
    ],
    promptIdsByTask: { classification: ['p1'] },
    testSuiteIdByTask: { classification: 'suite-1' },
    phase1EvalIds: {},
    phase2EvalIds: {},
    phase3EvalIds: {},
    recommendations: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ModelSelectionService.createCampaign', () => {
  it('rejects a missing incumbent', () => {
    expect(() => ModelSelectionService.createCampaign({
      tasks: ['classification'],
      incumbentModelId: '',
      candidateSlate: [{ modelId: 'm1', lmapiServer: 's1' }],
      promptIdsByTask: { classification: ['p1'] },
      testSuiteIdByTask: { classification: 'suite-1' },
    })).toThrow(/incumbentModelId/);
  });

  it('rejects an empty candidate slate', () => {
    expect(() => ModelSelectionService.createCampaign({
      tasks: ['classification'],
      incumbentModelId: 'm1',
      candidateSlate: [],
      promptIdsByTask: { classification: ['p1'] },
      testSuiteIdByTask: { classification: 'suite-1' },
    })).toThrow(/candidateSlate/);
  });

  it('rejects a task missing from promptIdsByTask or testSuiteIdByTask', () => {
    expect(() => ModelSelectionService.createCampaign({
      tasks: ['classification', 'tagging'],
      incumbentModelId: 'm1',
      candidateSlate: [{ modelId: 'm1', lmapiServer: 's1' }],
      promptIdsByTask: { classification: ['p1'] },
      testSuiteIdByTask: { classification: 'suite-1' },
    })).toThrow(/tagging/);
  });

  it('persists a valid campaign, retrievable by getCampaign and listCampaigns', () => {
    const campaign = ModelSelectionService.createCampaign({
      tasks: ['classification'],
      incumbentModelId: 'm1',
      candidateSlate: [{ modelId: 'm1', lmapiServer: 's1' }],
      promptIdsByTask: { classification: ['p1'] },
      testSuiteIdByTask: { classification: 'suite-1' },
    });
    expect(campaign.status).toBe('pending');
    expect(ModelSelectionService.getCampaign(campaign.id)).toEqual(campaign);
    expect(ModelSelectionService.listCampaigns().map(c => c.id)).toEqual([campaign.id]);
  });

  it('marks unfinished campaigns interrupted instead of resuming them after startup', () => {
    const campaign = ModelSelectionService.createCampaign({
      tasks: ['classification'], incumbentModelId: 'm1', candidateSlate: [{ modelId: 'm1', lmapiServer: 's1' }],
      promptIdsByTask: { classification: ['p1'] }, testSuiteIdByTask: { classification: 'suite-1' },
    });
    ModelSelectionService.interruptCampaigns();
    expect(ModelSelectionService.getCampaign(campaign.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('Interrupted') });
  });
});

describe('computeP95LatencyMs', () => {
  it('computes the 95th percentile of completed durations for one model', () => {
    const cells = Array.from({ length: 20 }, (_, i) =>
      cell({ id: `c${i}`, modelId: 'm1', durationMs: (i + 1) * 100 }));
    const p95 = computeP95LatencyMs(cells, 'm1');
    expect(p95).toBeGreaterThan(1800);
    expect(p95).toBeLessThanOrEqual(2000);
  });

  it('ignores other models and non-completed cells', () => {
    const cells = [
      cell({ id: 'a', modelId: 'm1', durationMs: 100 }),
      cell({ id: 'b', modelId: 'm2', durationMs: 99999 }),
      cell({ id: 'c', modelId: 'm1', status: 'failed', durationMs: 88888 }),
    ];
    expect(computeP95LatencyMs(cells, 'm1')).toBe(100);
  });

  it('returns 0 when a model has no completed timed cells', () => {
    expect(computeP95LatencyMs([], 'm1')).toBe(0);
  });
});

describe('ModelSelectionService.selectModel', () => {
  it('discards a model that fails its gate', () => {
    const summary: EvaluationSummary = {
      evalId: 'e1', totalCells: 0, completedCells: 0, failedCells: 0, modelSummaries: [], promptSummaries: [],
      perModelTaskMetrics: {
        good: classificationMetrics({ accuracyCI: { point: 0.95, lower: 0.90, upper: 0.99 }, gate: { pass: true, failures: [], verdict: 'pass', caseCount: 20 } }),
        bad: classificationMetrics({ accuracyCI: { point: 0.4, lower: 0.3, upper: 0.5 }, gate: { pass: false, failures: ['macro-F1 too low'], verdict: 'fail', caseCount: 20 } }),
      },
    };
    const cells = [cell({ modelId: 'good' }), cell({ modelId: 'bad' })];
    const result = ModelSelectionService.selectModel('classification', summary, cells);
    expect(result.discardedByGate).toEqual([{ modelId: 'bad', reason: 'macro-F1 too low' }]);
    expect(result.winner).toBe('good');
    expect(result.tieGroups.flatMap(g => g.modelIds)).not.toContain('bad');
  });

  it('groups overlapping-CI survivors into one tie group', () => {
    const summary: EvaluationSummary = {
      evalId: 'e1', totalCells: 0, completedCells: 0, failedCells: 0, modelSummaries: [], promptSummaries: [],
      perModelTaskMetrics: {
        a: classificationMetrics({ accuracyCI: { point: 0.90, lower: 0.85, upper: 0.95 } }),
        b: classificationMetrics({ accuracyCI: { point: 0.88, lower: 0.83, upper: 0.93 } }),
      },
    };
    const cells = [cell({ modelId: 'a' }), cell({ modelId: 'b' })];
    const result = ModelSelectionService.selectModel('classification', summary, cells);
    expect(result.tieGroups).toHaveLength(1);
    expect(result.tieGroups[0].modelIds.sort()).toEqual(['a', 'b']);
  });

  it('breaks a tie by ascending p95 latency when a budget is configured', () => {
    const summary: EvaluationSummary = {
      evalId: 'e1', totalCells: 0, completedCells: 0, failedCells: 0, modelSummaries: [], promptSummaries: [],
      perModelTaskMetrics: {
        slow: classificationMetrics({ accuracyCI: { point: 0.90, lower: 0.85, upper: 0.95 } }),
        fast: classificationMetrics({ accuracyCI: { point: 0.90, lower: 0.85, upper: 0.95 } }),
      },
    };
    const cells = [
      cell({ id: 's1', modelId: 'slow', durationMs: 5000 }),
      cell({ id: 'f1', modelId: 'fast', durationMs: 500 }),
    ];
    LatencyBudgetService.set({ classification: 1000, tagging: 1000, summarization: 3000 });
    const result = ModelSelectionService.selectModel('classification', summary, cells);
    expect(result.tieGroups[0].modelIds).toEqual(['fast', 'slow']);
    expect(result.winner).toBe('fast');
    expect(result.latencyBudgetNote).toBeUndefined();
  });

  it('records a note and skips latency ordering when no budget is configured', () => {
    const summary: EvaluationSummary = {
      evalId: 'e1', totalCells: 0, completedCells: 0, failedCells: 0, modelSummaries: [], promptSummaries: [],
      perModelTaskMetrics: {
        a: classificationMetrics({ accuracyCI: { point: 0.90, lower: 0.85, upper: 0.95 } }),
      },
    };
    const result = ModelSelectionService.selectModel('classification', summary, []);
    expect(result.latencyBudgetNote).toMatch(/No latency budget configured/);
  });

  it('breaks a remaining tie by run-to-run agreement, then avg output tokens', () => {
    const summary: EvaluationSummary = {
      evalId: 'e1', totalCells: 0, completedCells: 0, failedCells: 0, modelSummaries: [], promptSummaries: [],
      perModelTaskMetrics: {
        chatty: classificationMetrics({ accuracyCI: { point: 0.90, lower: 0.85, upper: 0.95 }, runToRunAgreement: 0.6 }),
        stable: classificationMetrics({ accuracyCI: { point: 0.90, lower: 0.85, upper: 0.95 }, runToRunAgreement: 0.95 }),
      },
    };
    const cells = [
      cell({ id: 'c1', modelId: 'chatty', outputTokens: 500 }),
      cell({ id: 's1', modelId: 'stable', outputTokens: 100 }),
    ];
    const result = ModelSelectionService.selectModel('classification', summary, cells);
    expect(result.winner).toBe('stable');
  });

  it('falls back to treating every model as a survivor when all fail the gate', () => {
    const summary: EvaluationSummary = {
      evalId: 'e1', totalCells: 0, completedCells: 0, failedCells: 0, modelSummaries: [], promptSummaries: [],
      perModelTaskMetrics: {
        a: classificationMetrics({ accuracyCI: { point: 0.4, lower: 0.3, upper: 0.5 }, gate: { pass: false, failures: ['x'], verdict: 'fail', caseCount: 10 } }),
      },
    };
    const result = ModelSelectionService.selectModel('classification', summary, []);
    expect(result.winner).toBe('a');
  });
});

describe('ModelSelectionService cross-task aggregation', () => {
  it('computeCrossServerFlag is true when the winning models span more than one lmapiServer', () => {
    const campaign = baseCampaign({
      tasks: ['classification', 'tagging'],
      recommendations: {
        classification: { recommendedModelId: 'model-b' } as never,
        tagging: { recommendedModelId: 'model-c' } as never,
      },
    });
    expect(ModelSelectionService.computeCrossServerFlag(campaign)).toBe(true);
  });

  it('computeCrossServerFlag is false when everything stays on one server', () => {
    const campaign = baseCampaign({
      tasks: ['classification'],
      recommendations: { classification: { recommendedModelId: 'model-b' } as never },
    });
    expect(ModelSelectionService.computeCrossServerFlag(campaign)).toBe(false);
  });
});
