import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  listInsightActivities, getInsightsLeaderboard, getInsightsTrend, getInsightsDiagnostics, getInsightsOperational,
  type LeaderboardRow, type TrendPoint, type DiagnosticPoint, type OperationalPoint,
} from '../api/insights';
import { modelShortName } from '../lib/labels';
import './InsightsPage.css';

const SERIES_COLORS = ['#4fc1ff', '#2ea043', '#f59e0b', '#f43f5e', '#a78bfa', '#fb923c'];

const VERDICT_COLOR: Record<string, string> = {
  pass: 'var(--ok)',
  fail: 'var(--error)',
  inconclusive: 'var(--heatmap-mid)',
  advisory: 'var(--accent)',
};

const tooltipStyle = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--text)',
};

function colorFor(modelId: string, allModelIds: string[]): string {
  const idx = allModelIds.indexOf(modelId);
  return SERIES_COLORS[idx % SERIES_COLORS.length];
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/** Pivots a flat list of per-(model, run) points into one row per date, with `${modelId}::band` = [lower, upper] for a Recharts range-Area and `${modelId}::value` for the point line. */
function pivotTrend(points: TrendPoint[]): Array<Record<string, unknown>> {
  const dates = Array.from(new Set(points.map(p => p.completedAt ?? ''))).sort();
  return dates.map(date => {
    const row: Record<string, unknown> = { date: fmtDate(date), rawDate: date };
    for (const p of points.filter(p => (p.completedAt ?? '') === date)) {
      row[`${p.modelId}::band`] = [p.ciLower, p.ciUpper];
      row[`${p.modelId}::value`] = p.primaryMetricValue;
      row[`${p.modelId}::verdict`] = p.gateVerdict;
      row[`${p.modelId}::evalId`] = p.evalId;
    }
    return row;
  });
}

function pivotDiagnostics(points: DiagnosticPoint[], metricName: string): Array<Record<string, unknown>> {
  const filtered = points.filter(p => p.metricName === metricName);
  const dates = Array.from(new Set(filtered.map(p => p.completedAt ?? ''))).sort();
  return dates.map(date => {
    const row: Record<string, unknown> = { date: fmtDate(date) };
    for (const p of filtered.filter(p => (p.completedAt ?? '') === date)) {
      row[p.modelId] = p.metricValue;
    }
    return row;
  });
}

function pivotOperational(points: OperationalPoint[], field: 'avgDurationMs' | 'avgTokensPerSecond'): Array<Record<string, unknown>> {
  const dates = Array.from(new Set(points.map(p => p.completedAt ?? ''))).sort();
  return dates.map(date => {
    const row: Record<string, unknown> = { date: fmtDate(date) };
    for (const p of points.filter(p => (p.completedAt ?? '') === date)) {
      row[`${p.modelId} (${p.serverName ?? 'unknown server'})`] = p[field];
    }
    return row;
  });
}

export function InsightsPage() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<string[]>([]);
  const [activity, setActivity] = useState<string>('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticPoint[]>([]);
  const [operational, setOperational] = useState<OperationalPoint[]>([]);
  const [diagnosticMetric, setDiagnosticMetric] = useState<string>('');
  const [operationalField, setOperationalField] = useState<'avgDurationMs' | 'avgTokensPerSecond'>('avgDurationMs');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listInsightActivities()
      .then(list => {
        setActivities(list);
        setActivity(prev => prev || list[0] || '');
      })
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activity) return;
    Promise.all([
      getInsightsLeaderboard(activity),
      getInsightsTrend(activity),
      getInsightsDiagnostics(activity),
      getInsightsOperational(activity),
    ]).then(([lb, tr, diag, op]) => {
      setLeaderboard(lb);
      setTrend(tr);
      setDiagnostics(diag);
      setOperational(op);
      const firstMetric = diag[0]?.metricName ?? '';
      setDiagnosticMetric(prev => (diag.some(d => d.metricName === prev) ? prev : firstMetric));
    }).catch(() => {
      setLeaderboard([]); setTrend([]); setDiagnostics([]); setOperational([]);
    });
  }, [activity]);

  const modelIds = useMemo(() => Array.from(new Set(trend.map(t => t.modelId))), [trend]);
  const trendData = useMemo(() => pivotTrend(trend), [trend]);
  const diagnosticMetricNames = useMemo(
    () => Array.from(new Set(diagnostics.map(d => d.metricName))).sort(),
    [diagnostics]
  );
  const diagnosticData = useMemo(
    () => pivotDiagnostics(diagnostics, diagnosticMetric),
    [diagnostics, diagnosticMetric]
  );
  const operationalData = useMemo(() => pivotOperational(operational, operationalField), [operational, operationalField]);
  const operationalSeries = useMemo(
    () => Array.from(new Set(operational.map(p => `${p.modelId} (${p.serverName ?? 'unknown server'})`))),
    [operational]
  );

  // Gate-verdict history strip: rows = model, columns = chronological run dates.
  const gateHistoryDates = useMemo(
    () => Array.from(new Set(trend.map(t => t.completedAt ?? ''))).sort(),
    [trend]
  );
  const gateHistoryByModel = useMemo(() => {
    const byModel = new Map<string, Map<string, TrendPoint>>();
    for (const t of trend) {
      if (!byModel.has(t.modelId)) byModel.set(t.modelId, new Map());
      byModel.get(t.modelId)!.set(t.completedAt ?? '', t);
    }
    return byModel;
  }, [trend]);

  if (loading) return <div className="insights-page insights-loading">Loading run history…</div>;

  return (
    <div className="insights-page">
      <div className="insights-header">
        <button className="ip-back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="insights-title">Run History &amp; Insights</h1>
        <p className="insights-subtitle">
          Compare every evaluation run so far — spot trends, catch regressions, and see what to fix
          before the next run.
        </p>
      </div>

      {activities.length === 0 ? (
        <div className="insights-empty">
          <p>No indexed runs yet.</p>
          <p className="insights-empty-hint">
            Run <code>npm run insights:backfill</code> to index every already-completed evaluation, or
            complete a new evaluation using a built-in purpose template (classification, tagging, or
            summarization) — new runs are indexed automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="insights-filters">
            {activities.map(a => (
              <button
                key={a}
                className={`ip-tab ${a === activity ? 'ip-tab-active' : ''}`}
                onClick={() => setActivity(a)}
              >
                {a}
              </button>
            ))}
          </div>

          {/* 1. Leaderboard */}
          <section className="ip-section">
            <h2 className="ip-section-title">Leaderboard — latest run per model</h2>
            <div className="ip-table-wrap">
              <table className="ip-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Server</th>
                    <th>{leaderboard[0]?.primaryMetricName ?? 'Metric'}</th>
                    <th>95% CI</th>
                    <th>Gate</th>
                    <th>Cases</th>
                    <th>Ground truth</th>
                    <th>Run</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map(row => (
                    <tr key={row.modelId} className={row.groundTruthReviewStatus === 'pending-human-review' ? 'ip-row-advisory' : ''}>
                      <td>{modelShortName(row.modelId)}</td>
                      <td>{row.serverName ?? '—'}</td>
                      <td>{row.primaryMetricValue.toFixed(3)}</td>
                      <td>{row.ciLower.toFixed(3)}–{row.ciUpper.toFixed(3)}</td>
                      <td>
                        <span className="ip-badge" style={{ color: VERDICT_COLOR[row.gateVerdict] ?? 'var(--muted)' }}>
                          {row.gateVerdict}
                        </span>
                      </td>
                      <td>{row.caseCount}</td>
                      <td>{row.groundTruthReviewStatus ?? '—'}</td>
                      <td>
                        <button className="ip-link-btn" onClick={() => navigate(`/eval/results/${row.evalId}`)}>
                          View <ExternalLink size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leaderboard.some(r => r.groundTruthReviewStatus === 'pending-human-review') && (
              <p className="ip-caveat">Grayed rows rest on benchmark ground truth still pending human review.</p>
            )}
          </section>

          {/* 2 & 3. Metric trend + confidence-interval band */}
          <section className="ip-section">
            <h2 className="ip-section-title">Metric trend, with 95% confidence interval</h2>
            <p className="ip-section-note">
              The shaded band is the bootstrap 95% CI behind the point estimate — a run whose band
              straddles the gate threshold is "inconclusive," not a genuine pass or fail.
            </p>
            {trendData.length < 2 ? (
              <p className="ip-empty-inline">Need at least two runs to plot a trend.</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={trendData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(name: string) => modelShortName(name)} />
                  {modelIds.map(modelId => (
                    <Area
                      key={`${modelId}-band`}
                      type="monotone"
                      dataKey={`${modelId}::band`}
                      name={`${modelId}::band`}
                      stroke="none"
                      fill={colorFor(modelId, modelIds)}
                      fillOpacity={0.15}
                      legendType="none"
                      connectNulls
                    />
                  ))}
                  {modelIds.map(modelId => (
                    <Line
                      key={`${modelId}-value`}
                      type="monotone"
                      dataKey={`${modelId}::value`}
                      name={modelId}
                      stroke={colorFor(modelId, modelIds)}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* 4. Gate-verdict history strip */}
          <section className="ip-section">
            <h2 className="ip-section-title">Gate verdict stability</h2>
            <p className="ip-section-note">Is this model's gate status stable across runs, or does it flip?</p>
            <div className="ip-table-wrap">
              <table className="ip-table ip-gate-strip">
                <thead>
                  <tr>
                    <th>Model</th>
                    {gateHistoryDates.map(d => <th key={d}>{fmtDate(d)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...gateHistoryByModel.entries()].map(([modelId, byDate]) => (
                    <tr key={modelId}>
                      <td>{modelShortName(modelId)}</td>
                      {gateHistoryDates.map(d => {
                        const point = byDate.get(d);
                        return (
                          <td key={d}>
                            {point && (
                              <span
                                className="ip-gate-cell"
                                title={`${point.gateVerdict} (${point.primaryMetricValue.toFixed(3)}, n=${point.caseCount})`}
                                style={{ background: VERDICT_COLOR[point.gateVerdict] ?? 'var(--muted)' }}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 5. Diagnostic / quality-issue panel */}
          <section className="ip-section">
            <div className="ip-section-head-row">
              <h2 className="ip-section-title">Diagnostic metrics over time</h2>
              {diagnosticMetricNames.length > 0 && (
                <select className="ip-select" value={diagnosticMetric} onChange={e => setDiagnosticMetric(e.target.value)}>
                  {diagnosticMetricNames.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </div>
            <p className="ip-section-note">
              This is where a finding like a high unknown-tag rate becomes a standing trend instead of a
              one-off number read out of a single run's summary.
            </p>
            {diagnosticData.length === 0 ? (
              <p className="ip-empty-inline">No diagnostic metrics indexed yet for this activity.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={diagnosticData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={modelShortName} />
                  {modelIds.map(modelId => (
                    <Line
                      key={modelId}
                      type="monotone"
                      dataKey={modelId}
                      name={modelId}
                      stroke={colorFor(modelId, modelIds)}
                      strokeWidth={2}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* 6. Operational panel — explicitly caveated */}
          <section className="ip-section">
            <div className="ip-section-head-row">
              <h2 className="ip-section-title">Operational — throughput</h2>
              <select className="ip-select" value={operationalField} onChange={e => setOperationalField(e.target.value as typeof operationalField)}>
                <option value="avgDurationMs">Avg duration (ms)</option>
                <option value="avgTokensPerSecond">Avg tokens/sec</option>
              </select>
            </div>
            <p className="ip-caveat">
              Not comparable across servers or concurrency settings — a duration difference between
              models on different physical machines, or between a contended and an uncontended run,
              says nothing about the models themselves. Series are labeled by server for exactly this
              reason.
            </p>
            {operationalData.length === 0 ? (
              <p className="ip-empty-inline">No operational data indexed yet for this activity.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={operationalData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {operationalSeries.map((series, i) => (
                    <Line
                      key={series}
                      type="monotone"
                      dataKey={series}
                      name={series}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                      strokeWidth={2}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>
        </>
      )}
    </div>
  );
}
