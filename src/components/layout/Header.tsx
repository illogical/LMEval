import type { ServerModelGroup, SelectedModel } from '../../hooks/useModelsByServer';
import { ModelSelector } from '../model/ModelSelector';

interface HeaderProps {
  servers: ServerModelGroup[];
  serversLoading: boolean;
  selectedModels: SelectedModel[];
  onSelectionChange: (models: SelectedModel[]) => void;
  modelStatuses: Record<string, 'idle' | 'loading' | 'done' | 'error'>;
  onNavigateToModel: (model: SelectedModel) => void;
  onRun: () => void;
  runDisabled: boolean;
  runStatus: 'idle' | 'loading' | 'done' | 'error';
  runDurationMs?: number;
}

export function Header({
  servers,
  serversLoading,
  selectedModels,
  onSelectionChange,
  modelStatuses,
  onNavigateToModel,
  onRun,
  runDisabled,
  runStatus,
  runDurationMs,
}: HeaderProps) {
  const statusText = () => {
    if (runStatus === 'loading') return '⏳ Running…';
    if (runStatus === 'done' && runDurationMs != null)
      return `✓ Done in ${(runDurationMs / 1000).toFixed(1)}s`;
    if (runStatus === 'done') return '✓ Done';
    if (runStatus === 'error') return '✗ Error';
    return '';
  };

  const statusClass = `run-status status-${runStatus}`;

  return (
    <header className="app-header">
      <span className="logo">LMEval</span>

      <div className="header-center">
        <ModelSelector
          servers={servers}
          loading={serversLoading}
          selectedModels={selectedModels}
          onSelectionChange={onSelectionChange}
          modelStatuses={modelStatuses}
          onNavigateToModel={onNavigateToModel}
        />
      </div>

      <div className="header-right">
        {runStatus !== 'idle' && (
          <span className={statusClass} aria-live="polite">
            {statusText()}
          </span>
        )}
        <button
          className="run-button"
          onClick={onRun}
          disabled={runDisabled}
          aria-label="Run both prompts"
        >
          Run ▶
        </button>
      </div>
    </header>
  );
}
