import { useRef, useEffect } from 'react';
import { useEval } from '../../context/EvalContext';
import { formatScore, formatLatency } from '../../lib/scoring';

export function MetricsView() {
  const { state } = useEval();
  const { results, summary } = state;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!summary || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { modelRankings } = summary;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = 180;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, W, H);

    const barW = Math.min(60, (W - 40) / modelRankings.length - 8);
    const maxScore = Math.max(...modelRankings.map(r => r.compositeScore), 5);
    const pad = 20;

    modelRankings.forEach((r, i) => {
      const x = pad + i * ((W - pad * 2) / modelRankings.length) + 4;
      const barH = ((r.compositeScore / maxScore) * (H - 40));
      const y = H - barH - 20;

      ctx.fillStyle = i === 0 ? '#f59e0b' : '#0ea5e9';
      ctx.fillRect(x, y, barW, barH);

      ctx.fillStyle = '#f4f4f5';
      ctx.font = `${11}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(r.compositeScore.toFixed(1), x + barW / 2, y - 4);

      ctx.fillStyle = '#a1a1aa';
      ctx.font = `${9}px sans-serif`;
      const label = r.modelId.split(':')[0].split('/').pop()?.slice(0, 8) ?? '';
      ctx.fillText(label, x + barW / 2, H - 4);
    });
  }, [summary]);

  if (!results || !summary) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        No results yet.
      </div>
    );
  }

  const { modelRankings } = summary;

  // Compliance table
  const complianceData = modelRankings.map(r => ({
    model: r.modelId,
    passRate: r.deterministicPassRate,
    latency: r.avgLatencyMs,
    tps: r.avgTokensPerSecond,
    consistency: r.consistencyScore ?? null,
  }));

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
      {/* Bar chart */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
          Composite Score by Model
        </div>
        <canvas
          ref={canvasRef}
          className="w-full rounded"
          style={{ height: 180, display: 'block', background: 'var(--bg-elevated)' }}
          aria-label="Composite score bar chart"
        />
      </div>

      {/* Compliance table */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
          Compliance & Performance
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Model', 'Pass Rate', 'Avg Latency', 'Tokens/s', 'Consistency'].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {complianceData.map(row => (
                <tr key={row.model} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-2 py-1.5 font-mono truncate max-w-32" style={{ color: 'var(--text-primary)' }}>
                    {row.model}
                  </td>
                  <td className="px-2 py-1.5 font-mono" style={{ color: row.passRate >= 0.8 ? 'var(--success)' : row.passRate >= 0.5 ? 'var(--warning)' : 'var(--error)' }}>
                    {(row.passRate * 100).toFixed(0)}%
                  </td>
                  <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-primary)' }}>
                    {formatLatency(row.latency)}
                  </td>
                  <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--info)' }}>
                    {row.tps.toFixed(0)}
                  </td>
                  <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {row.consistency != null ? formatScore(row.consistency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
