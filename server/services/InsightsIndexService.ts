import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { dirname } from 'path';
import { ensureDir, INDEX_DB_PATH } from './FileService';
import { primaryMetricValue, primaryMetricName, primaryMetricCI } from './ModelSelectionService';
import { PromptService } from './PromptService';
import type { EvaluationConfig, EvaluationSummary, TaskMetrics } from '../../src/types/eval';

/**
 * Cross-run SQLite index over the per-evaluation JSON files under
 * data/evals/evaluations/ — an additive read-index, never a replacement for
 * that JSON (source of truth stays on disk). Design:
 * docs/plans/2026-09-06-evaluation-dashboard-and-sqlite-schema.md
 *
 * Bump this whenever a gate threshold in SummaryService.ts changes (e.g. the
 * classification macro-F1 floor moving off 0.90), so historical rows measured
 * against a different bar are never misread as directly comparable to new
 * ones. There is no automated linkage to SummaryService's hardcoded
 * thresholds today — this is a manual marker.
 */
export const GATE_THRESHOLD_VERSION = 'v1';

/** Synthetic marker for rows backfilled from evaluations that predate gateThresholdVersion existing at all. */
export const PRE_V1_GATE_THRESHOLD_VERSION = 'pre-v1';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS eval_runs (
  id                      TEXT PRIMARY KEY,
  evalId                  TEXT NOT NULL,
  activity                TEXT NOT NULL,
  modelId                 TEXT NOT NULL,
  serverName              TEXT,
  promptId                TEXT,
  promptVersion           INTEGER,
  promptTextHash          TEXT,
  inferenceTemperature    REAL,
  inferenceMaxTokens      INTEGER,
  inferenceSeed           INTEGER,
  comparisonMode          TEXT,
  runsPerCell             INTEGER,
  caseCount               INTEGER,
  primaryMetricName       TEXT,
  primaryMetricValue      REAL,
  ciLower                 REAL,
  ciUpper                 REAL,
  gateVerdict             TEXT,
  gateThresholdVersion    TEXT,
  groundTruthReviewStatus TEXT,
  avgDurationMs           REAL,
  avgTokensPerSecond      REAL,
  concurrency             INTEGER,
  createdAt               TEXT,
  completedAt             TEXT
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_activity_model_completed ON eval_runs(activity, modelId, completedAt);
CREATE INDEX IF NOT EXISTS idx_eval_runs_evalId ON eval_runs(evalId);
CREATE INDEX IF NOT EXISTS idx_eval_runs_gateVerdict ON eval_runs(gateVerdict);

CREATE TABLE IF NOT EXISTS eval_run_metrics (
  runId       TEXT NOT NULL REFERENCES eval_runs(id),
  metricName  TEXT NOT NULL,
  metricValue REAL,
  PRIMARY KEY (runId, metricName)
);
`;

let db: DatabaseSync | null = null;
let dbPath: string | null = null;

/** Lazily (re)opens the DB at the *current* INDEX_DB_PATH — respects FileService.configurePaths() being called after this module is imported, same live-binding contract as the rest of FileService's consumers. */
function getDb(): DatabaseSync {
  if (db && dbPath === INDEX_DB_PATH) return db;
  if (db) db.close();
  ensureDir(dirname(INDEX_DB_PATH));
  db = new DatabaseSync(INDEX_DB_PATH);
  dbPath = INDEX_DB_PATH;
  db.exec(SCHEMA_SQL);
  return db;
}

/** Test-only: closes the current connection so the next getDb() call re-opens against whatever INDEX_DB_PATH is current (e.g. after configurePaths() points at a temp dir). */
export function resetForTests(): void {
  if (db) db.close();
  db = null;
  dbPath = null;
}

function parseServerName(modelId: string): string | null {
  const idx = modelId.indexOf('::');
  return idx === -1 ? null : modelId.slice(0, idx);
}

/** sha256 of the resolved prompt version's content, or null when the prompt/version can't be resolved (e.g. a prompt deleted since the run). Never fabricated. */
function resolvePromptTextHash(promptId: string | null, promptVersion: number | null): string | null {
  if (!promptId || promptVersion == null) return null;
  const content = PromptService.getVersionContent(promptId, promptVersion);
  if (content == null) return null;
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Secondary/diagnostic metrics per activity, stored in the eval_run_metrics long table rather than as eval_runs columns so a new one never needs a migration. */
function diagnosticMetricsOf(tm: TaskMetrics): Record<string, number> {
  if (tm.taskType === 'classification') {
    const out: Record<string, number> = {
      macroF1: tm.macroF1,
      invalidLabelRate: tm.invalidLabelRate,
      formatComplianceRate: tm.formatComplianceRate,
    };
    if (tm.runToRunAgreement != null) out.runToRunAgreement = tm.runToRunAgreement;
    return out;
  }
  if (tm.taskType === 'tagging') {
    return {
      microF1: tm.microF1,
      microPrecision: tm.microPrecision,
      microRecall: tm.microRecall,
      macroLabelF1: tm.macroLabelF1,
      exactSetMatchRate: tm.exactSetMatchRate,
      unknownTagRate: tm.unknownTagRate,
      duplicateTagRate: tm.duplicateTagRate,
      formatComplianceRate: tm.formatComplianceRate,
    };
  }
  const out: Record<string, number> = {
    noPreambleRate: tm.deterministic.noPreambleRate,
    noHeadingRate: tm.deterministic.noHeadingRate,
    noFenceRate: tm.deterministic.noFenceRate,
    compressionInRangeRate: tm.deterministic.compressionInRangeRate,
    protectedTokensPreservedRate: tm.deterministic.protectedTokensPreservedRate,
    noForbiddenClaimsRate: tm.deterministic.noForbiddenClaimsRate,
    criticalUnsupportedClaimRate: tm.criticalUnsupportedClaimRate,
    selfJudgeGuardViolated: tm.selfJudgeGuardViolated ? 1 : 0,
    faithfulness: tm.medianRubric.faithfulness,
    salientCoverage: tm.medianRubric.salientCoverage,
    retrievalUtility: tm.medianRubric.retrievalUtility,
    concision: tm.medianRubric.concision,
  };
  if (tm.judgeQualified != null) out.judgeQualified = tm.judgeQualified ? 1 : 0;
  return out;
}

export interface RecordEvaluationOptions {
  /** EVAL_CONCURRENCY active during a *live* run. Omit for backfill — a historical run's actual concurrency isn't recoverable from its JSON, and guessing from today's env would misrepresent it. */
  concurrency?: number;
  /** Overrides the row's gateThresholdVersion (e.g. PRE_V1_GATE_THRESHOLD_VERSION during backfill of older runs). Defaults to GATE_THRESHOLD_VERSION. */
  gateThresholdVersionOverride?: string;
  /** Backfill-only: older evaluations predate `benchmarkProvenance` entirely, so their review status must be resolved by the caller (from the referenced test suite's own provenance) and passed in here rather than read off summary/config. */
  groundTruthReviewStatusOverride?: string | null;
}

/**
 * Builds and upserts one eval_runs row (+ its eval_run_metrics rows) per
 * model present in summary.modelSummaries, for every model that has
 * task-specific metrics available (per-model when comparisonMode === 'model'
 * via perModelTaskMetrics, else falling back to the run's aggregate
 * taskMetrics). Models with neither are skipped — e.g. a non-purpose-template
 * evaluation with no built-in assertion strategy has no TaskMetrics to index.
 *
 * This is the single row-building function used both by the live
 * write-through (ExecutionService.aggregate) and by
 * scripts/backfill-eval-index.ts, so there is never a second implementation
 * to keep in sync with the first.
 */
export function recordEvaluation(
  evalId: string,
  config: Pick<EvaluationConfig, 'comparisonMode' | 'runsPerCell' | 'resolvedInference' | 'benchmarkProvenance' | 'createdAt' | 'promptIds' | 'promptVersions'>,
  summary: EvaluationSummary,
  options: RecordEvaluationOptions = {}
): void {
  if (!summary.modelSummaries?.length) return;

  const database = getDb();
  const upsertRun = database.prepare(`
    INSERT INTO eval_runs (
      id, evalId, activity, modelId, serverName, promptId, promptVersion, promptTextHash,
      inferenceTemperature, inferenceMaxTokens, inferenceSeed, comparisonMode, runsPerCell,
      caseCount, primaryMetricName, primaryMetricValue, ciLower, ciUpper, gateVerdict,
      gateThresholdVersion, groundTruthReviewStatus, avgDurationMs, avgTokensPerSecond,
      concurrency, createdAt, completedAt
    ) VALUES (
      @id, @evalId, @activity, @modelId, @serverName, @promptId, @promptVersion, @promptTextHash,
      @inferenceTemperature, @inferenceMaxTokens, @inferenceSeed, @comparisonMode, @runsPerCell,
      @caseCount, @primaryMetricName, @primaryMetricValue, @ciLower, @ciUpper, @gateVerdict,
      @gateThresholdVersion, @groundTruthReviewStatus, @avgDurationMs, @avgTokensPerSecond,
      @concurrency, @createdAt, @completedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      activity = excluded.activity, modelId = excluded.modelId, serverName = excluded.serverName,
      promptId = excluded.promptId, promptVersion = excluded.promptVersion, promptTextHash = excluded.promptTextHash,
      inferenceTemperature = excluded.inferenceTemperature, inferenceMaxTokens = excluded.inferenceMaxTokens,
      inferenceSeed = excluded.inferenceSeed, comparisonMode = excluded.comparisonMode, runsPerCell = excluded.runsPerCell,
      caseCount = excluded.caseCount, primaryMetricName = excluded.primaryMetricName, primaryMetricValue = excluded.primaryMetricValue,
      ciLower = excluded.ciLower, ciUpper = excluded.ciUpper, gateVerdict = excluded.gateVerdict,
      gateThresholdVersion = excluded.gateThresholdVersion, groundTruthReviewStatus = excluded.groundTruthReviewStatus,
      avgDurationMs = excluded.avgDurationMs, avgTokensPerSecond = excluded.avgTokensPerSecond,
      concurrency = excluded.concurrency, createdAt = excluded.createdAt, completedAt = excluded.completedAt
  `);
  const deleteMetrics = database.prepare(`DELETE FROM eval_run_metrics WHERE runId = ?`);
  const insertMetric = database.prepare(`INSERT INTO eval_run_metrics (runId, metricName, metricValue) VALUES (?, ?, ?)`);

  const benchmarkPromptVersions = summary.benchmarkProvenance?.promptVersions ?? config.benchmarkProvenance?.promptVersions;
  const fallbackPromptId = config.promptIds?.[0];
  const fallbackPromptVersion = config.promptVersions?.find(p => p.promptId === fallbackPromptId)?.version;

  for (const modelSummary of summary.modelSummaries) {
    const modelId = modelSummary.modelId;
    const taskMetrics = summary.perModelTaskMetrics?.[modelId] ?? summary.taskMetrics;
    if (!taskMetrics) continue;

    const runId = `${evalId}::${modelId}::${taskMetrics.taskType}`;
    const ci = primaryMetricCI(taskMetrics);
    const promptEntry = benchmarkPromptVersions?.[0];
    const resolvedPromptId = promptEntry?.promptId ?? fallbackPromptId ?? null;
    const resolvedPromptVersion = promptEntry?.version ?? fallbackPromptVersion ?? null;

    upsertRun.run({
      id: runId,
      evalId,
      activity: taskMetrics.taskType,
      modelId,
      serverName: parseServerName(modelId),
      promptId: resolvedPromptId,
      promptVersion: resolvedPromptVersion,
      promptTextHash: resolvePromptTextHash(resolvedPromptId, resolvedPromptVersion),
      inferenceTemperature: summary.resolvedInference?.temperature ?? config.resolvedInference?.temperature ?? null,
      inferenceMaxTokens: summary.resolvedInference?.maxTokens ?? config.resolvedInference?.maxTokens ?? null,
      inferenceSeed: summary.resolvedInference?.seed ?? config.resolvedInference?.seed ?? null,
      comparisonMode: config.comparisonMode ?? null,
      runsPerCell: config.runsPerCell ?? null,
      caseCount: taskMetrics.gate.caseCount,
      primaryMetricName: primaryMetricName(taskMetrics.taskType),
      primaryMetricValue: primaryMetricValue(taskMetrics),
      ciLower: ci.lower,
      ciUpper: ci.upper,
      gateVerdict: taskMetrics.gate.verdict,
      gateThresholdVersion: options.gateThresholdVersionOverride ?? GATE_THRESHOLD_VERSION,
      groundTruthReviewStatus:
        options.groundTruthReviewStatusOverride
        ?? summary.benchmarkProvenance?.reviewStatus
        ?? config.benchmarkProvenance?.reviewStatus
        ?? null,
      avgDurationMs: modelSummary.avgDurationMs ?? null,
      avgTokensPerSecond: modelSummary.avgTokensPerSecond ?? null,
      concurrency: options.concurrency ?? null,
      createdAt: config.createdAt ?? null,
      completedAt: summary.completedAt ?? null,
    });

    deleteMetrics.run(runId);
    for (const [metricName, metricValue] of Object.entries(diagnosticMetricsOf(taskMetrics))) {
      insertMetric.run(runId, metricName, metricValue);
    }
  }
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

/** Latest row per model for one activity — the fastest path to "which model wins right now." */
export function getLeaderboard(activity: string): LeaderboardRow[] {
  const rows = getDb().prepare(`
    SELECT er.* FROM eval_runs er
    INNER JOIN (
      SELECT modelId, MAX(completedAt) AS latestCompletedAt
      FROM eval_runs WHERE activity = ? GROUP BY modelId
    ) latest ON er.modelId = latest.modelId AND er.completedAt = latest.latestCompletedAt
    WHERE er.activity = ?
    ORDER BY er.primaryMetricValue DESC
  `).all(activity, activity) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    modelId: r.modelId as string,
    serverName: r.serverName as string | null,
    primaryMetricName: r.primaryMetricName as string,
    primaryMetricValue: r.primaryMetricValue as number,
    ciLower: r.ciLower as number,
    ciUpper: r.ciUpper as number,
    gateVerdict: r.gateVerdict as string,
    caseCount: r.caseCount as number,
    groundTruthReviewStatus: r.groundTruthReviewStatus as string | null,
    completedAt: r.completedAt as string | null,
    evalId: r.evalId as string,
  }));
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

/** Every run's primary metric + CI for one activity, across all evaluations — not scoped to one prompt lineage like GET /evaluations/:id/history. */
export function getTrend(activity: string, modelId?: string): TrendPoint[] {
  const query = modelId
    ? `SELECT evalId, modelId, completedAt, primaryMetricValue, ciLower, ciUpper, gateVerdict, caseCount FROM eval_runs WHERE activity = ? AND modelId = ? ORDER BY completedAt ASC`
    : `SELECT evalId, modelId, completedAt, primaryMetricValue, ciLower, ciUpper, gateVerdict, caseCount FROM eval_runs WHERE activity = ? ORDER BY completedAt ASC`;
  const params = modelId ? [activity, modelId] : [activity];
  const rows = getDb().prepare(query).all(...params) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    evalId: r.evalId as string,
    modelId: r.modelId as string,
    completedAt: r.completedAt as string | null,
    primaryMetricValue: r.primaryMetricValue as number,
    ciLower: r.ciLower as number,
    ciUpper: r.ciUpper as number,
    gateVerdict: r.gateVerdict as string,
    caseCount: r.caseCount as number,
  }));
}

export interface DiagnosticPoint {
  evalId: string;
  modelId: string;
  completedAt: string | null;
  metricName: string;
  metricValue: number;
}

/** Secondary/diagnostic metrics (unknownTagRate, invalidLabelRate, etc.) over time for one activity — where a finding like "37% unknown-tag rate" becomes a standing trend instead of a one-off summary.json read. */
export function getDiagnostics(activity: string, modelId?: string): DiagnosticPoint[] {
  const query = `
    SELECT er.evalId, er.modelId, er.completedAt, erm.metricName, erm.metricValue
    FROM eval_run_metrics erm
    INNER JOIN eval_runs er ON er.id = erm.runId
    WHERE er.activity = ? ${modelId ? 'AND er.modelId = ?' : ''}
    ORDER BY er.completedAt ASC
  `;
  const params = modelId ? [activity, modelId] : [activity];
  const rows = getDb().prepare(query).all(...params) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    evalId: r.evalId as string,
    modelId: r.modelId as string,
    completedAt: r.completedAt as string | null,
    metricName: r.metricName as string,
    metricValue: r.metricValue as number,
  }));
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

/** Explicitly caveated in the UI layer: not comparable across servers or concurrency settings, per the baseline doc's Methodology Caveat. */
export function getOperational(activity: string): OperationalPoint[] {
  const rows = getDb().prepare(`
    SELECT evalId, modelId, serverName, completedAt, avgDurationMs, avgTokensPerSecond, concurrency
    FROM eval_runs WHERE activity = ? ORDER BY completedAt ASC
  `).all(activity) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    evalId: r.evalId as string,
    modelId: r.modelId as string,
    serverName: r.serverName as string | null,
    completedAt: r.completedAt as string | null,
    avgDurationMs: r.avgDurationMs as number | null,
    avgTokensPerSecond: r.avgTokensPerSecond as number | null,
    concurrency: r.concurrency as number | null,
  }));
}

/** Distinct activities actually indexed so far — drives the dashboard's activity filter without hardcoding the three built-in task types. */
export function listActivities(): string[] {
  const rows = getDb().prepare(`SELECT DISTINCT activity FROM eval_runs ORDER BY activity`).all() as Array<{ activity: string }>;
  return rows.map(r => r.activity);
}
