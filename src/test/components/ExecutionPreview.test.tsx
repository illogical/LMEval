import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionPreview } from '../../components/config/ExecutionPreview';

describe('ExecutionPreview', () => {
  it('renders matrix dimensions', () => {
    render(<ExecutionPreview promptCount={2} modelCount={3} testCaseCount={4} runsPerCell={1} />);
    expect(screen.getByText('2P')).toBeInTheDocument();
    expect(screen.getByText('3M')).toBeInTheDocument();
    expect(screen.getByText('4T')).toBeInTheDocument();
    expect(screen.getByText('1R')).toBeInTheDocument();
    expect(screen.getByText('24 completions')).toBeInTheDocument();
  });

  it('shows warning for large matrix', () => {
    render(<ExecutionPreview promptCount={4} modelCount={5} testCaseCount={4} runsPerCell={1} />);
    expect(screen.getByText(/large matrix/i)).toBeInTheDocument();
  });

  it('does not show warning for small matrix', () => {
    render(<ExecutionPreview promptCount={1} modelCount={2} testCaseCount={3} runsPerCell={1} />);
    expect(screen.queryByText(/large matrix/i)).not.toBeInTheDocument();
  });

  it('has correct aria-label', () => {
    render(<ExecutionPreview promptCount={1} modelCount={1} testCaseCount={1} runsPerCell={1} />);
    expect(screen.getByLabelText('Execution preview')).toBeInTheDocument();
  });
});
