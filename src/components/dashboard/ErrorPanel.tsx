import { RefreshCw, AlertTriangle } from 'lucide-react';

export interface CellFailure {
  cellId: string;
  modelId: string;
  promptId: string;
  error: string;
}

interface ErrorPanelProps {
  failures: CellFailure[];
  evalId: string;
  onRetry: () => void;
  retrying?: boolean;
}

export function ErrorPanel({ failures, onRetry, retrying = false }: ErrorPanelProps) {
  if (failures.length === 0) return null;

  return (
    <div className="error-panel" role="alert" aria-label="Evaluation errors">
      <div className="ep-header">
        <AlertTriangle size={16} className="ep-icon" aria-hidden="true" />
        <span className="ep-title">
          {failures.length} cell{failures.length !== 1 ? 's' : ''} failed
        </span>
        <button
          className="ep-retry-btn"
          onClick={onRetry}
          disabled={retrying}
          aria-label="Retry failed cells"
        >
          <RefreshCw size={14} />
          {retrying ? 'Retrying…' : 'Retry Failed Cells'}
        </button>
      </div>
      <ul className="ep-list">
        {failures.map(f => {
          const modelName = f.modelId.includes('::') ? f.modelId.split('::')[1] : f.modelId;
          const serverName = f.modelId.includes('::') ? f.modelId.split('::')[0] : undefined;
          return (
            <li key={f.cellId} className="ep-item">
              <span className="ep-item-model">{modelName}</span>
              {serverName && <span className="ep-item-server">({serverName})</span>}
              <span className="ep-item-arrow">→</span>
              <span className="ep-item-error">{f.error}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
