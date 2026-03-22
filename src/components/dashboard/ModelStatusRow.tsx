import { RefreshCw } from 'lucide-react';
import { formatLatency } from '../../lib/scoring';

export type ModelCellStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ModelCellInfo {
  modelId: string;
  serverName?: string;
  status: ModelCellStatus;
  durationMs?: number;
  tokensPerSecond?: number;
  error?: string;
  elapsedMs?: number;
}

interface ModelStatusRowProps {
  cell: ModelCellInfo;
  onRetry?: () => void;
}

export function ModelStatusRow({ cell, onRetry }: ModelStatusRowProps) {
  const modelName = cell.modelId.includes('::')
    ? cell.modelId.split('::')[1]
    : cell.modelId.split('/').pop() ?? cell.modelId;

  const server = cell.serverName ?? (cell.modelId.includes('::') ? cell.modelId.split('::')[0] : undefined);

  return (
    <div className={`model-status-row msr-${cell.status}`} aria-label={`${modelName} status: ${cell.status}`}>
      <div className="msr-left">
        <span className="msr-status-icon" aria-hidden="true">
          {cell.status === 'completed' && '✓'}
          {cell.status === 'failed' && '✗'}
          {cell.status === 'running' && <span className="msr-spinner" />}
          {cell.status === 'pending' && '⏳'}
        </span>
        <div className="msr-info">
          <span className="msr-model-name">{modelName}</span>
          {server && <span className="msr-server">{server}</span>}
        </div>
      </div>
      <div className="msr-right">
        {cell.status === 'completed' && (
          <span className="msr-metrics">
            {cell.durationMs != null && <span>{formatLatency(cell.durationMs)}</span>}
            {cell.tokensPerSecond != null && <span>{cell.tokensPerSecond.toFixed(0)} tok/s</span>}
          </span>
        )}
        {cell.status === 'failed' && (
          <>
            <span className="msr-error" title={cell.error}>{cell.error ?? 'Failed'}</span>
            {onRetry && (
              <button
                className="msr-retry-btn"
                onClick={onRetry}
                title="Retry this model"
                aria-label={`Retry ${modelName}`}
              >
                <RefreshCw size={12} />
              </button>
            )}
          </>
        )}
        {cell.status === 'running' && cell.elapsedMs != null && (
          <span className="msr-elapsed">{(cell.elapsedMs / 1000).toFixed(1)}s</span>
        )}
      </div>
    </div>
  );
}
