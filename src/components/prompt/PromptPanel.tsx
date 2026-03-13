import { ResponseView } from './ResponseView';

interface PromptPanelProps {
  label: string;
  isEditor?: boolean;
  content?: string;
  onChange?: (val: string) => void;
  response?: string | null;
  status?: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  durationMs?: number;
}

export function PromptPanel({
  label,
  isEditor = false,
  content = '',
  onChange,
  response = null,
  status = 'idle',
  error,
  durationMs,
}: PromptPanelProps) {
  return (
    <div className="prompt-panel">
      <div className="panel-label">
        <div className="panel-label-text">
          <span>Prompt {label}</span>
          {!isEditor && status === 'done' && durationMs != null && (
            <span className="panel-duration">{durationMs}ms</span>
          )}
        </div>
      </div>
      {isEditor ? (
        <textarea
          className="prompt-textarea"
          value={content}
          onChange={e => onChange?.(e.target.value)}
          placeholder={`Enter system prompt ${label}…`}
          spellCheck={false}
          aria-label={`System prompt ${label}`}
        />
      ) : (
        <ResponseView
          content={response}
          status={status}
          error={error}
          durationMs={durationMs}
        />
      )}
    </div>
  );
}
