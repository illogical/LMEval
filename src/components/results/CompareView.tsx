import { useState } from 'react';
import type { EvalMatrixCell } from '../../types/eval';
import { PromptDiffView } from '../prompt/PromptDiffView';
import './CompareView.css';

interface CompareViewProps {
  cells: EvalMatrixCell[];
}

export function CompareView({ cells }: CompareViewProps) {
  const [cellAId, setCellAId] = useState('');
  const [cellBId, setCellBId] = useState('');
  const [showDiff, setShowDiff] = useState(false);

  const completed = cells.filter(c => c.status === 'completed');
  const cellA = completed.find(c => c.id === cellAId);
  const cellB = completed.find(c => c.id === cellBId);

  function cellLabel(c: EvalMatrixCell) {
    return `${c.modelId.split('/').pop()} / ${c.testCaseId}`;
  }

  return (
    <div className="compare-view">
      <div className="cv-selectors">
        <div className="cv-selector">
          <label className="cv-label">Cell A</label>
          <select className="cv-select" value={cellAId} onChange={e => setCellAId(e.target.value)}>
            <option value="">Select cell…</option>
            {completed.map(c => <option key={c.id} value={c.id}>{cellLabel(c)}</option>)}
          </select>
        </div>
        <div className="cv-vs">vs</div>
        <div className="cv-selector">
          <label className="cv-label">Cell B</label>
          <select className="cv-select" value={cellBId} onChange={e => setCellBId(e.target.value)}>
            <option value="">Select cell…</option>
            {completed.map(c => <option key={c.id} value={c.id}>{cellLabel(c)}</option>)}
          </select>
        </div>
        {cellA && cellB && (
          <button className="cv-diff-btn" onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? 'Hide Diff' : 'Show Diff'}
          </button>
        )}
      </div>

      {cellA && cellB && (
        <>
          <div className="cv-panels">
            <div className="cv-panel">
              <div className="cv-panel-header cv-panel-a">A: {cellLabel(cellA)}</div>
              <pre className="cv-response">{cellA.response ?? 'No response'}</pre>
              {cellA.compositeScore != null && <div className="cv-score">Score: {cellA.compositeScore.toFixed(1)}</div>}
            </div>
            <div className="cv-panel">
              <div className="cv-panel-header cv-panel-b">B: {cellLabel(cellB)}</div>
              <pre className="cv-response">{cellB.response ?? 'No response'}</pre>
              {cellB.compositeScore != null && <div className="cv-score">Score: {cellB.compositeScore.toFixed(1)}</div>}
            </div>
          </div>

          {showDiff && (
            <PromptDiffView contentA={cellA.response ?? ''} contentB={cellB.response ?? ''} />
          )}
        </>
      )}

      {(!cellA || !cellB) && (
        <div className="cv-empty">Select two cells to compare</div>
      )}
    </div>
  );
}
