import { useState } from 'react';
import { useEval } from '../../context/EvalContext';
import { scoreToColor, formatScore } from '../../lib/scoring';
import type { EvalMatrixCell } from '../../types/eval';

interface HeatmapMatrixProps {
  onCellClick?: (cell: EvalMatrixCell) => void;
}

export function HeatmapMatrix({ onCellClick }: HeatmapMatrixProps) {
  const { state } = useEval();
  const { results, selectedModels } = state;
  const [tooltip, setTooltip] = useState<{ cell: EvalMatrixCell; x: number; y: number } | null>(null);

  if (!results) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        No results yet.
      </div>
    );
  }

  const matrix = results.matrix;
  const models = selectedModels.length > 0 ? selectedModels : Array.from(new Set(matrix.map(c => c.modelId)));
  const testCaseIds = Array.from(new Set(matrix.map(c => c.testCaseId)));
  const promptIds = Array.from(new Set(matrix.map(c => c.promptId)));

  const allScores = matrix.map(c => c.compositeScore ?? 0).filter(s => s > 0);
  const minScore = Math.min(...allScores, 0);
  const maxScore = Math.max(...allScores, 5);

  const getCell = (promptId: string, testCaseId: string, modelId: string) =>
    matrix.find(c => c.promptId === promptId && c.testCaseId === testCaseId && c.modelId === modelId);

  const rows = promptIds.flatMap(promptId =>
    testCaseIds.map(testCaseId => ({ promptId, testCaseId }))
  );

  return (
    <div className="flex-1 overflow-auto p-4">
      <div style={{ overflowX: 'auto' }}>
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th
                className="px-2 py-1 text-left font-medium sticky left-0"
                style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', minWidth: 120 }}
              >
                Prompt / Test
              </th>
              {models.map(m => (
                <th
                  key={m}
                  className="px-2 py-1 text-center font-medium"
                  style={{ color: 'var(--text-secondary)', minWidth: 80 }}
                  title={m}
                >
                  {m.split(':')[0].split('/').pop()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ promptId, testCaseId }) => (
              <tr key={`${promptId}-${testCaseId}`}>
                <td
                  className="px-2 py-1 sticky left-0 font-mono truncate max-w-32"
                  style={{
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border)',
                  }}
                  title={`${promptId} / ${testCaseId}`}
                >
                  {promptId.slice(0, 8)}…/{testCaseId.slice(0, 8)}
                </td>
                {models.map(modelId => {
                  const cell = getCell(promptId, testCaseId, modelId);
                  const score = cell?.compositeScore;
                  const bg = score != null ? scoreToColor(score, minScore, maxScore) : 'var(--bg-elevated)';

                  return (
                    <td
                      key={modelId}
                      className="text-center cursor-pointer transition-opacity hover:opacity-80"
                      style={{
                        background: bg,
                        border: '1px solid var(--bg-base)',
                        padding: '4px 8px',
                        color: score != null ? '#000' : 'var(--text-secondary)',
                        fontWeight: 'bold',
                        fontFamily: 'monospace',
                      }}
                      onClick={() => cell && onCellClick?.(cell)}
                      onMouseEnter={e => cell && setTooltip({ cell, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setTooltip(null)}
                      aria-label={
                        cell
                          ? `Score ${score != null ? formatScore(score) : 'N/A'} for ${modelId}`
                          : 'No data'
                      }
                    >
                      {score != null ? formatScore(score) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 rounded border p-2 text-xs shadow-xl pointer-events-none"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 40,
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
            maxWidth: 200,
          }}
        >
          <div className="font-bold">{tooltip.cell.modelId}</div>
          <div style={{ color: 'var(--text-secondary)' }}>{tooltip.cell.testCaseId}</div>
          {tooltip.cell.compositeScore != null && (
            <div>Score: <span style={{ color: 'var(--accent)' }}>{formatScore(tooltip.cell.compositeScore)}</span></div>
          )}
          <div>Latency: {tooltip.cell.metrics.durationMs}ms</div>
          <div>Tokens: {tooltip.cell.metrics.inputTokens + tooltip.cell.metrics.outputTokens}</div>
        </div>
      )}
    </div>
  );
}
