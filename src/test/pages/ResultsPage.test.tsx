import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResultsPage } from '../../pages/ResultsPage';

vi.mock('../../api/eval', () => ({
  getEvaluationResults: vi.fn().mockResolvedValue({ cells: [] }),
  getEvaluationSummary: vi.fn().mockResolvedValue({
    evalId: 'eval-1',
    totalCells: 0,
    completedCells: 0,
    failedCells: 0,
    modelSummaries: [],
    promptSummaries: [],
  }),
  exportEvaluation: vi.fn(),
  saveBaseline: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderResultsPage() {
  return render(
    <MemoryRouter initialEntries={['/eval/results/eval-1']}>
      <Routes>
        <Route path="/eval/results/:evalId" element={<ResultsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ResultsPage', () => {
  it('renders tab navigation', async () => {
    renderResultsPage();
    // Loading state initially shown, wait for it
    await screen.findByText('Scoreboard');
    expect(screen.getByText('Compare')).toBeInTheDocument();
    expect(screen.getByText('Detail')).toBeInTheDocument();
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
  });

  it('renders export buttons', async () => {
    renderResultsPage();
    await screen.findByText('Scoreboard');
    expect(screen.getByText('MD')).toBeInTheDocument();
    expect(screen.getByText('HTML')).toBeInTheDocument();
  });

  it('renders Save Baseline button', async () => {
    renderResultsPage();
    await screen.findByText('Scoreboard');
    expect(screen.getByText('Save Baseline')).toBeInTheDocument();
  });
});
