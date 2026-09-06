import { describe, it, expect } from 'vitest';
import { SummaryService } from '../SummaryService';
import type { EvalMatrixCell, TestCase } from '../../../src/types/eval';

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

describe('SummaryService.computeSummary — new aggregations', () => {
  it('computes testCaseSummaries sorted by ascending pass rate', () => {
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', testCaseId: 'tc1', modelId: 'm1', compositeScore: 5, assertionResults: [{ type: 'icontains', pass: true }] }),
      cell({ id: 'b', testCaseId: 'tc2', modelId: 'm1', compositeScore: 1, assertionResults: [{ type: 'icontains', pass: false }] }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells);
    expect(summary.testCaseSummaries).toBeDefined();
    expect(summary.testCaseSummaries![0].testCaseId).toBe('tc2');
    expect(summary.testCaseSummaries![0].passRate).toBe(0);
    expect(summary.testCaseSummaries![1].testCaseId).toBe('tc1');
    expect(summary.testCaseSummaries![1].passRate).toBe(1);
  });

  it('computes assertionSummary with a sample failure reason, sorted by most-failed first', () => {
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', assertionResults: [{ type: 'icontains', metric: 'greeting', pass: false, reason: 'missing "hello"' }] }),
      cell({ id: 'b', assertionResults: [{ type: 'icontains', metric: 'greeting', pass: false, reason: 'missing "hi"' }] }),
      cell({ id: 'c', assertionResults: [{ type: 'json-schema', pass: true }] }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells);
    expect(summary.assertionSummary).toBeDefined();
    expect(summary.assertionSummary![0].metric).toBe('greeting');
    expect(summary.assertionSummary![0].failed).toBe(2);
    expect(summary.assertionSummary![0].sampleReason).toBe('missing "hello"');
  });

  it('omits consistency when runsPerCell is 1 or unset', () => {
    const cells: EvalMatrixCell[] = [cell({ compositeScore: 3 })];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, { runsPerCell: 1 });
    expect(summary.consistency).toBeUndefined();
  });

  it('computes consistency when runsPerCell > 1', () => {
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', run: 1, compositeScore: 4 }),
      cell({ id: 'b', run: 2, compositeScore: 2 }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, { runsPerCell: 2 });
    expect(summary.consistency).toBeDefined();
    expect(summary.consistency!['m1']).toBeCloseTo(1, 5);
  });

  it('orders perspectiveIds by the given template order, appending any extras', () => {
    const cells: EvalMatrixCell[] = [
      cell({
        judgeResults: [
          { perspectiveId: 'Conciseness', score: 4, justification: '' },
          { perspectiveId: 'Accuracy', score: 5, justification: '' },
        ],
      }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      perspectiveOrder: ['Accuracy', 'Conciseness'],
    });
    expect(summary.perspectiveIds).toEqual(['Accuracy', 'Conciseness']);
  });

  it('leaves the new optional fields undefined for an empty cell set', () => {
    const summary = SummaryService.computeSummary('eval-1', []);
    expect(summary.testCaseSummaries).toBeUndefined();
    expect(summary.assertionSummary).toBeUndefined();
    expect(summary.perspectiveIds).toBeUndefined();
    expect(summary.truncationRate).toBeUndefined();
  });
});

describe('SummaryService.computeSummary - benchmark review guard', () => {
  it('forces task verdicts to advisory while benchmark ground truth is pending review', () => {
    const testCases: TestCase[] = [{ id: 't1', userMessage: 'x', expectedOutput: 'Note' }];
    const summary = SummaryService.computeSummary('eval-1', [cell({
      testCaseId: 't1', response: 'Note', assertionResults: [{ type: 'equals', pass: true, score: 1 }],
    })], undefined, {
      testCases,
      purposeCategory: 'classification',
      assertionStrategy: { type: 'exact-label', config: { labels: ['Note'] } },
      benchmarkProvenance: {
        suiteId: 'memory-classification-v1',
        version: '1.0.0',
        datasetSha256: 'abc',
        reviewStatus: 'pending-human-review',
        includedSplits: ['calibration'],
        promptVersions: [{ promptId: 'p1', version: 1 }],
      },
    });
    expect(summary.benchmarkProvenance?.suiteId).toBe('memory-classification-v1');
    expect(summary.taskMetrics?.gate).toMatchObject({ pass: false, verdict: 'advisory' });
    expect(summary.taskMetrics?.gate.failures).toContain('Benchmark ground truth is pending human review.');
  });
});

describe('SummaryService.computeSummary — truncation rate', () => {
  it('excludes cells with no captured finishReason from the denominator', () => {
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', finishReason: 'stop' }),
      cell({ id: 'b', status: 'failed' }), // no finishReason
    ];
    const summary = SummaryService.computeSummary('eval-1', cells);
    expect(summary.truncationRate).toBe(0);
  });

  it('counts a non-stop finishReason as truncated', () => {
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', finishReason: 'stop' }),
      cell({ id: 'b', finishReason: 'length' }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells);
    expect(summary.truncationRate).toBe(0.5);
  });

  it('leaves truncationRate undefined when no cell has a finishReason', () => {
    const cells: EvalMatrixCell[] = [cell({ id: 'a' })];
    const summary = SummaryService.computeSummary('eval-1', cells);
    expect(summary.truncationRate).toBeUndefined();
  });

  it('mirrors resolvedInference and transportProvenance from options', () => {
    const cells: EvalMatrixCell[] = [cell({ id: 'a' })];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      resolvedInference: { temperature: 0.3, maxTokens: 1000, source: 'purposeTemplate' },
      transportProvenance: { endpointPaths: ['/api/chat/completions/any'], messageShape: 'chat-messages', seedHonored: false },
    });
    expect(summary.resolvedInference).toEqual({ temperature: 0.3, maxTokens: 1000, source: 'purposeTemplate' });
    expect(summary.transportProvenance?.endpointPaths).toEqual(['/api/chat/completions/any']);
  });
});

describe('SummaryService.computeSummary — R4 classification taskMetrics', () => {
  const labels = ['Preference', 'Reminder', 'Snippet'];
  function tc(id: string, expectedOutput: string): TestCase {
    return { id, userMessage: 'x', expectedOutput };
  }

  it('computes accuracy/macroF1/confusion matrix and fails the gate on an invalid label', () => {
    const testCases = [tc('t1', 'Preference'), tc('t2', 'Reminder'), tc('t3', 'Snippet')];
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', testCaseId: 't1', response: 'Preference' }),
      cell({ id: 'b', testCaseId: 't2', response: 'Preference' }), // wrong: Reminder misclassified as Preference
      cell({ id: 'c', testCaseId: 't3', response: 'Code snippet' }), // invalid label (not in declared set)
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'classification',
      assertionStrategy: { type: 'exact-label', config: { labels } },
    });
    const tm = summary.taskMetrics;
    expect(tm?.taskType).toBe('classification');
    if (tm?.taskType !== 'classification') throw new Error('expected classification metrics');
    expect(tm.accuracy).toBeCloseTo(1 / 3);
    expect(tm.invalidLabelRate).toBeCloseTo(1 / 3);
    expect(tm.formatComplianceRate).toBeCloseTo(2 / 3);
    expect(tm.confusionMatrix['Reminder']['Preference']).toBe(1);
    expect(tm.confusionMatrix['Snippet']['INVALID']).toBe(1);
    expect(tm.gate.pass).toBe(false);
    expect(tm.gate.failures.length).toBeGreaterThan(0);
  });

  it('passes the gate when every case is correctly and validly labeled', () => {
    const testCases = [tc('t1', 'Preference'), tc('t2', 'Reminder')];
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', testCaseId: 't1', response: 'Preference' }),
      cell({ id: 'b', testCaseId: 't2', response: 'Reminder' }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'classification',
      assertionStrategy: { type: 'exact-label', config: { labels } },
    });
    const tm = summary.taskMetrics;
    if (tm?.taskType !== 'classification') throw new Error('expected classification metrics');
    expect(tm.accuracy).toBe(1);
    expect(tm.macroF1).toBe(1);
    expect(tm.invalidLabelRate).toBe(0);
    expect(tm.formatComplianceRate).toBe(1);
    expect(tm.gate.pass).toBe(true);
  });

  it('computes runToRunAgreement across repeated runs of the same cell', () => {
    const testCases = [tc('t1', 'Preference')];
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', testCaseId: 't1', run: 1, response: 'Preference' }),
      cell({ id: 'b', testCaseId: 't1', run: 2, response: 'Reminder' }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'classification',
      assertionStrategy: { type: 'exact-label', config: { labels } },
      runsPerCell: 2,
    });
    const tm = summary.taskMetrics;
    if (tm?.taskType !== 'classification') throw new Error('expected classification metrics');
    expect(tm.runToRunAgreement).toBe(0);
  });
});

describe('SummaryService.computeSummary — R5 tagging taskMetrics', () => {
  const vocabulary = ['Family', 'Reminder', 'Food', 'Favorite'];
  function tc(id: string, tags: string[]): TestCase {
    return { id, userMessage: 'x', expectedLabels: tags };
  }

  it('computes TP/FP/FN-derived precision/recall/F1, Jaccard, and unknown/duplicate rates without repairing raw output', () => {
    const testCases = [tc('t1', ['Family', 'Reminder'])];
    const cells: EvalMatrixCell[] = [
      // predicted: Family, Family (duplicate), Nonexistent (unknown) — misses Reminder (FN)
      cell({ id: 'a', testCaseId: 't1', response: 'Family, Family, Nonexistent' }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'tagging',
      assertionStrategy: { type: 'label-overlap', config: { vocabulary, minimumCaseF1: 0.5 } },
    });
    const tm = summary.taskMetrics;
    if (tm?.taskType !== 'tagging') throw new Error('expected tagging metrics');
    // predictedSet (deduped) = {Family, Nonexistent}; expectedSet = {Family, Reminder}
    // TP=1 (Family), FP=1 (Nonexistent), FN=1 (Reminder)
    expect(tm.microPrecision).toBeCloseTo(0.5);
    expect(tm.microRecall).toBeCloseTo(0.5);
    expect(tm.jaccardMean).toBeCloseTo(1 / 3); // union = {Family, Nonexistent, Reminder}
    expect(tm.exactSetMatchRate).toBe(0);
    expect(tm.unknownTagRate).toBeCloseTo(1 / 3); // 1 unknown of 3 raw tokens
    expect(tm.duplicateTagRate).toBeCloseTo(1 / 3); // 1 duplicate of 3 raw tokens
    expect(tm.gate.pass).toBe(false); // unknown-tag rate > 0 fails the gate
  });

  it('reports an exact-set match and zero unknown/duplicate rate on a clean response', () => {
    const testCases = [tc('t1', ['Family', 'Reminder'])];
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', testCaseId: 't1', response: 'Family, Reminder' }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'tagging',
      assertionStrategy: { type: 'label-overlap', config: { vocabulary, minimumCaseF1: 0.5 } },
    });
    const tm = summary.taskMetrics;
    if (tm?.taskType !== 'tagging') throw new Error('expected tagging metrics');
    expect(tm.exactSetMatchRate).toBe(1);
    expect(tm.unknownTagRate).toBe(0);
    expect(tm.duplicateTagRate).toBe(0);
    expect(tm.microF1).toBe(1);
  });
});

describe('SummaryService.computeSummary — R6 summarization taskMetrics', () => {
  function tc(id: string, userMessage: string, extra: Partial<TestCase> = {}): TestCase {
    return { id, userMessage, ...extra };
  }

  it('flags the self-judge guard and surfaces it as a gate failure', () => {
    const testCases = [tc('t1', 'a'.repeat(100))];
    const cells: EvalMatrixCell[] = [
      cell({
        id: 'a',
        testCaseId: 't1',
        response: 'a'.repeat(30),
        assertionResults: [
          { type: 'llm-rubric', metric: 'Faithfulness#1', pass: true, score: 1 },
          { type: 'llm-rubric', metric: 'Faithfulness#2', pass: true, score: 1 },
          { type: 'llm-rubric', metric: 'Faithfulness#3', pass: true, score: 1 },
        ],
      }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'summarization',
      assertionStrategy: { type: 'grounded-summary', config: { templateId: 'summarization-quality' } },
      selfJudgeGuardViolated: true,
    });
    const tm = summary.taskMetrics;
    if (tm?.taskType !== 'summarization') throw new Error('expected summarization metrics');
    expect(tm.selfJudgeGuardViolated).toBe(true);
    expect(tm.gate.pass).toBe(false);
    expect(tm.gate.failures.some(f => f.includes('advisory'))).toBe(true);
  });

  it('medians three judge passes per perspective and computes the weighted score', () => {
    const testCases = [tc('t1', 'a'.repeat(100))];
    const cells: EvalMatrixCell[] = [
      cell({
        id: 'a',
        testCaseId: 't1',
        response: 'a'.repeat(30),
        assertionResults: [
          // scores 0,0.5,1 -> rescaled 1,3,5 -> median 3
          { type: 'llm-rubric', metric: 'Faithfulness#1', pass: true, score: 0 },
          { type: 'llm-rubric', metric: 'Faithfulness#2', pass: true, score: 0.5 },
          { type: 'llm-rubric', metric: 'Faithfulness#3', pass: true, score: 1 },
        ],
      }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'summarization',
      assertionStrategy: { type: 'grounded-summary', config: { templateId: 'summarization-quality' } },
    });
    const tm = summary.taskMetrics;
    if (tm?.taskType !== 'summarization') throw new Error('expected summarization metrics');
    expect(tm.medianRubric.faithfulness).toBeCloseTo(3);
  });

  it('runs deterministic checks (preamble/compression/protected tokens/forbidden claims) independent of the judge', () => {
    const testCases = [tc('t1', 'a'.repeat(100), { protectedTokens: ['ACME-123'], forbiddenClaims: ['fired'] })];
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', testCaseId: 't1', response: 'Here is a summary: the employee was fired.' }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'summarization',
      assertionStrategy: { type: 'grounded-summary', config: { templateId: 'summarization-quality' } },
    });
    const tm = summary.taskMetrics;
    if (tm?.taskType !== 'summarization') throw new Error('expected summarization metrics');
    expect(tm.deterministic.noPreambleRate).toBe(0); // "Here is a summary:" is a preamble
    expect(tm.deterministic.protectedTokensPreservedRate).toBe(0); // ACME-123 missing
    expect(tm.deterministic.noForbiddenClaimsRate).toBe(0); // contains "fired"
    expect(tm.gate.pass).toBe(false);
  });
});

describe('SummaryService.computeSummary — A9 perModelTaskMetrics', () => {
  const labels = ['Preference', 'Reminder'];
  function tc(id: string, expectedOutput: string): TestCase {
    return { id, userMessage: 'x', expectedOutput };
  }

  it('computes a per-model breakdown for comparisonMode: "model" with more than one model', () => {
    const testCases = [tc('t1', 'Preference'), tc('t2', 'Reminder')];
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', modelId: 'm1', testCaseId: 't1', response: 'Preference' }),
      cell({ id: 'b', modelId: 'm1', testCaseId: 't2', response: 'Preference' }), // wrong
      cell({ id: 'c', modelId: 'm2', testCaseId: 't1', response: 'Preference' }),
      cell({ id: 'd', modelId: 'm2', testCaseId: 't2', response: 'Reminder' }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'classification',
      assertionStrategy: { type: 'exact-label', config: { labels } },
      comparisonMode: 'model',
    });

    expect(summary.perModelTaskMetrics).toBeDefined();
    const m1 = summary.perModelTaskMetrics!['m1'];
    const m2 = summary.perModelTaskMetrics!['m2'];
    if (m1.taskType !== 'classification' || m2.taskType !== 'classification') throw new Error('expected classification metrics');
    expect(m1.accuracy).toBeCloseTo(0.5);
    expect(m2.accuracy).toBe(1);

    // The whole-run taskMetrics field is unaffected — still computed the same way it always has been.
    expect(summary.taskMetrics).toBeDefined();
  });

  it('is absent for a single-model run', () => {
    const testCases = [tc('t1', 'Preference')];
    const cells: EvalMatrixCell[] = [cell({ id: 'a', modelId: 'm1', testCaseId: 't1', response: 'Preference' })];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'classification',
      assertionStrategy: { type: 'exact-label', config: { labels } },
      comparisonMode: 'model',
    });
    expect(summary.perModelTaskMetrics).toBeUndefined();
  });

  it('is absent for a prompt-comparison run even with multiple models present', () => {
    const testCases = [tc('t1', 'Preference')];
    const cells: EvalMatrixCell[] = [
      cell({ id: 'a', modelId: 'm1', testCaseId: 't1', response: 'Preference' }),
      cell({ id: 'b', modelId: 'm2', testCaseId: 't1', response: 'Preference' }),
    ];
    const summary = SummaryService.computeSummary('eval-1', cells, undefined, {
      testCases,
      purposeCategory: 'classification',
      assertionStrategy: { type: 'exact-label', config: { labels } },
      comparisonMode: 'prompt',
    });
    expect(summary.perModelTaskMetrics).toBeUndefined();
  });
});
