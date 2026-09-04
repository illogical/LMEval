import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompareView } from '../../components/results/CompareView';
import type { EvalMatrixCell, EvaluationConfig, EvaluationSummary, TestCase } from '../../types/eval';

const config: EvaluationConfig = {
  id: 'eval-1',
  name: 'Test',
  promptIds: ['p1'],
  modelIds: ['m1', 'm2'],
  comparisonMode: 'model',
  status: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const summary: EvaluationSummary = {
  evalId: 'eval-1',
  totalCells: 2,
  completedCells: 2,
  failedCells: 0,
  modelSummaries: [],
  promptSummaries: [],
};

const testCases: TestCase[] = [{ id: 'tc1', userMessage: 'Summarize this document' }];

function makeCells(): EvalMatrixCell[] {
  return [
    { id: 'c1', evalId: 'eval-1', promptId: 'p1', promptVersion: 1, modelId: 'm1', testCaseId: 'tc1', run: 1, status: 'completed', response: 'Response A', compositeScore: 4 },
    { id: 'c2', evalId: 'eval-1', promptId: 'p1', promptVersion: 1, modelId: 'm2', testCaseId: 'tc1', run: 1, status: 'completed', response: 'Response B', compositeScore: 2 },
  ];
}

describe('CompareView', () => {
  it('never allows A and B to select the same axis value', async () => {
    const user = userEvent.setup();
    render(
      <CompareView cells={makeCells()} testCases={testCases} config={config} summary={summary} />
    );

    const selects = screen.getAllByRole('combobox');
    // First two selects after "Compare across" / "Holding" are A and B (model axis, single test case = no prompt-hold selector)
    const aSelect = screen.getByLabelText('A') as HTMLSelectElement;
    const bSelect = screen.getByLabelText('B') as HTMLSelectElement;

    expect(aSelect.value).not.toBe(bSelect.value);

    // Force A to the same value currently held by B — should swap, not collide.
    await user.selectOptions(aSelect, bSelect.value);
    expect(aSelect.value).not.toBe(bSelect.value);
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it('shows both responses once A and B resolve to completed cells', () => {
    render(
      <CompareView cells={makeCells()} testCases={testCases} config={config} summary={summary} />
    );
    expect(screen.getByText('Response A')).toBeInTheDocument();
    expect(screen.getByText('Response B')).toBeInTheDocument();
  });
});
