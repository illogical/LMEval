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
