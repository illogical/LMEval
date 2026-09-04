import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BreakdownView } from '../../components/results/BreakdownView';
import type { EvaluationSummary } from '../../types/eval';

describe('BreakdownView', () => {
  it('renders stat tiles instead of a scatter chart when only one model ran', () => {
    const summary: EvaluationSummary = {
      evalId: 'eval-1',
      totalCells: 1,
      completedCells: 1,
      failedCells: 0,
      modelSummaries: [
        { modelId: 'server::model-a', avgCompositeScore: 4.2, avgDurationMs: 1000, avgInputTokens: 10, avgOutputTokens: 20, avgTokensPerSecond: 7, successRate: 1 },
      ],
      promptSummaries: [],
    };
    render(<BreakdownView summary={summary} testCases={[]} />);
    // Single-model case: no chart, a labeled stat tile instead.
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('4.2')).toBeInTheDocument();
  });

  it('shows an all-pass message instead of a chart when every test case passed', () => {
    const summary: EvaluationSummary = {
      evalId: 'eval-1',
      totalCells: 2,
      completedCells: 2,
      failedCells: 0,
      modelSummaries: [
        { modelId: 'm1', avgCompositeScore: 4, avgDurationMs: 500, avgInputTokens: 10, avgOutputTokens: 10, avgTokensPerSecond: 5, successRate: 1 },
        { modelId: 'm2', avgCompositeScore: 4, avgDurationMs: 500, avgInputTokens: 10, avgOutputTokens: 10, avgTokensPerSecond: 5, successRate: 1 },
      ],
      promptSummaries: [],
      testCaseSummaries: [
        { testCaseId: 'tc1', totalRuns: 2, passRate: 1, avgCompositeScore: 4, byModel: {} },
      ],
    };
    render(<BreakdownView summary={summary} testCases={[]} />);
    expect(screen.getByText(/All 1 test case passed/)).toBeInTheDocument();
  });
});
