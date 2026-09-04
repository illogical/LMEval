import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { EvaluationHistoryEntry, EvaluationSummary, EvaluationConfig, BaselineSummary } from '../../types/eval';
import { modelShortName } from '../../lib/labels';
import './TrendView.css';

interface TrendViewProps {
  history: EvaluationHistoryEntry[];
  evalId: string;
  summary: EvaluationSummary;
  config: EvaluationConfig;
  selectedBaseline?: BaselineSummary;
  onSaveBaseline: (slug: string) => Promise<void>;
}

const COLORS = ['#4fc1ff', '#2ea043', '#f59e0b', '#f43f5e', '#a78bfa', '#fb923c'];

export function TrendView({ history, evalId, summary, config, selectedBaseline, onSaveBaseline }: TrendViewProps) {
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);

  const byPrompt = config.comparisonMode === 'prompt';
  const seriesIds = byPrompt
    ? summary.promptSummaries.map(p => `${p.promptId}:${p.promptVersion}`)
    : summary.modelSummaries.map(m => m.modelId);

  const data = history.map(h => ({
    date: new Date(h.date).toLocaleDateString(),
    evalId: h.evalId,
    ...Object.fromEntries(seriesIds.map(id => [id, (byPrompt ? h.promptScores : h.modelScores)[id]])),
  }));

  async function handleSave() {
    if (!slug.trim()) return;
    setSaving(true);
    try {
      await onSaveBaseline(slug.trim());
      setSlug('');
    } finally {
      setSaving(false);
    }
  }

  if (data.length < 2) {
    return (
      <div className="trend-view trend-empty">
        <p className="tv-empty-title">This is the first run for {byPrompt ? 'these prompts' : 'this prompt'}.</p>
        <p className="tv-empty-body">Save it as a baseline, then re-run after editing to see the trend.</p>
        <div className="tv-empty-save">
          <input
            className="tv-slug-input"
            placeholder="baseline name…"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button className="rp-action-btn rp-baseline-btn" onClick={handleSave} disabled={saving || !slug.trim()}>
            {saving ? 'Saving…' : 'Save Baseline'}
          </button>
        </div>
      </div>
    );
  }

  const tooltipStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 12,
    color: 'var(--text)',
  };

  const label = (id: string) => byPrompt ? `Prompt v${id.split(':')[1]}` : modelShortName(id);

  return (
    <div className="trend-view">
      <p className="tv-note">
        Composite score across {history.length} completed run{history.length === 1 ? '' : 's'} of {byPrompt ? 'these prompts' : 'this prompt'}.
        {selectedBaseline && ' Dashed line marks the selected baseline.'}
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={label} />
          {selectedBaseline?.avgCompositeScore != null && (
            <ReferenceLine
              y={selectedBaseline.avgCompositeScore}
              stroke="var(--muted)"
              strokeDasharray="4 4"
              label={{ value: `baseline: ${selectedBaseline.slug}`, fontSize: 10, fill: 'var(--muted)', position: 'insideTopLeft' }}
            />
          )}
          {seriesIds.map((id, i) => (
            <Line
              key={id}
              type="monotone"
              dataKey={id}
              name={label(id)}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              connectNulls
              dot={(props: { cx?: number; cy?: number; payload?: Record<string, unknown>; value?: number; index?: number }) => {
                const key = `dot-${id}-${props.index}`;
                if (props.value == null || props.payload?.[id] == null) return <g key={key} />;
                const isCurrent = props.payload?.evalId === evalId;
                return (
                  <circle
                    key={key}
                    cx={props.cx}
                    cy={props.cy}
                    r={isCurrent ? 6 : 3}
                    fill={COLORS[i % COLORS.length]}
                    stroke={isCurrent ? 'var(--text)' : 'none'}
                    strokeWidth={isCurrent ? 2 : 0}
                  />
                );
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
