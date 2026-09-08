# Run History & Insights UX Improvement Plan

## Context

`InsightsPage.tsx` (`src/pages/InsightsPage.tsx` + `src/pages/InsightsPage.css`) is the "Run History & Insights" page. A review against the current screenshot turned up real bugs, not just polish opportunities:

1. **The page cannot scroll.** `.insights-page` never sets a height/overflow, so under the global layout (`#root { overflow: hidden }` in `src/index.css`) any content past the viewport is unreachable. Every sibling full-page component (`SummaryPage.css`, `ConfigPage.css`) sets `height: 100%; overflow-y: auto;` — `InsightsPage.css` is missing this. Confirmed there is no hidden section below "Operational — throughput" in the JSX — it's the last section in the file — so the fix recovers the tail of that section, not a hidden feature.
2. **Gate verdict stability is misaligned and wastes space.** `.ip-gate-strip td { text-align: center }` centers each verdict square, but the `<th>` header cells have no matching `text-align`, so header text (e.g. "9/7/2026") sits left-aligned while the square below it is centered — they visibly don't line up. The table also uses `width: 100%` (`.ip-table`), so with only 1–2 date columns, each date column stretches to fill the remaining ~900px of the card, leaving a tiny square adrift in a huge cell.
3. **Diagnostic metrics over time is not useful yet.** With only one completed run per model, `pivotDiagnostics()` produces a single x-axis point, so the "line chart" is really just disconnected dots — there's nothing to trend. The section doesn't even show the "need more data" messaging that the Metric-trend section already has.

The goal of this plan is to fix the scroll bug, make the Gate verdict section align correctly and earn its space with more useful information, and make every time-series section (Metric trend, Diagnostic metrics, Operational throughput) degrade gracefully to a useful single-run view instead of a sparse/broken one — while documenting how to verify the multi-run path once a second batch of evaluation runs exists (to be run in a separate session).

## 1. Fix page scrolling

**File:** `src/pages/InsightsPage.css`

Add to `.insights-page`, matching the pattern already used in `ConfigPage.css` / `SummaryPage.css`:

```css
.insights-page {
  height: 100%;
  overflow-y: auto;
  /* ...existing rules... */
}
```

This is a pure bug fix — no other layout changes needed for the container itself.

## 2. Gate verdict stability: fix alignment, stop wasting space, add data

**File:** `src/pages/InsightsPage.tsx` (~lines 281-315), `src/pages/InsightsPage.css` (`.ip-gate-strip`, `.ip-table`)

**Alignment / space fixes:**
- Add `text-align: center` to `.ip-gate-strip th` (not just `td`) so date headers sit above their squares.
- Give date columns a fixed/max width (e.g. `.ip-gate-strip th, .ip-gate-strip td { width: 64px; }`) instead of letting `.ip-table`'s `width: 100%` stretch them. Let the `Model` column keep its natural width; the table already sits inside `.ip-table-wrap` (`overflow-x: auto`), so it can scroll horizontally once there are many run dates rather than each column ballooning.

**New data to include** (the section currently shows only colored squares and a hover tooltip):
- **Runs column**: count of runs recorded for that model (`byModel.get(modelId)!.size`).
- **Flips column**: number of times the verdict changed between consecutive runs for that model — a single glanceable "is this model stable" signal instead of requiring the reader to scan every square. Compute alongside the existing `gateHistoryByModel` memo, e.g. via a small `countFlips(sortedVerdicts: string[])` helper.
- **Inline metric value**: the hover tooltip already surfaces this, but also print the model's latest metric value as small muted text under its name in the first column, so the table communicates something without requiring a hover.
- **Sort order**: order rows "least stable first" (most flips, or most recent fail) so models needing attention surface at the top instead of an arbitrary order.

This keeps Gate verdict stability as its own section rather than folding it into the Metric-trend chart — a compact grid stays the fastest way to scan verdicts across many models/runs at once, something a colored-dot trend line can't match once there are more than a few models.

## 3. Single-run bar-chart fallback for all three time-series sections

**File:** `src/pages/InsightsPage.tsx`

Apply one consistent rule everywhere a chart currently assumes multiple run dates exist:

- **1 unique run date** → render a `BarChart` (Recharts) with one bar per model (Metric trend, Diagnostics) or per model+server (Operational), showing that single run's value.
- **2+ unique run dates** → keep today's `AreaChart` / `LineChart` trend behavior unchanged.

This replaces both the current "four disconnected dots" diagnostics chart and the current bare text message in Metric trend with something useful on day one, and automatically upgrades to a real trend once there's a second run.

Implementation shape:
- Add a small shared helper, e.g. `uniqueDateCount(points, dateField)`, used by all three sections to pick which chart to render.
- **Metric trend**: when there's 1 date, show a bar chart of `primaryMetricValue` per model. Showing the CI band as a thin error-bar per bar is a nice-to-have (Recharts `ErrorBar`) — skip it if it adds real complexity; a plain bar with the CI printed in the tooltip is an acceptable fallback.
- **Diagnostic metrics**: bar chart of the selected `metricName`'s value per model.
- **Operational**: bar chart of the selected field (`avgDurationMs` / `avgTokensPerSecond`) per model+server, keeping the existing "not comparable across servers" caveat text.
- Adjust each section's explanatory copy so it reads correctly in both modes (e.g. Metric trend's note currently only makes sense for the CI-band case).

No backend or type changes are required — `LeaderboardRow` / `TrendPoint` / `DiagnosticPoint` / `OperationalPoint` already carry everything needed for a single-run bar view.

## 4. Verifying the multi-run path (follow-up, not part of this change)

A second batch of evaluation runs will be produced in a separate session. Once it exists, confirm the trend/line-chart path still renders correctly:

1. Run a second evaluation for the same activity/models already indexed (see the `lmeval-runner` skill / `.agents/skills/lmeval-evaluation-workflow` for the local run command). Do **not** run it concurrently with any other evaluation against the same LMApi server — timeouts don't cancel server-side work and retries cascade-fail everything sharing that box.
2. Confirm the new run gets indexed (`InsightsIndexService.recordEvaluation()` runs automatically after `ExecutionService.aggregate()`, or via `npm run insights:backfill`).
3. Reload `/insights` and verify:
   - Metric trend switches from bar chart to the existing CI-band area chart.
   - Diagnostic metrics switches from bar chart to a real multi-point line.
   - Gate verdict stability grows a second date column, alignment holds, and the new "Flips" column updates if any model's verdict changed.

## Files to touch

- `src/pages/InsightsPage.tsx` — gate-strip data/columns, single-run vs. multi-run chart branching for all three time-series sections.
- `src/pages/InsightsPage.css` — scroll fix on `.insights-page`, `.ip-gate-strip` header alignment + column width, small-text style for the inline metric value.

No server-side or type changes are anticipated; all data already flows through the existing types in `src/api/insights.ts`.

## Verification

- Start the app and open `/insights`:
  - Confirm the page scrolls and the Operational section's bottom is fully reachable.
  - Confirm Gate verdict stability's header lines up with its squares, columns aren't oversized, and the new Runs/Flips columns render sensible values against current single-run data (Runs=1, Flips=0 for every model).
  - Confirm Metric trend and Diagnostic metrics now render bar charts (not messages/broken dots) against current single-run data, and Operational still shows its chart correctly.
- Run existing frontend tests under `src/test/pages/` if any cover `InsightsPage`; add/update a test if one exists for this page's rendering logic.
- Manually re-verify per Section 4 once a second run batch exists in a later session.
