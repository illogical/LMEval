import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configurePaths, writeJson, EVALUATIONS_DIR, RECOMMENDATIONS_DIR } from '../FileService';
import { ReportService } from '../ReportService';
import type {
  EvaluationConfig, EvaluationSummary, TestCase, ClassificationTaskMetrics, TaggingTaskMetrics,
  SummarizationTaskMetrics, ModelRecommendation, TestCaseSummary,
} from '../../../src/types/eval';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-report-'));
  configurePaths({ dataRoot, repoRoot: process.cwd() });
});

afterEach(() => {
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(dataRoot, { recursive: true, force: true });
});

function baseConfig(overrides: Partial<EvaluationConfig> = {}): EvaluationConfig {
  return {
    id: 'eval-1', name: 'Test Eval', promptIds: ['p1'], modelIds: ['m1'],
    status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function baseSummary(overrides: Partial<EvaluationSummary> = {}): EvaluationSummary {
  return {
    evalId: 'eval-1', totalCells: 1, completedCells: 1, failedCells: 0,
    modelSummaries: [], promptSummaries: [],
    ...overrides,
  };
}

function classificationMetrics(overrides: Partial<ClassificationTaskMetrics> = {}): ClassificationTaskMetrics {
  return {
    taskType: 'classification', accuracy: 0.9, macroF1: 0.85,
    perClass: { Note: { precision: 0.9, recall: 0.9, f1: 0.9, support: 10 } },
    invalidLabelRate: 0, formatComplianceRate: 1,
    confusionMatrix: { Note: { Note: 9, Reminder: 1 } },
    gate: { pass: true, failures: [], verdict: 'pass', caseCount: 10 },
    ...overrides,
  };
}

function seedEval(evalId: string, config: EvaluationConfig, summary: EvaluationSummary, testCases?: TestCase[]): void {
  const evalDir = join(EVALUATIONS_DIR, evalId);
  writeJson(join(evalDir, 'config.json'), config);
  writeJson(join(evalDir, 'summary.json'), summary);
  if (testCases) writeJson(join(evalDir, 'testcases.json'), testCases);
}

describe('ReportService.generateMarkdown — task metrics rendering', () => {
  it('renders classification confusion matrix, per-class table, and gate', () => {
    const summary = baseSummary({ taskMetrics: classificationMetrics() });
    seedEval('eval-1', baseConfig(), summary);
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).toContain('## Task Metrics');
    expect(md).toContain('Confusion matrix');
    expect(md).toContain('| Note | 0.90 | 0.90 | 0.90 | 10 |');
    expect(md).toContain('**Gate:** pass');
  });

  it('renders tagging micro/macro metrics and per-tag table', () => {
    const tagging: TaggingTaskMetrics = {
      taskType: 'tagging', microPrecision: 0.8, microRecall: 0.75, microF1: 0.77, macroLabelF1: 0.7,
      jaccardMean: 0.6, exactSetMatchRate: 0.5, unknownTagRate: 0, duplicateTagRate: 0, formatComplianceRate: 1,
      perLabel: { family: { precision: 0.8, recall: 0.7, f1: 0.75, support: 5 } },
      gate: { pass: false, failures: ['micro-F1 0.77 < 0.85'], verdict: 'fail', caseCount: 12 },
    };
    seedEval('eval-1', baseConfig(), baseSummary({ taskMetrics: tagging }));
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).toContain('Micro P/R/F1');
    expect(md).toContain('| family | 0.80 | 0.70 | 0.75 | 5 |');
    expect(md).toContain('micro-F1 0.77 < 0.85');
  });

  it('renders summarization rubric dimensions, deterministic checks, and judge status', () => {
    const summarization: SummarizationTaskMetrics = {
      taskType: 'summarization',
      deterministic: {
        noPreambleRate: 1, noHeadingRate: 1, noFenceRate: 1,
        compressionInRangeRate: 1, protectedTokensPreservedRate: 1, noForbiddenClaimsRate: 1,
      },
      medianRubric: { faithfulness: 4.5, salientCoverage: 4, retrievalUtility: 4, concision: 4, weighted: 4.3 },
      criticalUnsupportedClaimRate: 0,
      selfJudgeGuardViolated: false,
      judgeQualified: true,
      gate: { pass: true, failures: [], verdict: 'pass', caseCount: 20 },
    };
    seedEval('eval-1', baseConfig(), baseSummary({ taskMetrics: summarization }));
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).toContain('Median weighted');
    expect(md).toContain('Judge qualified:** yes');
    expect(md).toContain('Deterministic checks');
  });
});

describe('ReportService.generateMarkdown — per-model breakdown', () => {
  it('renders one section per candidate model when perModelTaskMetrics is present', () => {
    seedEval('eval-1', baseConfig({ comparisonMode: 'model', modelIds: ['m1', 'm2'] }), baseSummary({
      perModelTaskMetrics: {
        m1: classificationMetrics({ accuracy: 0.9 }),
        m2: classificationMetrics({ accuracy: 0.7 }),
      },
    }));
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).toContain('## Per-Model Breakdown');
    expect(md).toContain('### `m1`');
    expect(md).toContain('### `m2`');
  });

  it('omits the per-model section when perModelTaskMetrics is absent', () => {
    seedEval('eval-1', baseConfig(), baseSummary());
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).not.toContain('## Per-Model Breakdown');
  });
});

describe('ReportService.generateMarkdown — slice tables', () => {
  it('groups test cases by caseTags family and reports average pass rate', () => {
    const testCases: TestCase[] = [
      { id: 't1', userMessage: 'x', caseTags: ['split:calibration', 'shape:short'] },
      { id: 't2', userMessage: 'y', caseTags: ['split:regression', 'shape:short'] },
    ];
    const testCaseSummaries: TestCaseSummary[] = [
      { testCaseId: 't1', totalRuns: 1, passRate: 1, byModel: {} },
      { testCaseId: 't2', totalRuns: 1, passRate: 0, byModel: {} },
    ];
    seedEval('eval-1', baseConfig(), baseSummary({ testCaseSummaries }), testCases);
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).toContain('## Slice Breakdown');
    expect(md).toContain('**split:**');
    expect(md).toContain('| calibration | 1 | 100.0% |');
    expect(md).toContain('| regression | 1 | 0.0% |');
    expect(md).toContain('**shape:**');
  });

  it('omits the slice section when there are no testCaseSummaries', () => {
    const testCases: TestCase[] = [{ id: 't1', userMessage: 'x', caseTags: ['split:calibration'] }];
    seedEval('eval-1', baseConfig(), baseSummary(), testCases);
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).not.toContain('## Slice Breakdown');
  });
});

describe('ReportService.generateMarkdown — provenance and judge block', () => {
  it('renders benchmark provenance and a missing-qualification note for a summarization judge', () => {
    seedEval('eval-1', baseConfig({ purposeTemplateId: 'summarization', judgeModelId: 'judge-1' }), baseSummary({
      benchmarkProvenance: {
        suiteId: 'memory-summarization-v1', version: '1.0.0', datasetSha256: 'a'.repeat(20),
        reviewStatus: 'approved', includedSplits: ['calibration'], promptVersions: [{ promptId: 'p1', version: 1 }],
      },
    }));
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).toContain('**Benchmark suite:** `memory-summarization-v1`');
    expect(md).toContain('no qualification record');
  });

  it('omits the provenance block entirely when nothing is present', () => {
    seedEval('eval-1', baseConfig(), baseSummary());
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).not.toContain('Benchmark suite');
    expect(md).not.toContain('Judge qualification');
  });
});

describe('ReportService.generateMarkdown — model-selection section', () => {
  function recommendation(): ModelRecommendation {
    return {
      task: 'classification', recommendedModelId: 'winner', runnerUpModelIds: ['runner-up'],
      discardedByGate: [{ modelId: 'loser', reason: 'gate failed' }],
      primaryMetric: { name: 'accuracy', value: 0.92, ci95: [0.88, 0.96] },
      p95LatencyMs: 1200,
      inference: { temperature: 0.3, maxTokens: 1000 },
      promptId: 'p1', promptVersion: 2, suiteId: 'suite-1', suiteVersion: '1.0.0',
      provenance: { taxonomySha256: 'x', datasetSha256: 'y', sourceRevision: 'z' },
      evaluationId: 'eval-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      ordering: {
        tieGroups: [{ rank: 1, modelIds: ['winner', 'runner-up'] }],
        discardedByGate: [{ modelId: 'loser', reason: 'gate failed' }],
        p95LatencyMs: { winner: 1200, 'runner-up': 1500 },
        stability: { winner: { avgOutputTokens: 100 }, 'runner-up': { avgOutputTokens: 120 } },
      },
      confirmation: { ranModelId: 'winner', passed: true },
    };
  }

  it('renders the section for a comparisonMode: "model" eval with a matching recommendation', () => {
    seedEval('eval-1', baseConfig({ comparisonMode: 'model' }), baseSummary());
    writeJson(join(RECOMMENDATIONS_DIR, 'campaign-1-classification.json'), recommendation());
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).toContain('## Model Selection');
    expect(md).toContain('Recommended:** `winner`');
    expect(md).toContain('Discarded by gate');
  });

  it('omits the section when comparisonMode is not "model"', () => {
    seedEval('eval-1', baseConfig({ comparisonMode: 'prompt' }), baseSummary());
    writeJson(join(RECOMMENDATIONS_DIR, 'campaign-1-classification.json'), recommendation());
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).not.toContain('## Model Selection');
  });

  it('omits the section when no recommendation references this evaluation', () => {
    seedEval('eval-1', baseConfig({ comparisonMode: 'model' }), baseSummary());
    const md = ReportService.generateMarkdown('eval-1')!;
    expect(md).not.toContain('## Model Selection');
  });
});
