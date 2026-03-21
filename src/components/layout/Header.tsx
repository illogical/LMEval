import type { ModelOption } from '../../hooks/useModels';

interface HeaderProps {
  models: ModelOption[];
  modelsLoading: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onRun: () => void;
  runDisabled: boolean;
  runStatus: 'idle' | 'loading' | 'done' | 'error';
  runDurationMs?: number;
}

// Group models by serverName
function groupByServer(models: ModelOption[]): Map<string, ModelOption[]> {
  const map = new Map<string, ModelOption[]>();
  for (const m of models) {
    const group = map.get(m.serverName) ?? [];
    group.push(m);
    map.set(m.serverName, group);
  }
  return map;
}

export function Header({
  models,
  modelsLoading,
  selectedModel,
  onModelChange,
  onRun,
  runDisabled,
  runStatus,
  runDurationMs,
}: HeaderProps) {
  const grouped = groupByServer(models);

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
        <select
          className="model-select"
          value={selectedModel}
          onChange={e => onModelChange(e.target.value)}
          disabled={modelsLoading || models.length === 0}
          aria-label="Select model"
        >
          {modelsLoading && (
            <option value="" disabled>
              Loading models…
            </option>
          )}
          {!modelsLoading && models.length === 0 && (
            <option value="" disabled>
              No models available
            </option>
          )}
          {Array.from(grouped.entries()).map(([server, opts]) => (
            <optgroup key={server} label={server}>
              {opts.map(m => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="header-right">
        <button
          className="run-button"
          onClick={onRun}
          disabled={runDisabled}
          aria-label="Run both prompts"
        >
          Run Both ▶
        </button>
        {runStatus !== 'idle' && (
          <span className={statusClass} aria-live="polite">
            {statusText()}
          </span>
        )}
      </div>
    </header>
  );
}
