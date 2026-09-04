import { describe, it, expect } from 'vitest';
import { SummaryService } from '../SummaryService';
import type { EvalMatrixCell } from '../../../src/types/eval';

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
