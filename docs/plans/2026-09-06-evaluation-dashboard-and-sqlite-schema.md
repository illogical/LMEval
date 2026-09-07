# Cross-Run Evaluation Dashboard + SQLite Index Schema

## Context

`docs/plans/2026-09-06-baseline-model-evaluation.md` ran six local models
across classification/tagging/summarization and, in its "On introducing a
local SQL database" section, recommended a lightweight SQLite index over the
existing per-evaluation JSON files — motivated by findings that only become
visible in aggregate: several gate verdicts were `inconclusive` purely
because of small case counts, tagging's unknown-tag rate was flagged as "a
bigger problem than raw F1," and duration numbers needed cross-run,
cross-server bookkeeping to be read safely at all.

Today there is no view that answers "across everything run so far, which
model should we standardize on for tagging, and is that answer stable or
noisy." The closest thing, `GET /evaluations/:id/history`
(`server/routes/evaluations.ts:113-152`), full-scans every directory under
`data/evals/evaluations/` on each request, is scoped only to evaluations
that share a prompt ID with the one being viewed, and reduces every
model/prompt to a single `avgCompositeScore` — it can't show macro-F1 vs.
unknown-tag-rate vs. gate verdict, and it can't compare across activities or
the full model roster (Tiny-Tower vs. M5 Max) at once.
`src/components/results/TrendView.tsx` (the Results page's existing "Trend"
tab) has the same scoping: one eval's own prompt lineage, one composite
score, not a cross-activity leaderboard.

This doc designs (a) the dashboard views worth building and the chart type
that fits each metric family LMEval already computes, and (b) a SQLite
schema sized for those views — including backfilling all evaluations
already run, so nothing that's already been executed needs to be re-run.
This is a design document; no code is written here.

## Gap analysis (detail)

- `evaluations.ts:117-152`'s `/history` route reads `readJson` on every
  `config.json`/`summary.json` under `EVALUATIONS_DIR` per request — an O(n)
  scan with no caching, acceptable today only because the run count is small.
- It filters to evaluations where `otherConfig.promptIds.some(p =>
  config.promptIds.includes(p))` — by construction this cannot show a
  cross-activity or cross-model-roster comparison; it can only ever plot the
  history of one prompt lineage.
- It emits `EvaluationHistoryEntry { evalId, date, modelScores,
  promptScores }` where both score maps are `Record<string, number>` sourced
  from `summary.modelSummaries[].avgCompositeScore` /
  `summary.promptSummaries[].avgCompositeScore` — a single number, discarding
  macro-F1, unknown-tag-rate, gate verdict, and CI bounds entirely.
- `TrendView.tsx:24-33` consumes exactly that shape and plots it with
  `recharts`' `LineChart` — a reasonable pattern to generalize, not to
  replace.

## Dashboard views, mapped to metrics `SummaryService.ts` already computes

For each view: what it shows, why that chart type, and which decision it
supports.

### 1. Per-activity leaderboard
Table of the latest run per model for one activity: `macro-F1` (or `micro-F1`
for tagging), `gateVerdict`, `caseCount`, sortable. This is the fastest path
to "which model wins right now" and should visually gray out (not hide) any
row whose `groundTruthReviewStatus` is `pending-human-review`, since every
current built-in benchmark carries that advisory
(`docs/plans/2026-09-06-baseline-model-evaluation.md`'s standing caveat).

### 2. Metric trend over time, generalized past one prompt lineage
Line chart per model, one line per model, x-axis = `completedAt`, y-axis =
the activity's primary metric (`accuracy`/`macroF1` for classification,
`microF1`/`jaccardMean` for tagging, `medianRubric.weighted` for
summarization). Reuses `TrendView.tsx`'s existing line-per-series/dot-marker
pattern (`TrendView.tsx:98-124`), but keyed by `activity + primaryMetric`
across **all** evaluations, not evaluations sharing a prompt ID. Point
markers colored/shaped by `gateVerdict` so a pass/fail/inconclusive/advisory
run is visible without a separate legend lookup.

### 3. Confidence-interval band view
For every metric that already carries a bootstrap CI (`accuracyCI`,
`jaccardCI`, `weightedCI` in `SummaryService.ts`), plot point + shaded CI
band per run rather than a bare point. This is the single highest-value
chart addition: the baseline doc's granite4.1:8b classification result
(85.4% point estimate, CI straddling the 0.90 gate) is exactly the case a
bare line chart hides and a CI band makes obvious — the reader can tell
"this run's uncertainty spans the gate" from "this model regressed" at a
glance, instead of having to open the run and read `neededCases`.

### 4. Gate-verdict history strip
Small-multiples or a heatmap: rows = model, columns = run (chronological),
cell color = `pass`/`fail`/`inconclusive`/`advisory`. Answers "is this
model's gate status stable, or does it flip run to run" — a question no
single-run view can answer, and the kind of instability that would
undermine trusting any one leaderboard snapshot.

### 5. Diagnostic/quality-issue panel
Separate from the headline metric, tracked over time per model:
`invalidLabelRate`, `unknownTagRate`, `duplicateTagRate`,
`compressionInRangeRate`, `criticalUnsupportedClaimRate`,
`formatComplianceRate`. Bar or line chart, one series per diagnostic metric.
This is where the baseline doc's ~37% tagging unknown-tag-rate finding
becomes a standing, glanceable fact instead of something read once out of a
`summary.json` and then forgotten in the next run. Directly extends
`docs/TASK.md` §5.4's "contract-violations strip" proposal from a single-run
Results-page idea into a cross-run trend.

### 6. Operational/throughput panel — explicitly caveated
`avgDurationMs` / `avgTokensPerSecond`, faceted by `serverName` and (once
captured) the `EVAL_CONCURRENCY` value active during the run. The panel
itself carries a visible label — "not comparable across servers or
contended runs" — matching the baseline doc's own Methodology Caveat
section, rather than silently averaging Tiny-Tower and M5 Max numbers
together or blending a contended run into an uncontended one's average.

### 7. Drill-down link-out
Every leaderboard row / trend point links to the existing
`src/pages/ResultsPage.tsx` for that `evalId`. The dashboard is a
cross-run index; per-run detail (Scoreboard/Breakdown/Compare/Detail/Trend
tabs) already exists and should not be duplicated.

### 8. Cross-cutting filters
Activity, model, server, prompt version, date range, gate verdict — since
data now spans many runs, many prompts, and two physical servers at once.

## Decision-making framing

| Question | View(s) that answer it |
|---|---|
| Which model should we standardize on for task X? | Leaderboard + CI band + gate-verdict-history stability — not the leaderboard alone, since a leaderboard implies a total order CIs may not support. |
| Did we actually regress, or is this noise? | CI band + a saved baseline reference line (reuse `TrendView`'s existing baseline-save concept). |
| Where is data quality actually broken, independent of the model race? | Diagnostic panel — this is exactly how a 37% unknown-tag-rate stops being buried under a middling F1 score. |
| Is this verdict even trustworthy? | `groundTruthReviewStatus` surfaced directly on the leaderboard/trend, not buried in provenance metadata. |

## Where this lives

A new page (proposed `src/pages/InsightsPage.tsx`), not an extension of
`src/pages/DashboardPage.tsx` — that page is a live in-flight-run monitor
over WebSocket (`DashboardPage.tsx`'s cell-status-map-by-`promptId::modelId`
pattern), a different job from historical cross-run analytics. Reuse
`recharts` (already a dependency, used by `TrendView`/`CompareView`/
`BreakdownView`) and existing helpers like `modelShortName` for visual
consistency with the rest of the Results UI.

## SQLite schema

Two tables, not one — this supersedes the single-table sketch in the
baseline doc — to get a fast leaderboard/trend hot path while leaving room
to add new diagnostic metrics later without a migration.

### `eval_runs` — one row per (evalId × modelId × activity)

```
id                        TEXT PRIMARY KEY   -- evalId + modelId + activity, deterministic
evalId                    TEXT NOT NULL
activity                  TEXT NOT NULL      -- 'classification' | 'tagging' | 'summarization'
modelId                   TEXT NOT NULL      -- server-qualified, e.g. 'Tiny-Tower::granite4.1:8b'
serverName                TEXT               -- parsed out of modelId once at write time, not per-query
promptId                  TEXT
promptVersion             INTEGER
promptTextHash            TEXT               -- sha256, plus a pointer to the .md version file
inferenceTemperature      REAL
inferenceMaxTokens        INTEGER
inferenceSeed             INTEGER
comparisonMode            TEXT               -- 'model' | 'prompt' | 'matrix'
runsPerCell               INTEGER
caseCount                 INTEGER
primaryMetricName         TEXT               -- 'macroF1' | 'microF1' | 'weightedRubric' etc.
primaryMetricValue        REAL
ciLower                   REAL
ciUpper                   REAL
gateVerdict               TEXT               -- 'pass' | 'fail' | 'inconclusive' | 'advisory'
gateThresholdVersion      TEXT               -- so a later gate re-tune doesn't misread old history
groundTruthReviewStatus   TEXT               -- 'pending-human-review' | 'approved', from suite provenance
avgDurationMs             REAL
avgTokensPerSecond        REAL
concurrency               INTEGER            -- EVAL_CONCURRENCY active during the run, if known
createdAt                 TEXT
completedAt               TEXT
```

Indexes: `(activity, modelId, completedAt)` for trend queries, `(evalId)` for
drill-down, `(gateVerdict)` for filtering.

### `eval_run_metrics` — long/EAV table for activity-specific diagnostics

```
runId       TEXT NOT NULL REFERENCES eval_runs(id)
metricName  TEXT NOT NULL   -- 'invalidLabelRate' | 'unknownTagRate' | 'duplicateTagRate' |
                             -- 'compressionInRangeRate' | 'criticalUnsupportedClaimRate' |
                             -- 'formatComplianceRate' | 'judgeQualified' | ...
metricValue REAL
PRIMARY KEY (runId, metricName)
```

New diagnostic metrics (e.g. a future per-tag-group recall from
`docs/TASK.md` §5.3) land here without a schema migration — the whole reason
for splitting this out from `eval_runs` rather than adding another dozen
nullable columns.

### Why these specific design choices

- **`serverName` and `modelId` both stored**, not derived at query time from
  the `ServerName::model:tag` string — "all models on M5 Max" becomes a plain
  `WHERE` clause instead of a string-split in every query.
- **`gateThresholdVersion` recorded per row** so re-tuning a gate later (e.g.
  moving classification's macro-F1 floor off 0.90) doesn't retroactively
  misread history that was measured against a different bar.
- **`groundTruthReviewStatus` stored per row**, not just in the source suite's
  JSON provenance, so the dashboard can flag/gray a verdict resting on
  unreviewed benchmark data without a join back to `data/evals/test-suites/`
  on every read.
- **Operational fields kept but explicitly non-comparable across servers or
  concurrency** — `serverName` and `concurrency` are captured specifically so
  the dashboard can exclude/flag contended runs rather than blending them
  into an average, per the baseline doc's Methodology Caveat section.

## Backfill, not re-run

Every completed evaluation under `data/evals/evaluations/{id}/` already has
`config.json` (prompt IDs, model IDs, inference, `comparisonMode`) and
`summary.json` (`taskMetrics` / `perModelTaskMetrics`, carrying all the
CI/gate/diagnostic fields the schema wants). A one-time backfill script,
`scripts/backfill-eval-index.ts`, can walk every existing evaluation
directory and populate both tables retroactively — including the pilot and
in-progress Phase 2 runs from the baseline doc — with **no need to re-run
any already-completed evaluation** (granite3.3:8b, granite4.1:8b, etc.).

Two fields aren't present in historical JSON and need an explicit backfill
default rather than a derived value:
- `gateThresholdVersion` — the concept didn't exist yet when older runs
  executed; backfill as a synthetic `"pre-v1"` marker.
- `groundTruthReviewStatus` — not persisted per-run historically; backfill by
  cross-referencing the test suite's `provenance.reviewStatus` from
  `data/evals/test-suites/built-in/*.json` at backfill time (stable, and
  still reads `pending-human-review` as of this writing).

The backfill script's row-building logic should be the same function wired
into the live write-through step at the end of `SummaryService.aggregate` —
one function, two call sites (backfill CLI + live aggregate), so there is
never a second implementation to keep in sync with the first.

## Side benefit, out of scope here

This index also fixes `/evaluations/:id/history`'s full-directory-scan
pattern (querying `eval_runs` is O(1) with an index instead of O(n) file
reads), but rewriting that route is not part of this design doc.

## Next steps

1. Land the two-table schema and the shared row-building function.
2. Write and run `scripts/backfill-eval-index.ts` against the existing
   `data/evals/evaluations/` tree.
3. Wire the write-through call into `SummaryService.aggregate`.
4. Build `InsightsPage.tsx` against the populated index, starting with the
   leaderboard and CI-band views (highest decision-making value per the
   framing table above).
