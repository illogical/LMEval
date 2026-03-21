import './ExecutionPreview.css';

interface ExecutionPreviewProps {
  promptCount: number;
  modelCount: number;
  testCaseCount: number;
  runsPerCell: number;
}

export function ExecutionPreview({ promptCount, modelCount, testCaseCount, runsPerCell }: ExecutionPreviewProps) {
  const total = promptCount * modelCount * testCaseCount * runsPerCell;
  const isBig = total > 50;

  return (
    <div className={`exec-preview${isBig ? ' exec-preview-warn' : ''}`} aria-label="Execution preview">
      <div className="ep-matrix">
        <span className="ep-factor">{promptCount}P</span>
        <span className="ep-op">×</span>
        <span className="ep-factor">{modelCount}M</span>
        <span className="ep-op">×</span>
        <span className="ep-factor">{testCaseCount}T</span>
        <span className="ep-op">×</span>
        <span className="ep-factor">{runsPerCell}R</span>
        <span className="ep-op">=</span>
        <span className="ep-total">{total} completions</span>
      </div>
      {isBig && (
        <p className="ep-warn">⚠ Large matrix ({total} cells) — this may take a while</p>
      )}
    </div>
  );
}
