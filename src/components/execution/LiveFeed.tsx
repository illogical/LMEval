import { useRef, useEffect } from 'react';
import type { LiveFeedEntry } from '../../context/EvalContext';
import { formatScore } from '../../lib/scoring';

interface LiveFeedProps {
  entries: LiveFeedEntry[];
  onSelect?: (entry: LiveFeedEntry) => void;
}

export function LiveFeed({ entries, onSelect }: LiveFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Don't auto-scroll since newest is at top
  useEffect(() => {}, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--text-secondary)' }}>
        Waiting for results…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map(entry => (
        <button
          key={entry.cellId}
          onClick={() => onSelect?.(entry)}
          className="w-full flex items-center gap-2 px-4 py-2 border-b text-xs animate-slide-in hover:bg-[var(--bg-elevated)] transition-colors text-left"
          style={{ borderColor: 'var(--border)' }}
          aria-label={`Cell result: ${entry.modelId} / ${entry.testCaseName}`}
        >
          {/* Status dot */}
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: entry.passed === null
                ? 'var(--text-secondary)'
                : entry.passed
                ? 'var(--success)'
                : 'var(--error)',
            }}
            aria-hidden="true"
          />

          {/* Model */}
          <span className="font-mono truncate w-32 shrink-0" style={{ color: 'var(--text-primary)' }}>
            {entry.modelId}
          </span>

          {/* Test case */}
          <span className="truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
            {entry.testCaseName}
          </span>

          {/* Score */}
          {entry.score !== null && (
            <span className="font-mono font-bold shrink-0" style={{ color: 'var(--accent)' }}>
              {formatScore(entry.score)}
            </span>
          )}

          {/* Pass/fail badge */}
          {entry.passed !== null && (
            <span
              className="text-xs px-1.5 py-0.5 rounded shrink-0"
              style={{
                background: entry.passed ? '#0d2e26' : '#2e0d1a',
                color: entry.passed ? 'var(--success)' : 'var(--error)',
              }}
            >
              {entry.passed ? 'PASS' : 'FAIL'}
            </span>
          )}
        </button>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
