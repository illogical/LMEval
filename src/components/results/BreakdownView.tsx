import { useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell as ScatterCell,
  BarChart, Bar, Legend,
} from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { EvaluationSummary, TestCase } from '../../types/eval';
import { formatLatency, formatScore, scoreToColor } from '../../lib/scoring';
import { modelShortName, testCaseLabel } from '../../lib/labels';
import './BreakdownView.css';

interface BreakdownViewProps {
  summary: EvaluationSummary;
  testCases: TestCase[];
  onViewCell?: (cellId: string) => void;
}

const tooltipStyle = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--text)',
};

const SERIES_COLORS = ['#4fc1ff', '#2ea043', '#f59e0b', '#f43f5e', '#a78bfa', '#fb923c'];

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bv-stat-tile">
      <span className="bv-stat-value">{value}</span>
      <span className="bv-stat-label">{label}</span>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bv-section">
      <div className="bv-section-head">
        <h4 className="bv-section-title">{title}</h4>
        {subtitle && <span className="bv-section-subtitle">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

export function BreakdownView({ summary, testCases, onViewCell }: BreakdownViewProps) {
  const [perfOpen, setPerfOpen] = useState(false);
  const models = summary.modelSummaries;
  const hasMultipleModels = models.length >= 2;

  return (
    <div className="breakdown-view">
      {/* 1. Score vs latency tradeoff — the model-fit decision in one glance */}
      <Section title="Score vs. Latency" subtitle="upper-left is fast and good">
        {hasMultipleModels ? (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number" dataKey="latency" name="Latency"
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                tickFormatter={v => formatLatency(v)}
                label={{ value: 'Avg latency', position: 'insideBottom', offset: -4, fontSize: 11, fill: 'var(--muted)' }}
              />
              <YAxis
                type="number" dataKey="score" name="Score" domain={[1, 5]}
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                label={{ value: 'Composite score', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--muted)' }}
              />
              <ZAxis type="number" dataKey="success" range={[80, 400]} name="Success rate" />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={tooltipStyle}
                formatter={(value, name) => {
                  if (name === 'Latency') return [formatLatency(value as number), name];
                  if (name === 'Score') return [formatScore(value as number), name];
                  return [`${((value as number) * 100).toFixed(0)}%`, 'Success rate'];
                }}
                labelFormatter={() => ''}
              />
              <Scatter
                name="Models"
                data={models
                  .filter(m => m.avgCompositeScore != null)
                  .map(m => ({
                    name: modelShortName(m.modelId),
                    latency: m.avgDurationMs,
                    score: m.avgCompositeScore ?? 0,
                    success: m.successRate,
                  }))}
              >
                {models.filter(m => m.avgCompositeScore != null).map(m => (
                  <ScatterCell key={m.modelId} fill={scoreToColor(m.avgCompositeScore ?? 3)} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="bv-stat-row">
            {models[0] && (
              <>
                <StatTile label="Score" value={models[0].avgCompositeScore != null ? formatScore(models[0].avgCompositeScore) : '—'} />
                <StatTile label="Latency" value={formatLatency(models[0].avgDurationMs)} />
                <StatTile label="Success rate" value={`${(models[0].successRate * 100).toFixed(0)}%`} />
              </>
            )}
          </div>
        )}
      </Section>

      {/* 2. Per-perspective breakdown — why a model won or lost */}
      {(() => {
        const scoredPerspectives = (summary.perspectiveIds ?? []).filter(
          p => models.some(m => m.perspectiveScores?.[p] != null)
        );
        if (scoredPerspectives.length === 0) return null;
        return (
          <Section title="Score by Perspective" subtitle="which rubric dimensions drive the ranking">
            <ResponsiveContainer width="100%" height={Math.max(220, models.length * 60)}>
              <BarChart
                layout="vertical"
                data={models.map(m => ({
                  name: modelShortName(m.modelId),
                  ...Object.fromEntries(scoredPerspectives.map(p => [p, m.perspectiveScores?.[p]])),
                }))}
                margin={{ top: 8, right: 20, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={tooltipStyle} formatter={v => (v == null ? '—' : (v as number).toFixed(1))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {scoredPerspectives.map((p, i) => (
                  <Bar key={p} dataKey={p} name={p} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[0, 4, 4, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Section>
        );
      })()}

      {/* 3. Hardest test cases — which inputs break this prompt */}
      {summary.testCaseSummaries && summary.testCaseSummaries.length > 0 && (
        <Section title="Hardest Test Cases" subtitle="sorted worst pass-rate first">
          {summary.testCaseSummaries.every(tc => tc.passRate === 1) ? (
            <div className="bv-all-pass">✓ All {summary.testCaseSummaries.length} test case{summary.testCaseSummaries.length === 1 ? '' : 's'} passed on every model</div>
          ) : (
            <div className="bv-tc-list">
              {summary.testCaseSummaries.slice(0, 8).map(tc => (
                <div key={tc.testCaseId} className="bv-tc-row">
                  <div className="bv-tc-label" title={testCaseLabel(tc.testCaseId, testCases)}>
                    {testCaseLabel(tc.testCaseId, testCases)}
                  </div>
                  <div className="bv-tc-bar-track">
                    <div
                      className="bv-tc-bar-fill"
                      style={{
                        width: `${tc.passRate * 100}%`,
                        background: scoreToColor(1 + tc.passRate * 4),
                      }}
                    />
                  </div>
                  <div className="bv-tc-pct">{(tc.passRate * 100).toFixed(0)}%</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* 4. Assertion failure breakdown — the most actionable prompt feedback */}
      {summary.assertionSummary && summary.assertionSummary.length > 0 && (
        <Section title="Assertion Failures" subtitle="most-failed checks, with an example">
          {summary.assertionSummary.every(a => a.failed === 0) ? (
            <div className="bv-all-pass">✓ Every assertion passed across all cells</div>
          ) : (
            <div className="bv-assert-list">
              {summary.assertionSummary.filter(a => a.failed > 0).slice(0, 6).map(a => (
                <div key={`${a.type}::${a.metric ?? ''}`} className="bv-assert-row">
                  <div className="bv-assert-head">
                    <span className="bv-assert-name">{a.metric ?? a.type}</span>
                    <span className="bv-assert-count">{a.failed} / {a.total} failed</span>
                  </div>
                  {a.sampleReason && (
                    <button
                      className="bv-assert-reason"
                      onClick={() => a.sampleCellId && onViewCell?.(a.sampleCellId)}
                      title="View this failure in Detail"
                    >
                      {a.sampleReason}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* 5. Consistency — only meaningful with repeated runs */}
      {summary.consistency && Object.keys(summary.consistency).length > 0 && (
        <Section title="Consistency" subtitle="std-dev of composite score across repeated runs — lower is more reliable">
          <div className="bv-stat-row">
            {Object.entries(summary.consistency).map(([modelId, stdDev]) => (
              <StatTile key={modelId} label={modelShortName(modelId)} value={`±${stdDev.toFixed(2)}`} />
            ))}
          </div>
        </Section>
      )}

      {/* 6. Performance — secondary to quality, collapsed by default */}
      <section className="bv-section">
        <button className="bv-collapse-toggle" onClick={() => setPerfOpen(o => !o)}>
          {perfOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="bv-section-title">Performance</span>
        </button>
        {perfOpen && (
          hasMultipleModels ? (
            <div className="bv-perf-charts">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={models.map(m => ({ name: modelShortName(m.modelId), latency: Math.round(m.avgDurationMs) }))} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => formatLatency(v)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => formatLatency(v as number)} />
                  <Bar dataKey="latency" name="Avg latency" fill="#4fc1ff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={models.map(m => ({ name: modelShortName(m.modelId), input: Math.round(m.avgInputTokens), output: Math.round(m.avgOutputTokens) }))} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="input" name="Input tokens" fill="#4fc1ff" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="output" name="Output tokens" fill="#2ea043" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="bv-stat-row">
              {models[0] && (
                <>
                  <StatTile label="Avg latency" value={formatLatency(models[0].avgDurationMs)} />
                  <StatTile label="Tokens/sec" value={models[0].avgTokensPerSecond.toFixed(1)} />
                  <StatTile label="Input tokens" value={Math.round(models[0].avgInputTokens).toString()} />
                  <StatTile label="Output tokens" value={Math.round(models[0].avgOutputTokens).toString()} />
                </>
              )}
            </div>
          )
        )}
      </section>
    </div>
  );
}
