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

  it('states the total in plain English', () => {
    render(<ExecutionPreview promptCount={2} modelCount={3} testCaseCount={4} runsPerCell={1} />);
    expect(screen.getByText('24 total LLM calls')).toBeInTheDocument();
  });

  it('counts judge calls separately when a rubric is graded', () => {
    render(
      <ExecutionPreview
        promptCount={1} modelCount={2} testCaseCount={3} runsPerCell={1}
        judgePerspectiveCount={3}
      />
    );
    expect(screen.getByText('6 completions + 18 judge calls = 24 total LLM calls')).toBeInTheDocument();
  });

  it('singularizes a one-call matrix', () => {
    render(<ExecutionPreview promptCount={1} modelCount={1} testCaseCount={1} runsPerCell={1} />);
    expect(screen.getByText('1 total LLM call')).toBeInTheDocument();
  });

  it('labels each matrix factor', () => {
    render(<ExecutionPreview promptCount={2} modelCount={3} testCaseCount={4} runsPerCell={2} />);
    expect(screen.getByText('2 prompts')).toBeInTheDocument();
    expect(screen.getByText('3 models')).toBeInTheDocument();
    expect(screen.getByText('4 test cases')).toBeInTheDocument();
    expect(screen.getByText('2 runs per cell')).toBeInTheDocument();
  });

  it('warns that a single run per cell cannot separate signal from noise', () => {
    render(<ExecutionPreview promptCount={1} modelCount={2} testCaseCount={2} runsPerCell={1} />);
    expect(screen.getByText(/within noise/i)).toBeInTheDocument();
  });

  it('omits the noise hint when runs per cell is above 1', () => {
    render(<ExecutionPreview promptCount={1} modelCount={2} testCaseCount={2} runsPerCell={3} />);
    expect(screen.queryByText(/within noise/i)).not.toBeInTheDocument();
  });

  it('counts judge calls toward the large-matrix warning', () => {
    render(
      <ExecutionPreview
        promptCount={1} modelCount={2} testCaseCount={5} runsPerCell={1}
        judgePerspectiveCount={5}
      />
    );
    // 10 completions alone would not warn; 10 + 50 judge calls does.
    expect(screen.getByText(/large matrix/i)).toBeInTheDocument();
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
