import { useMemo } from 'react';
import * as Diff from 'diff';

interface PromptDiffProps {
  oldText: string;
  newText: string;
  oldLabel?: string;
  newLabel?: string;
}

export function PromptDiff({ oldText, newText, oldLabel = 'Before', newLabel = 'After' }: PromptDiffProps) {
  const diff = useMemo(() => Diff.diffLines(oldText, newText), [oldText, newText]);

  const hasChanges = diff.some(p => p.added || p.removed);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 border-b text-xs"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>
          Diff: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{oldLabel}</span>
          {' → '}
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{newLabel}</span>
        </span>
        {!hasChanges && (
          <span style={{ color: 'var(--success)' }}>No changes</span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3 font-mono text-xs" style={{ background: 'var(--bg-base)' }}>
        {diff.map((part, i) => {
          const lines = part.value.split('\n').filter((_, j, arr) => j < arr.length - 1 || part.value.endsWith('\n') || arr[j] !== '');
          return lines.map((line, j) => (
            <div
              key={`${i}-${j}`}
              className="leading-relaxed whitespace-pre-wrap"
              style={{
                background: part.added ? '#0d2e26' : part.removed ? '#2e0d1a' : 'transparent',
                color: part.added ? '#6ee7b7' : part.removed ? '#fda4af' : 'var(--text-secondary)',
                paddingLeft: '0.5rem',
                borderLeft: part.added
                  ? '2px solid var(--success)'
                  : part.removed
                  ? '2px solid var(--error)'
                  : '2px solid transparent',
              }}
            >
              {part.added ? '+ ' : part.removed ? '- ' : '  '}{line}
            </div>
          ));
        })}
      </div>
    </div>
  );
}
