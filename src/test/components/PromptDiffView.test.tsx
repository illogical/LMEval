import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromptDiffView } from '../../components/prompt/PromptDiffView';

describe('PromptDiffView', () => {
  it('renders empty state when both empty', () => {
    render(<PromptDiffView contentA="" contentB="" />);
    expect(screen.getByText(/enter text/i)).toBeInTheDocument();
  });

  it('renders diff header when content present', () => {
    render(<PromptDiffView contentA="hello world" contentB="hello there" />);
    expect(screen.getByText('Prompt A')).toBeInTheDocument();
    expect(screen.getByText('Prompt B')).toBeInTheDocument();
  });

  it('shows content from both sides', () => {
    render(<PromptDiffView contentA="line one\nline two" contentB="line one\nline three" />);
    expect(screen.getByLabelText('Diff view')).toBeInTheDocument();
  });
});
