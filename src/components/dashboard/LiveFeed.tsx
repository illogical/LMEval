import { useState, useMemo } from 'react';
import type { EvalMatrixCell } from '../../types/eval';
import { formatLatency } from '../../lib/scoring';
import './LiveFeed.css';

interface LiveFeedProps {
  cells: EvalMatrixCell[];
  onCellClick?: (cell: EvalMatrixCell) => void;
}

export function LiveFeed({ cells, onCellClick }: LiveFeedProps) {
  const [modalCell, setModalCell] = useState<EvalMatrixCell | null>(null);

  function handleClick(cell: EvalMatrixCell) {
    setModalCell(cell);
    onCellClick?.(cell);
  }

  const reversedCells = useMemo(() => cells.slice().reverse(), [cells]);

  return (
    <div className="live-feed" aria-label="Live feed">
      <div className="lf-list">
        {reversedCells.map(cell => (
          <div
            key={cell.id}
            className={`lf-card lf-card-${cell.status}`}
            onClick={() => handleClick(cell)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && handleClick(cell)}
          >
            <div className="lf-model">{cell.modelId.split('/').pop()}</div>
            <div className="lf-case">{cell.testCaseId}</div>
            <div className="lf-meta">
              {cell.status === 'completed' && <span className="lf-pass">✓</span>}
              {cell.status === 'failed' && <span className="lf-fail">✗</span>}
              {cell.status === 'running' && <span className="lf-running">⏳</span>}
              {cell.compositeScore != null && <span className="lf-score">{cell.compositeScore.toFixed(1)}</span>}
              {cell.durationMs != null && <span className="lf-dur">{formatLatency(cell.durationMs)}</span>}
            </div>
          </div>
        ))}
        {cells.length === 0 && <div className="lf-empty">Waiting for results…</div>}
      </div>

      {modalCell && (
        <div className="lf-modal-overlay" onClick={() => setModalCell(null)}>
          <div className="lf-modal" onClick={e => e.stopPropagation()}>
            <div className="lf-modal-header">
              <span>{modalCell.modelId}</span>
              <button className="lf-modal-close" onClick={() => setModalCell(null)}>×</button>
            </div>
            <pre className="lf-modal-response">{modalCell.response ?? 'No response yet'}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
