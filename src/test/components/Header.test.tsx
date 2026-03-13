import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../components/layout/Header';
import type { ModelOption } from '../../hooks/useModels';

const models: ModelOption[] = [
  { value: 'llama3:latest', label: 'llama3:latest', serverName: 'alpha' },
  { value: 'mistral:7b', label: 'mistral:7b', serverName: 'alpha' },
];

describe('Header', () => {
  it('renders LMEval logo', () => {
    render(<Header models={[]} modelsLoading={false} selectedModel="" onModelChange={vi.fn()} onRun={vi.fn()} runDisabled={false} runStatus="idle" />);
    expect(screen.getByText('LMEval')).toBeInTheDocument();
  });

  it('renders model options grouped by server', () => {
    render(<Header models={models} modelsLoading={false} selectedModel="llama3:latest" onModelChange={vi.fn()} onRun={vi.fn()} runDisabled={false} runStatus="idle" />);
    expect(screen.getByRole('option', { name: 'llama3:latest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'mistral:7b' })).toBeInTheDocument();
  });

  it('calls onRun when button is clicked', () => {
    const onRun = vi.fn();
    render(<Header models={models} modelsLoading={false} selectedModel="llama3:latest" onModelChange={vi.fn()} onRun={onRun} runDisabled={false} runStatus="idle" />);
    fireEvent.click(screen.getByRole('button', { name: /run both/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('disables button when runDisabled is true', () => {
    render(<Header models={models} modelsLoading={false} selectedModel="llama3:latest" onModelChange={vi.fn()} onRun={vi.fn()} runDisabled={true} runStatus="idle" />);
    expect(screen.getByRole('button', { name: /run both/i })).toBeDisabled();
  });

  it('shows loading status text when running', () => {
    render(<Header models={models} modelsLoading={false} selectedModel="llama3:latest" onModelChange={vi.fn()} onRun={vi.fn()} runDisabled={true} runStatus="loading" />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });
});
