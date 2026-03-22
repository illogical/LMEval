import { ModelStatusRow } from './ModelStatusRow';
import type { ModelCellInfo } from './ModelStatusRow';

interface PromptRunCardProps {
  label: string;
  promptName?: string;
  promptPreview?: string;
  models: ModelCellInfo[];
  onRetry?: (modelId: string) => void;
}

export function PromptRunCard({ label, promptName, promptPreview, models, onRetry }: PromptRunCardProps) {
  const displayName = promptName || `Prompt ${label}`;
  const preview = promptPreview
    ? promptPreview.split('\n').slice(0, 3).join('\n') + (promptPreview.split('\n').length > 3 ? '…' : '')
    : null;

  return (
    <div className="prompt-run-card" aria-label={`Prompt ${label} run status`}>
      <div className="prc-header">
        <span className="prc-label">PROMPT {label}</span>
        <span className="prc-name" title={displayName}>{displayName}</span>
      </div>
      {preview && (
        <div className="prc-preview" title={promptPreview}>
          <pre className="prc-preview-text">{preview}</pre>
        </div>
      )}
      <div className="prc-models">
        {models.length === 0 ? (
          <p className="prc-empty">No models selected</p>
        ) : (
          models.map(cell => (
            <ModelStatusRow
              key={`${cell.modelId}-${label}`}
              cell={cell}
              onRetry={onRetry ? () => onRetry(cell.modelId) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
