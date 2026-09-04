import './ExecutionPreview.css';

interface ExecutionPreviewProps {
  promptCount: number;
  modelCount: number;
  testCaseCount: number;
  runsPerCell: number;
  /**
   * Rubric perspectives that will be graded by the judge model. Each perspective
   * is one extra LLM call per completion, so it belongs in the total the user
   * is about to commit to — not hidden behind the completion count.
   */
  judgePerspectiveCount?: number;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function ExecutionPreview({
  promptCount, modelCount, testCaseCount, runsPerCell,
  judgePerspectiveCount = 0,
}: ExecutionPreviewProps) {
  const total = promptCount * modelCount * testCaseCount * runsPerCell;
  const judgeCalls = total * judgePerspectiveCount;
  const grandTotal = total + judgeCalls;
  const isBig = grandTotal > 50;

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
      <p className="ep-plain">
        {judgeCalls > 0
          ? `${plural(total, 'completion')} + ${plural(judgeCalls, 'judge call')} = ${plural(grandTotal, 'total LLM call')}`
          : `${plural(grandTotal, 'total LLM call')}`}
      </p>
      <dl className="ep-legend">
        <div><dt>P</dt><dd>{plural(promptCount, 'prompt')}</dd></div>
        <div><dt>M</dt><dd>{plural(modelCount, 'model')}</dd></div>
        <div><dt>T</dt><dd>{plural(testCaseCount, 'test case')}</dd></div>
        <div><dt>R</dt><dd>{plural(runsPerCell, 'run')} per cell</dd></div>
      </dl>
      {isBig && (
        <p className="ep-warn">⚠ Large matrix ({grandTotal} calls) — this may take a while</p>
      )}
      {runsPerCell === 1 && (
        <p className="ep-hint">
          1 run per cell — score differences under ±0.3 are within noise. Raise runs per cell
          to measure consistency.
        </p>
      )}
    </div>
  );
}
