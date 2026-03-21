import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptPanel } from '../../components/prompt/PromptPanel';

describe('PromptPanel - editor mode', () => {
  it('renders a textarea in editor mode', () => {
    render(<PromptPanel label="A" isEditor content="test prompt" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /system prompt a/i })).toBeInTheDocument();
  });

  it('calls onChange when textarea value changes', () => {
    const onChange = vi.fn();
    render(<PromptPanel label="A" isEditor content="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: /system prompt a/i }), { target: { value: 'new value' } });
    expect(onChange).toHaveBeenCalledWith('new value');
  });

  it('displays the panel label', () => {
    render(<PromptPanel label="B" isEditor content="" onChange={vi.fn()} />);
    expect(screen.getByText(/prompt b/i)).toBeInTheDocument();
  });
});

describe('PromptPanel - response mode', () => {
  it('shows idle hint when status is idle', () => {
    render(<PromptPanel label="A" response={null} status="idle" />);
    expect(screen.getByText(/response will appear here/i)).toBeInTheDocument();
  });

  it('shows duration when done and durationMs is provided', () => {
    render(<PromptPanel label="A" response="hello" status="done" durationMs={1234} />);
    expect(screen.getByText('1234ms')).toBeInTheDocument();
  });
});

describe('PromptPanel - upload status display', () => {
  it('shows nothing when uploadStatus is idle', () => {
    render(<PromptPanel label="A" isEditor content="" onChange={vi.fn()} uploadStatus="idle" />);
    expect(document.querySelector('.upload-progress')).toBeNull();
  });

  it('shows "Saving…" when uploadStatus is saving', () => {
    render(<PromptPanel label="A" isEditor content="" onChange={vi.fn()} uploadStatus="saving" />);
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });

  it('shows "✓ Saved" when uploadStatus is saved', () => {
    render(<PromptPanel label="A" isEditor content="" onChange={vi.fn()} uploadStatus="saved" />);
    expect(screen.getByText('✓ Saved')).toBeInTheDocument();
  });

  it('shows error message with uploadError when uploadStatus is error', () => {
    render(<PromptPanel label="A" isEditor content="" onChange={vi.fn()} uploadStatus="error" uploadError="EACCES: permission denied" />);
    expect(screen.getByText(/EACCES: permission denied/)).toBeInTheDocument();
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
  });

  it('shows fallback text when uploadStatus is error and no uploadError', () => {
    render(<PromptPanel label="A" isEditor content="" onChange={vi.fn()} uploadStatus="error" />);
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Unknown error/)).toBeInTheDocument();
  });
});

describe('PromptPanel - advance button', () => {
  it('does not show advance button when content is empty', () => {
    render(<PromptPanel label="B" isEditor content="" onChange={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /use as prompt a/i })).toBeNull();
  });

  it('does not show advance button when onAdvance is not provided', () => {
    render(<PromptPanel label="B" isEditor content="some content" onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /use as prompt a/i })).toBeNull();
  });

  it('shows advance button when content exists and onAdvance is provided', () => {
    render(<PromptPanel label="B" isEditor content="some content" onChange={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.getByRole('button', { name: /use as prompt a/i })).toBeInTheDocument();
  });

  it('calls onAdvance when advance button is clicked', () => {
    const onAdvance = vi.fn();
    render(<PromptPanel label="B" isEditor content="some content" onChange={vi.fn()} onAdvance={onAdvance} />);
    fireEvent.click(screen.getByRole('button', { name: /use as prompt a/i }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });
});
