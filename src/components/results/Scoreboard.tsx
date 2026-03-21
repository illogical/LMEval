import type { EvaluationSummary } from '../../types/eval';
import { formatScore, formatLatency } from '../../lib/scoring';
import { HeatmapMatrix } from './HeatmapMatrix';
import type { EvalMatrixCell } from '../../types/eval';
import './Scoreboard.css';

interface ScoreboardProps {
  summary: EvaluationSummary;
  cells: EvalMatrixCell[];
  onCellClick?: (cell: EvalMatrixCell) => void;
}

export function Scoreboard({ summary, cells, onCellClick }: ScoreboardProps) {
  return (
    <div className="scoreboard">
      <section className="sb-section">
        <h3 className="sb-title">Model Leaderboard</h3>
        <div className="sb-leaderboard">
          {summary.modelSummaries
            .sort((a, b) => (b.avgCompositeScore ?? 0) - (a.avgCompositeScore ?? 0))
            .map((m, i) => (
              <div key={m.modelId} className="sb-model-card">
                <span className="sb-rank">#{i + 1}</span>
                <div className="sb-model-info">
                  <span className="sb-model-name" title={m.modelId}>{m.modelId.split('/').pop()}</span>
                  <div className="sb-model-stats">
                    <span>{formatLatency(m.avgDurationMs)} avg</span>
                    <span>{(m.successRate * 100).toFixed(0)}% success</span>
                    <span>{m.avgTokensPerSecond.toFixed(0)} tok/s</span>
                  </div>
                </div>
                <span className="sb-model-score">
                  {m.avgCompositeScore != null ? formatScore(m.avgCompositeScore) : '—'}
                </span>
              </div>
            ))}
        </div>
      </section>

      <section className="sb-section">
        <h3 className="sb-title">Score Matrix</h3>
        <HeatmapMatrix cells={cells} onCellClick={onCellClick} />
      </section>
    </div>
  );
}
