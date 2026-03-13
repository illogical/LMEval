import { formatLatency } from '../../lib/scoring';

interface ModelProgressRowProps {
  modelId: string;
  completed: number;
  total: number;
  avgLatencyMs: number;
  tokensPerSec: number;
}

export function ModelProgressRow({
  modelId,
  completed,
  total,
  avgLatencyMs,
  tokensPerSec,
}: ModelProgressRowProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-1 px-4 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono truncate max-w-40" style={{ color: 'var(--text-primary)' }}>
          {modelId}
        </span>
        <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
          {avgLatencyMs > 0 && <span>{formatLatency(avgLatencyMs)}/cell</span>}
          {tokensPerSec > 0 && <span>{tokensPerSec.toFixed(0)} tok/s</span>}
          <span className="font-mono">{pct}%</span>
        </div>
      </div>
      <div
        className="h-1 rounded-full overflow-hidden"
        style={{ background: 'var(--bg-elevated)' }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${modelId} progress`}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: 'var(--info)' }}
        />
      </div>
    </div>
  );
}
