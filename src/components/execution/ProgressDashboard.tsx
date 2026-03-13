import { useEval } from '../../context/EvalContext';
import { formatLatency } from '../../lib/scoring';

export function ProgressDashboard() {
  const { state } = useEval();
  const { progress, status } = state;

  const { phase, totalPhases, completedCells, totalCells, elapsedMs } = progress;
  const pct = totalCells > 0 ? Math.round((completedCells / totalCells) * 100) : 0;
  const etaMs = completedCells > 0 && pct < 100
    ? ((elapsedMs / completedCells) * (totalCells - completedCells))
    : null;

  const phaseLabels = ['Completions', 'Judge Evaluation'];

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Overall progress */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-secondary)' }}>
            Phase {phase}/{totalPhases}: {phaseLabels[phase - 1] ?? 'Processing'}
          </span>
          <span style={{ color: 'var(--accent)' }} className="font-mono font-bold">
            {pct}%
          </span>
        </div>
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ background: 'var(--bg-elevated)' }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall progress"
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${pct}%`,
              background: status === 'completed' ? 'var(--success)' : 'var(--accent)',
            }}
          />
        </div>
        <div className="flex justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>{completedCells}/{totalCells} cells</span>
          {elapsedMs > 0 && <span>Elapsed: {formatLatency(elapsedMs)}</span>}
          {etaMs !== null && <span>ETA: {formatLatency(etaMs)}</span>}
        </div>
      </div>

      {/* Phase indicators */}
      <div className="flex gap-2">
        {phaseLabels.map((label, i) => {
          const phaseIdx = i + 1;
          const isDone = phase > phaseIdx || status === 'completed';
          const isCurrent = phase === phaseIdx && status === 'running';
          return (
            <div
              key={label}
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded"
              style={{
                background: isDone ? 'var(--success)' : isCurrent ? 'var(--accent)' : 'var(--bg-elevated)',
                color: isDone || isCurrent ? '#000' : 'var(--text-secondary)',
              }}
            >
              {isDone && <span>✓</span>}
              {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse-dot" />}
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
