import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendView } from '../../components/results/TrendView';
import type { EvaluationConfig, EvaluationSummary } from '../../types/eval';

const config: EvaluationConfig = {
  id: 'eval-1',
  name: 'Test',
  promptIds: ['p1'],
  modelIds: ['m1'],
  comparisonMode: 'model',
  status: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const summary: EvaluationSummary = {
  evalId: 'eval-1',
  totalCells: 1,
  completedCells: 1,
  failedCells: 0,
  modelSummaries: [
    { modelId: 'm1', avgCompositeScore: 4, avgDurationMs: 500, avgInputTokens: 10, avgOutputTokens: 10, avgTokensPerSecond: 5, successRate: 1 },
  ],
  promptSummaries: [],
};

describe('TrendView', () => {
  it('renders an honest empty state instead of a one-point chart when history has fewer than 2 runs', () => {
    render(
      <TrendView history={[]} evalId="eval-1" summary={summary} config={config} onSaveBaseline={vi.fn()} />
    );
    expect(screen.getByText(/This is the first run/)).toBeInTheDocument();
    expect(screen.queryByText(/Composite score across/)).not.toBeInTheDocument();
  });

  it('renders a real chart once at least 2 history points exist', () => {
    render(
      <TrendView
        history={[
          { evalId: 'eval-0', date: '2026-01-01T00:00:00.000Z', modelScores: { m1: 3 }, promptScores: {} },
          { evalId: 'eval-1', date: '2026-01-02T00:00:00.000Z', modelScores: { m1: 4 }, promptScores: {} },
        ]}
        evalId="eval-1"
        summary={summary}
        config={config}
        onSaveBaseline={vi.fn()}
      />
    );
    expect(screen.getByText(/Composite score across 2 completed runs/)).toBeInTheDocument();
  });
});
