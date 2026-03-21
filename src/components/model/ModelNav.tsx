import { useEffect } from 'react';
import type { SelectedModel } from '../../hooks/useModelsByServer';
import { modelKey } from '../../hooks/useModelsByServer';
import './ModelNav.css';

interface ModelNavProps {
  models: SelectedModel[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  statuses: Record<string, 'idle' | 'loading' | 'done' | 'error'>;
}

function statusBadge(status: 'idle' | 'loading' | 'done' | 'error' | undefined) {
  if (!status || status === 'idle') return null;
  if (status === 'loading') return <span className="mn-badge mn-badge-loading" aria-label="running">⏳</span>;
  if (status === 'done') return <span className="mn-badge mn-badge-done" aria-label="done">✓</span>;
  if (status === 'error') return <span className="mn-badge mn-badge-error" aria-label="error">✗</span>;
  return null;
}

export function ModelNav({ models, activeIdx, onSelect, statuses }: ModelNavProps) {
  const count = models.length;
  const clamp = (i: number) => ((i % count) + count) % count;

  // Keyboard left/right when not focused in a text input
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); onSelect(clamp(activeIdx - 1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); onSelect(clamp(activeIdx + 1)); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeIdx, count, onSelect]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="model-nav" role="tablist" aria-label="Model results">
      <button
        className="mn-arrow"
        onClick={() => onSelect(clamp(activeIdx - 1))}
        aria-label="Previous model"
      >
        ←
      </button>

      <div className="mn-tabs">
        {models.map((model, idx) => {
          const key = modelKey(model);
          return (
            <button
              key={key}
              className={`mn-tab${idx === activeIdx ? ' mn-tab-active' : ''}`}
              role="tab"
              aria-selected={idx === activeIdx}
              onClick={() => onSelect(idx)}
              title={`${model.modelName} on ${model.serverName}`}
            >
              <span className="mn-tab-name">{model.modelName}</span>
              <span className="mn-tab-server">{model.serverName}</span>
              {statusBadge(statuses[key])}
            </button>
          );
        })}
      </div>

      <button
        className="mn-arrow"
        onClick={() => onSelect(clamp(activeIdx + 1))}
        aria-label="Next model"
      >
        →
      </button>

      <span className="mn-counter" aria-live="polite">
        {activeIdx + 1} / {count}
      </span>
    </div>
  );
}
