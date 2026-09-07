// Track H: cross-run Insights dashboard client — reads the SQLite-backed
// index (server/services/InsightsIndexService.ts) exposed at
// /api/eval/insights/*. Same apiFetch/BASE convention as src/api/eval.ts.
const BASE = `${import.meta.env.BASE_URL}api/eval/insights`.replace(/\/\/+/g, '/');

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface LeaderboardRow {
  modelId: string;
  serverName: string | null;
  primaryMetricName: string;
  primaryMetricValue: number;
  ciLower: number;
  ciUpper: number;
  gateVerdict: string;
  caseCount: number;
  groundTruthReviewStatus: string | null;
  completedAt: string | null;
  evalId: string;
}

export interface TrendPoint {
  evalId: string;
  modelId: string;
  completedAt: string | null;
  primaryMetricValue: number;
  ciLower: number;
  ciUpper: number;
  gateVerdict: string;
  caseCount: number;
}

export interface DiagnosticPoint {
  evalId: string;
  modelId: string;
  completedAt: string | null;
  metricName: string;
  metricValue: number;
}

export interface OperationalPoint {
  evalId: string;
  modelId: string;
  serverName: string | null;
  completedAt: string | null;
  avgDurationMs: number | null;
  avgTokensPerSecond: number | null;
  concurrency: number | null;
}

export async function listInsightActivities(): Promise<string[]> {
  return apiFetch('/activities');
}

export async function getInsightsLeaderboard(activity: string): Promise<LeaderboardRow[]> {
  return apiFetch(`/leaderboard?activity=${encodeURIComponent(activity)}`);
}

export async function getInsightsTrend(activity: string, modelId?: string): Promise<TrendPoint[]> {
  const q = modelId ? `&modelId=${encodeURIComponent(modelId)}` : '';
  return apiFetch(`/trend?activity=${encodeURIComponent(activity)}${q}`);
}

export async function getInsightsDiagnostics(activity: string, modelId?: string): Promise<DiagnosticPoint[]> {
  const q = modelId ? `&modelId=${encodeURIComponent(modelId)}` : '';
  return apiFetch(`/diagnostics?activity=${encodeURIComponent(activity)}${q}`);
}

export async function getInsightsOperational(activity: string): Promise<OperationalPoint[]> {
  return apiFetch(`/operational?activity=${encodeURIComponent(activity)}`);
}
