import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { EvaluationSummary } from '../../types/eval';
import { formatLatency } from '../../lib/scoring';
import './MetricsView.css';

interface MetricsViewProps {
  summary: EvaluationSummary;
}

export function MetricsView({ summary }: MetricsViewProps) {
  const latencyData = summary.modelSummaries.map(m => ({
    name: m.modelId.split('/').pop() ?? m.modelId,
    latency: Math.round(m.avgDurationMs),
    label: formatLatency(m.avgDurationMs),
  }));

  const tpsData = summary.modelSummaries.map(m => ({
    name: m.modelId.split('/').pop() ?? m.modelId,
    tps: Math.round(m.avgTokensPerSecond),
  }));

  const tokenData = summary.modelSummaries.map(m => ({
    name: m.modelId.split('/').pop() ?? m.modelId,
    input: Math.round(m.avgInputTokens),
    output: Math.round(m.avgOutputTokens),
  }));

  const CHART_COLORS = { primary: '#4fc1ff', secondary: '#2ea043', bg: 'transparent' };

  const tooltipStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 12,
    color: 'var(--text)',
  };

  return (
    <div className="metrics-view">
      <div className="mv-chart">
        <h4 className="mv-chart-title">Avg Latency by Model (ms)</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={latencyData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="latency" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mv-chart">
        <h4 className="mv-chart-title">Tokens / Second by Model</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={tpsData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="tps" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mv-chart">
        <h4 className="mv-chart-title">Token Usage by Model</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={tokenData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="input" name="Input" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
            <Bar dataKey="output" name="Output" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
