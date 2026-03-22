import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptDiffView } from '../../components/prompt/PromptDiffView';

describe('PromptDiffView', () => {
  it('renders empty state when both empty', () => {
    render(<PromptDiffView contentA="" contentB="" />);
    expect(screen.getByText(/load prompts above/i)).toBeInTheDocument();
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

describe('PromptDiffView - edit toggle', () => {
  it('does not show Edit button when editableB is not passed', () => {
    render(<PromptDiffView contentA="hello" contentB="world" />);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('shows Edit button when editableB is true', () => {
    render(
      <PromptDiffView contentA="hello" contentB="world" editableB draftB="world" onChangeB={() => {}} />
    );
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('defaults to diff mode (no textarea) even with editableB', () => {
    render(
      <PromptDiffView contentA="hello" contentB="world" editableB draftB="world" onChangeB={() => {}} />
    );
    expect(screen.queryByLabelText('Edit Prompt B')).toBeNull();
  });

  it('shows textarea after clicking Edit, hides it after clicking Done', () => {
    render(
      <PromptDiffView contentA="hello" contentB="world" editableB draftB="world" onChangeB={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByLabelText('Edit Prompt B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.queryByLabelText('Edit Prompt B')).toBeNull();
  });
});
