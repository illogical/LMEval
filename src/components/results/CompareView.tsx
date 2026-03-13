import { useState } from 'react';
import { useEval } from '../../context/EvalContext';
import { formatScore, formatLatency } from '../../lib/scoring';
import { PromptDiff } from '../prompt/PromptDiff';
import type { EvalMatrixCell } from '../../types/eval';

export function CompareView() {
  const { state } = useEval();
  const { results } = state;
  const [cellAId, setCellAId] = useState('');
  const [cellBId, setCellBId] = useState('');
  const [showDiff, setShowDiff] = useState(false);

  if (!results) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        No results yet.
      </div>
    );
  }

  const cells = results.matrix;
  const cellA = cells.find(c => c.id === cellAId);
  const cellB = cells.find(c => c.id === cellBId);

  const pairwise = cellA && cellB
    ? results.pairwiseRankings?.find(
        p =>
          (p.cellIdA === cellAId && p.cellIdB === cellBId) ||
          (p.cellIdA === cellBId && p.cellIdB === cellAId)
      )
    : null;

  const cellLabel = (c: EvalMatrixCell) =>
    `${c.modelId} / ${c.testCaseId.slice(0, 8)}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Selectors */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b"
        style={{ borderColor: 'var(--border)', flexShrink: 0 }}
      >
        <select
          value={cellAId}
          onChange={e => setCellAId(e.target.value)}
          className="flex-1 text-xs rounded px-2 py-1.5 border"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          aria-label="Select cell A"
        >
          <option value="">-- Select Cell A --</option>
          {cells.map(c => (
            <option key={c.id} value={c.id}>{cellLabel(c)}</option>
          ))}
        </select>
        <span style={{ color: 'var(--text-secondary)' }}>vs</span>
        <select
          value={cellBId}
          onChange={e => setCellBId(e.target.value)}
          className="flex-1 text-xs rounded px-2 py-1.5 border"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          aria-label="Select cell B"
        >
          <option value="">-- Select Cell B --</option>
          {cells.map(c => (
            <option key={c.id} value={c.id}>{cellLabel(c)}</option>
          ))}
        </select>
        {cellA && cellB && (
          <button
            onClick={() => setShowDiff(d => !d)}
            className="text-xs px-2 py-1.5 rounded shrink-0 transition-colors"
            style={{ background: showDiff ? 'var(--accent)' : 'var(--bg-elevated)', color: showDiff ? '#000' : 'var(--text-secondary)' }}
            aria-pressed={showDiff}
          >
            Diff
          </button>
        )}
      </div>

      {/* Side-by-side or diff */}
      {!cellA && !cellB ? (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          Select two cells to compare
        </div>
      ) : showDiff && cellA && cellB ? (
        <PromptDiff
          oldText={cellA.response.content ?? ''}
          newText={cellB.response.content ?? ''}
          oldLabel={cellA.modelId}
          newLabel={cellB.modelId}
        />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {([cellA, cellB] as const).filter((c): c is typeof cellA & {} => c != null).map((cell, i) => (
            <div
              key={i}
              className="flex-1 flex flex-col overflow-hidden border-r last:border-r-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <div
                className="px-3 py-2 border-b text-xs font-semibold"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              >
                {cell.modelId}
                <span className="ml-2 font-normal" style={{ color: 'var(--text-secondary)' }}>
                  Score: {cell.compositeScore != null ? formatScore(cell.compositeScore) : '—'} ·{' '}
                  {formatLatency(cell.metrics.durationMs)}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                <pre className="whitespace-pre-wrap">{cell.response.content}</pre>
                {cell.response.toolCalls && cell.response.toolCalls.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Tool Calls:</div>
                    {cell.response.toolCalls.map((tc, j) => (
                      <div
                        key={j}
                        className="rounded border p-2"
                        style={{ background: 'var(--bg-elevated)', borderColor: tc.valid ? 'var(--success)' : 'var(--error)' }}
                      >
                        <div className="font-bold">{tc.functionName}</div>
                        <pre className="text-xs mt-1 whitespace-pre-wrap">{JSON.stringify(tc.arguments, null, 2)}</pre>
                        {tc.errors && tc.errors.length > 0 && (
                          <div className="text-xs mt-1" style={{ color: 'var(--error)' }}>{tc.errors.join(', ')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pairwise verdict */}
      {pairwise && (
        <div
          className="px-4 py-3 border-t text-xs"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <span className="font-semibold" style={{ color: 'var(--accent)' }}>Pairwise Verdict: </span>
          <span style={{ color: 'var(--text-primary)' }}>
            {pairwise.winnerId === cellAId ? cellA?.modelId : cellB?.modelId} wins
          </span>
          <span className="ml-2" style={{ color: 'var(--text-secondary)' }}>— {pairwise.justification}</span>
        </div>
      )}
    </div>
  );
}
