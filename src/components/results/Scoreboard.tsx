import { useEval } from '../../context/EvalContext';
import { formatScore, formatLatency } from '../../lib/scoring';

export function Scoreboard() {
  const { state } = useEval();
  const { summary, results } = state;

  if (!summary || !results) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        No results yet. Run an evaluation to see scores.
      </div>
    );
  }

  const { modelRankings, promptRankings, regression } = summary;

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
      {/* Regression banner */}
      {regression && (regression.regressed.length > 0 || regression.improved.length > 0) && (
        <div
          className="rounded border px-4 py-3"
          style={{
            background: regression.regressed.length > 0 ? '#2e0d1a' : '#0d2e26',
            borderColor: regression.regressed.length > 0 ? 'var(--error)' : 'var(--success)',
          }}
        >
          <div className="text-sm font-semibold mb-2" style={{ color: regression.regressed.length > 0 ? 'var(--error)' : 'var(--success)' }}>
            {regression.regressed.length > 0 ? '⚠️ Regression Detected' : '✅ Improvement Detected'}
          </div>
          {regression.regressed.length > 0 && (
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Regressed: {regression.regressed.join(', ')}
            </div>
          )}
          {regression.improved.length > 0 && (
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Improved: {regression.improved.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Model leaderboard */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Model Leaderboard
        </h3>
        <div className="flex flex-col gap-2">
          {modelRankings.map((r, idx) => (
            <div
              key={r.modelId}
              className="flex items-center gap-3 rounded border p-3"
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
            >
              <span className="text-lg font-bold w-6" style={{ color: idx === 0 ? 'var(--accent)' : 'var(--text-secondary)' }}>
                {idx === 0 ? '🏆' : `#${idx + 1}`}
              </span>
              <span className="font-mono text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                {r.modelId}
              </span>
              <div className="flex items-center gap-4 text-xs shrink-0">
                <div className="text-center">
                  <div className="font-bold font-mono text-base" style={{ color: 'var(--accent)' }}>
                    {formatScore(r.compositeScore)}
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>Score</div>
                </div>
                <div className="text-center">
                  <div className="font-bold font-mono" style={{ color: 'var(--success)' }}>
                    {(r.deterministicPassRate * 100).toFixed(0)}%
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>Pass</div>
                </div>
                <div className="text-center hidden sm:block">
                  <div className="font-mono" style={{ color: 'var(--info)' }}>
                    {formatLatency(r.avgLatencyMs)}
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>Latency</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Prompt leaderboard */}
      {promptRankings.length > 1 && (
        <div>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Prompt Comparison
          </h3>
          <div className="flex flex-col gap-2">
            {promptRankings.map((r, idx) => (
              <div
                key={`${r.promptId}-${r.version}`}
                className="flex items-center gap-3 rounded border p-3"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
              >
                <span className="text-sm font-bold w-6" style={{ color: idx === 0 ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  #{idx + 1}
                </span>
                <span className="font-mono text-xs flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                  {r.promptId} v{r.version}
                </span>
                <span className="font-bold font-mono" style={{ color: 'var(--accent)' }}>
                  {formatScore(r.compositeScore)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
