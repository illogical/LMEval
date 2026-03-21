import { useState } from 'react';
import type { EvalMatrixCell } from '../../types/eval';
import { scoreToColor, formatScore, formatLatency } from '../../lib/scoring';
import './HeatmapMatrix.css';

interface HeatmapMatrixProps {
  cells: EvalMatrixCell[];
  onCellClick?: (cell: EvalMatrixCell) => void;
}

export function HeatmapMatrix({ cells, onCellClick }: HeatmapMatrixProps) {
  const [tooltip, setTooltip] = useState<{ cell: EvalMatrixCell; x: number; y: number } | null>(null);

  if (cells.length === 0) return <div className="hm-empty">No results yet</div>;

  // Extract unique axes
  const models = [...new Set(cells.map(c => c.modelId))].sort();
  const testCases = [...new Set(cells.map(c => c.testCaseId))].sort();

  // Build lookup: `${testCaseId}::${modelId}` → cell
  const lookup = new Map<string, EvalMatrixCell>();
  for (const cell of cells) {
    lookup.set(`${cell.testCaseId}::${cell.modelId}`, cell);
  }

  return (
    <div className="heatmap">
      <div
        className="hm-grid"
        style={{ gridTemplateColumns: `160px repeat(${models.length}, 1fr)` }}
      >
        {/* Header row */}
        <div className="hm-cell hm-header hm-corner" />
        {models.map(m => (
          <div key={m} className="hm-cell hm-header hm-model-header" title={m}>
            {m.split('/').pop()}
          </div>
        ))}

        {/* Data rows */}
        {testCases.map(tc => (
          <>
            <div key={`tc-${tc}`} className="hm-cell hm-tc-label" title={tc}>{tc}</div>
            {models.map(m => {
              const cell = lookup.get(`${tc}::${m}`);
              if (!cell) return <div key={`${tc}::${m}`} className="hm-cell hm-cell-empty">—</div>;

              const score = cell.compositeScore;
              const bg = score != null ? scoreToColor(score) : undefined;
              const opacity = score != null ? 0.85 : 0.3;

              return (
                <div
                  key={`${tc}::${m}`}
                  className="hm-cell hm-data-cell"
                  style={{ backgroundColor: bg ? `${bg}${Math.round(opacity * 255).toString(16).padStart(2, '0')}` : undefined }}
                  onClick={() => onCellClick?.(cell)}
                  onMouseEnter={e => setTooltip({ cell, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${m} / ${tc}: ${score != null ? formatScore(score) : cell.status}`}
                >
                  {score != null ? formatScore(score) : cell.status === 'failed' ? '✗' : '…'}
                </div>
              );
            })}
          </>
        ))}
      </div>

      {tooltip && (
        <div
          className="hm-tooltip"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="hmt-model">{tooltip.cell.modelId}</div>
          <div className="hmt-tc">{tooltip.cell.testCaseId}</div>
          {tooltip.cell.compositeScore != null && (
            <div className="hmt-score">Score: {formatScore(tooltip.cell.compositeScore)}</div>
          )}
          {tooltip.cell.durationMs != null && (
            <div className="hmt-lat">Latency: {formatLatency(tooltip.cell.durationMs)}</div>
          )}
          {tooltip.cell.judgeResults?.map(jr => (
            <div key={jr.perspectiveId} className="hmt-perspective">
              {jr.perspectiveId}: {jr.score.toFixed(1)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
