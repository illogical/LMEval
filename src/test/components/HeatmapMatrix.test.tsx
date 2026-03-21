import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeatmapMatrix } from '../../components/results/HeatmapMatrix';
import type { EvalMatrixCell } from '../../types/eval';

const mockCell: EvalMatrixCell = {
  id: 'cell-1',
  evalId: 'eval-1',
  promptId: 'prompt-1',
  promptVersion: 1,
  modelId: 'gpt-4',
  testCaseId: 'test-case-1',
  run: 1,
  status: 'completed',
  compositeScore: 4.2,
  durationMs: 1500,
};

describe('HeatmapMatrix', () => {
  it('renders empty state when no cells', () => {
    render(<HeatmapMatrix cells={[]} />);
    expect(screen.getByText('No results yet')).toBeInTheDocument();
  });

  it('renders model headers', () => {
    render(<HeatmapMatrix cells={[mockCell]} />);
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
  });

  it('renders test case labels', () => {
    render(<HeatmapMatrix cells={[mockCell]} />);
    expect(screen.getByText('test-case-1')).toBeInTheDocument();
  });

  it('shows formatted score in cell', () => {
    render(<HeatmapMatrix cells={[mockCell]} />);
    expect(screen.getByText('4.2')).toBeInTheDocument();
  });

  it('calls onCellClick when cell is clicked', () => {
    const onCellClick = vi.fn();
    render(<HeatmapMatrix cells={[mockCell]} onCellClick={onCellClick} />);
    const cell = screen.getByRole('button', { name: /gpt-4/i });
    cell.click();
    expect(onCellClick).toHaveBeenCalledWith(mockCell);
  });
});
