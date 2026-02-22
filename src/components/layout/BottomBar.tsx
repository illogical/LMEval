import { useEval } from '../../context/EvalContext';
import { formatTokens, formatLatency } from '../../lib/scoring';

export function BottomBar() {
  const { state } = useEval();
  const { status, progress, results, summary } = state;

  const totalTokens = results
    ? results.matrix.reduce(
        (sum, cell) => sum + (cell.metrics.inputTokens ?? 0) + (cell.metrics.outputTokens ?? 0),
        0
      )
    : 0;

  const completedCount = status === 'running' ? progress.completedCells : (results?.matrix.length ?? 0);
  const totalCount = status === 'running' ? progress.totalCells : completedCount;

  const topModel = summary?.modelRankings[0];

  return (
    <footer
      className="flex items-center justify-between px-4 py-1.5 border-t text-xs"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
        color: 'var(--text-secondary)',
        flexShrink: 0,
      }}
      aria-label="Status bar"
    >
      <div className="flex items-center gap-4">
        {status === 'running' && (
          <span>
            Phase {progress.phase}/{progress.totalPhases} &nbsp;·&nbsp; {completedCount}/{totalCount} cells
          </span>
        )}
        {status === 'running' && progress.elapsedMs > 0 && (
          <span>Elapsed: {formatLatency(progress.elapsedMs)}</span>
        )}
        {status === 'idle' && <span>Ready</span>}
        {status === 'failed' && (
          <span style={{ color: 'var(--error)' }}>Evaluation failed</span>
        )}
        {status === 'completed' && <span style={{ color: 'var(--success)' }}>Completed</span>}
      </div>

      <div className="flex items-center gap-4">
        {totalTokens > 0 && (
          <span>Tokens: {formatTokens(totalTokens)}</span>
        )}
        {topModel && status === 'completed' && (
          <span>
            🏆 <span style={{ color: 'var(--accent)' }}>{topModel.modelId}</span>{' '}
            ({topModel.compositeScore.toFixed(1)})
          </span>
        )}
        {status === 'completed' && results && (
          <span>
            {results.matrix.filter(c => c.metrics.formatCompliant).length}/{results.matrix.length} compliant
          </span>
        )}
      </div>
    </footer>
  );
}
