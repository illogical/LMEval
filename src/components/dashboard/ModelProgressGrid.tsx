import { formatLatency } from '../../lib/scoring';
import './ModelProgressGrid.css';

interface ModelProgress {
  modelId: string;
  serverName?: string;
  done: number;
  total: number;
  avgLatencyMs?: number;
  tokensPerSec?: number;
}

interface ModelProgressGridProps {
  models: ModelProgress[];
}

export function ModelProgressGrid({ models }: ModelProgressGridProps) {
  if (models.length === 0) return null;

  const groups: Record<string, ModelProgress[]> = {};
  for (const m of models) {
    const key = m.serverName ?? 'Unknown';
    (groups[key] ??= []).push(m);
  }

  return (
    <div className="mpg">
      {Object.entries(groups).map(([server, mods]) => (
        <div key={server} className="mpg-group">
          <div className="mpg-server">{server}</div>
          <div className="mpg-cards">
            {mods.map(m => {
              const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
              return (
                <div key={m.modelId} className="mpg-card">
                  <div className="mpg-name" title={m.modelId}>{m.modelId.split('/').pop() ?? m.modelId}</div>
                  <div className="mpg-bar-wrapper">
                    <div className="mpg-bar">
                      <div className="mpg-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="mpg-pct">{pct}%</span>
                  </div>
                  <div className="mpg-stats">
                    <span>{m.done}/{m.total} cells</span>
                    {m.avgLatencyMs != null && <span>{formatLatency(m.avgLatencyMs)} avg</span>}
                    {m.tokensPerSec != null && <span>{m.tokensPerSec.toFixed(0)} tok/s</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
