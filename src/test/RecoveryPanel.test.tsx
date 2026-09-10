import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecoveryPanel } from '../components/dashboard/RecoveryPanel';
import type { EvaluationFeedback } from '../types/eval';

function feedback(state: NonNullable<EvaluationFeedback['recovery']>['state'], reasonCode?: NonNullable<EvaluationFeedback['recovery']>['reasonCode']): EvaluationFeedback {
  return {
    evalId: 'eval-1', status: 'interrupted',
    progress: { total: 10, completed: 3, failed: 0, updatedAt: '' },
    validation: { valid: true, errors: [], warnings: [] }, failures: [],
    readiness: { results: false, summary: false, regression: false, summaryAnalysis: false },
    verdict: null, appBasePath: '/',
    browserPaths: { config: '', run: '', results: '', summary: '' },
    recovery: { state, reasonCode, reusedCells: 3, remainingCells: 7, requiresModelCalls: true },
  };
}

describe('RecoveryPanel', () => {
  it('requires confirmation before resuming and explains checkpoint reuse', () => {
    const onResume = vi.fn();
    render(<RecoveryPanel feedback={feedback('eligible')} onResume={onResume} onFullRerun={() => {}} resuming={false} rerunning={false} />);
    expect(screen.getByText(/3 cells are durably committed; 7 remain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume this evaluation' }));
    expect(onResume).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog', { name: 'Resume this evaluation?' });
    expect(dialog).toHaveTextContent('3 committed cells will be reused and 7 remain');
    expect(dialog).toHaveTextContent('Previously uncommitted in-flight work may run again');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resume' }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('cancelling the confirmation never calls onResume', () => {
    const onResume = vi.fn();
    render(<RecoveryPanel feedback={feedback('eligible')} onResume={onResume} onFullRerun={() => {}} resuming={false} rerunning={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume this evaluation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResume).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('allows resuming a finalization-only recovery without further model calls', () => {
    const onResume = vi.fn();
    render(<RecoveryPanel feedback={feedback('finalization-only')} onResume={onResume} onFullRerun={() => {}} resuming={false} rerunning={false} />);
    expect(screen.getByText(/Finalization can continue without model calls/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume this evaluation' })).toBeEnabled();
  });

  it('blocks resume on a checkpoint integrity failure and shows a human-readable reason', () => {
    render(<RecoveryPanel feedback={feedback('blocked', 'CHECKPOINT_CORRUPT')} onResume={() => {}} onFullRerun={() => {}} resuming={false} rerunning={false} />);
    expect(screen.getByRole('button', { name: 'Resume this evaluation' })).toBeDisabled();
    expect(screen.getByText(/failed an integrity check/)).toBeInTheDocument();
    expect(screen.getByText('CHECKPOINT_CORRUPT')).toBeInTheDocument();
  });

  it('blocks legacy resume while preserving the full-rerun action', () => {
    render(<RecoveryPanel feedback={feedback('legacy-unrecoverable', 'LEGACY_NO_CHECKPOINTS')} onResume={() => {}} onFullRerun={() => {}} resuming={false} rerunning={false} />);
    expect(screen.getByRole('button', { name: 'Resume this evaluation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create a full rerun as a new evaluation' })).toBeEnabled();
    expect(screen.getByText(/diagnostic only/)).toBeInTheDocument();
    expect(screen.getByText(/old progress count cannot be reused/)).toBeInTheDocument();
  });
});
