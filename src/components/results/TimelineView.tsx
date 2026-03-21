import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { EvaluationSummary } from '../../types/eval';
import './TimelineView.css';

interface TimelineViewProps {
  summary: EvaluationSummary;
}

const COLORS = ['#4fc1ff', '#2ea043', '#f59e0b', '#f43f5e', '#a78bfa', '#fb923c'];

export function TimelineView({ summary }: TimelineViewProps) {
  // Create a simple data point from current eval
  const data = [{
    date: summary.completedAt ? new Date(summary.completedAt).toLocaleDateString() : 'Now',
    ...Object.fromEntries(
      summary.modelSummaries.map(m => [
        m.modelId.split('/').pop() ?? m.modelId,
        m.avgCompositeScore ?? 0
      ])
    )
  }];

  const models = summary.modelSummaries.map(m => m.modelId.split('/').pop() ?? m.modelId);

  const tooltipStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 12,
    color: 'var(--text)',
  };

  return (
    <div className="timeline-view">
      <p className="tv-note">Timeline shows composite scores across evaluations. Run more evaluations to see trends.</p>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {models.map((m, i) => (
            <Line
              key={m}
              type="monotone"
              dataKey={m}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 5 }}
              activeDot={{ r: 7 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
