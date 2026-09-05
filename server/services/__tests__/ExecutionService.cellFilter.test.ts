import { describe, it, expect } from 'vitest';
import { narrowForCellFilter, filterCellsByAllowList } from '../ExecutionService';
import type { EvalMatrixCell, TestCase } from '../../../src/types/eval';

function tc(id: string): TestCase {
  return { id, userMessage: `msg-${id}` };
}

function cell(overrides: Partial<EvalMatrixCell>): EvalMatrixCell {
  return {
    id: overrides.id ?? 'cell-1',
    evalId: 'eval-1',
    promptId: 'p1',
    promptVersion: 1,
    modelId: 'm1',
    testCaseId: 't1',
    run: 1,
    status: 'pending',
    ...overrides,
  };
}

describe('narrowForCellFilter', () => {
  it('narrows prompts/models/test-cases down to exactly what the filter touches', () => {
    const result = narrowForCellFilter(
      ['p1', 'p2'],
      ['m1', 'm2'],
      [tc('t1'), tc('t2'), tc('t3')],
      [{ promptId: 'p1', modelId: 'm1', testCaseId: 't1' }]
    );
    expect(result.promptIds).toEqual(['p1']);
    expect(result.modelIds).toEqual(['m1']);
    expect(result.testCases.map(t => t.id)).toEqual(['t1']);
  });

  it('unions the touched ids across multiple filter triples', () => {
    const result = narrowForCellFilter(
      ['p1', 'p2', 'p3'],
      ['m1', 'm2'],
      [tc('t1'), tc('t2')],
      [
        { promptId: 'p1', modelId: 'm1', testCaseId: 't1' },
        { promptId: 'p2', modelId: 'm2', testCaseId: 't2' },
      ]
    );
    expect(result.promptIds.sort()).toEqual(['p1', 'p2']);
    expect(result.modelIds.sort()).toEqual(['m1', 'm2']);
    expect(result.testCases.map(t => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('drops a prompt/model/test-case not referenced by any filter triple', () => {
    const result = narrowForCellFilter(
      ['p1', 'p2'],
      ['m1'],
      [tc('t1')],
      [{ promptId: 'p1', modelId: 'm1', testCaseId: 't1' }]
    );
    expect(result.promptIds).toEqual(['p1']);
  });
});

describe('filterCellsByAllowList', () => {
  it('keeps only cells whose (promptId, modelId, testCaseId) triple is in the allow-list', () => {
    const cells = [
      cell({ id: 'c1', promptId: 'p1', modelId: 'm1', testCaseId: 't1' }),
      cell({ id: 'c2', promptId: 'p1', modelId: 'm2', testCaseId: 't1' }),
      cell({ id: 'c3', promptId: 'p2', modelId: 'm1', testCaseId: 't1' }),
    ];
    const filtered = filterCellsByAllowList(cells, [{ promptId: 'p1', modelId: 'm1', testCaseId: 't1' }]);
    expect(filtered.map(c => c.id)).toEqual(['c1']);
  });

  it('trims residual cross-product combos beyond the exact requested triples', () => {
    // Two triples naming 2 prompts and 2 models, but not every combo of them —
    // exercises the documented tradeoff: buildMatrix() over a narrowed
    // prompt/model set still cross-produces c1..c4; only the two named
    // triples should survive this final filter.
    const cells = [
      cell({ id: 'c1', promptId: 'p1', modelId: 'm1', testCaseId: 't1' }),
      cell({ id: 'c2', promptId: 'p1', modelId: 'm2', testCaseId: 't1' }),
      cell({ id: 'c3', promptId: 'p2', modelId: 'm1', testCaseId: 't1' }),
      cell({ id: 'c4', promptId: 'p2', modelId: 'm2', testCaseId: 't1' }),
    ];
    const filtered = filterCellsByAllowList(cells, [
      { promptId: 'p1', modelId: 'm1', testCaseId: 't1' },
      { promptId: 'p2', modelId: 'm2', testCaseId: 't1' },
    ]);
    expect(filtered.map(c => c.id).sort()).toEqual(['c1', 'c4']);
  });

  it('returns an empty array when nothing matches', () => {
    const cells = [cell({ id: 'c1' })];
    expect(filterCellsByAllowList(cells, [{ promptId: 'px', modelId: 'mx', testCaseId: 'tx' }])).toEqual([]);
  });
});
