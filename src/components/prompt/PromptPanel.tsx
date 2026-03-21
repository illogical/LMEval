import { useRef, useState } from 'react';
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
  modelTag?: string;
  onFileUpload?: (content: string, fileName: string) => void;
  uploadStatus?: 'idle' | 'reading' | 'saving' | 'saved' | 'error';
  uploadError?: string;
  onAdvance?: () => void;
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
  modelTag,
  onFileUpload,
  uploadStatus = 'idle',
  uploadError,
  onAdvance,
}: PromptPanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file.name.match(/\.(md|txt)$/i)) {
      onFileUpload?.('__error__:Only .md and .txt files are supported', file.name);
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      onChange?.(text);
      onFileUpload?.(text, file.name);
    };
    reader.readAsText(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  const panelClass = ['prompt-panel', isDragOver ? 'prompt-panel--dragging' : ''].filter(Boolean).join(' ');

  return (
    <div
      className={panelClass}
      onDragOver={isEditor ? handleDragOver : undefined}
      onDragLeave={isEditor ? handleDragLeave : undefined}
      onDrop={isEditor ? handleDrop : undefined}
    >
      <div className="panel-label">
        <div className="panel-label-text">
          <span>
            Prompt {label}
            {modelTag && <span className="panel-model-tag">· {modelTag}</span>}
          </span>
          <div className="panel-label-actions">
            {!isEditor && status === 'done' && durationMs != null && (
              <span className="panel-duration">{durationMs}ms</span>
            )}
            {isEditor && onAdvance && content.trim() && (
              <button className="advance-button" onClick={onAdvance} title="Use this prompt as Prompt A">
                Use as Prompt A →
              </button>
            )}
          </div>
        </div>
      </div>
      {isEditor ? (
        <>
          <textarea
            className="prompt-textarea"
            value={content}
            onChange={e => onChange?.(e.target.value)}
            placeholder={`Enter system prompt ${label}…`}
            spellCheck={false}
            aria-label={`System prompt ${label}`}
          />
          <div className="upload-hint">
            Drop a .md or .txt file here, or{' '}
            <button
              className="upload-browse"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Browse for file"
            >
              browse
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              hidden
              onChange={handleFileSelect}
              aria-label="Upload prompt file"
            />
          </div>
          {uploadStatus && uploadStatus !== 'idle' && (
            <div className={`upload-progress upload-progress--${uploadStatus}`}>
              {uploadStatus === 'reading' && 'Reading file…'}
              {uploadStatus === 'saving' && 'Saving…'}
              {uploadStatus === 'saved' && '✓ Saved'}
              {uploadStatus === 'error' && (uploadError ?? 'Error saving file')}
            </div>
          )}
        </>
      ) : (
        <ResponseView
          content={response}
          status={status}
          error={error}
        />
      )}
    </div>
  );
}
