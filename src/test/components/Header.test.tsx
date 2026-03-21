import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../components/layout/Header';
import type { ServerModelGroup, SelectedModel } from '../../hooks/useModelsByServer';

const servers: ServerModelGroup[] = [
  { name: 'alpha', models: ['llama3:latest', 'mistral:7b'] },
];

const selectedModels: SelectedModel[] = [
  { serverName: 'alpha', modelName: 'llama3:latest' },
];

describe('Header', () => {
  it('renders LMEval logo', () => {
    render(
      <Header
        servers={[]}
        serversLoading={false}
        selectedModels={[]}
        onSelectionChange={vi.fn()}
        modelStatuses={{}}
        onNavigateToModel={vi.fn()}
        onRun={vi.fn()}
        runDisabled={false}
        runStatus="idle"
      />
    );
    expect(screen.getByText('LMEval')).toBeInTheDocument();
  });

  it('calls onRun when button is clicked', () => {
    const onRun = vi.fn();
    render(
      <Header
        servers={servers}
        serversLoading={false}
        selectedModels={selectedModels}
        onSelectionChange={vi.fn()}
        modelStatuses={{}}
        onNavigateToModel={vi.fn()}
        onRun={onRun}
        runDisabled={false}
        runStatus="idle"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('disables button when runDisabled is true', () => {
    render(
      <Header
        servers={servers}
        serversLoading={false}
        selectedModels={selectedModels}
        onSelectionChange={vi.fn()}
        modelStatuses={{}}
        onNavigateToModel={vi.fn()}
        onRun={vi.fn()}
        runDisabled={true}
        runStatus="idle"
      />
    );
    expect(screen.getByRole('button', { name: /run/i })).toBeDisabled();
  });

  it('shows loading status text when running', () => {
    render(
      <Header
        servers={servers}
        serversLoading={false}
        selectedModels={selectedModels}
        onSelectionChange={vi.fn()}
        modelStatuses={{}}
        onNavigateToModel={vi.fn()}
        onRun={vi.fn()}
        runDisabled={true}
        runStatus="loading"
      />
    );
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });
});
