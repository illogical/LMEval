# Eval Wizard — Results Page Redesign

> **Status**: Planned
> **Context**: Step 4 (`/eval/results/:id`) is the payoff screen of the whole product, but none of its five tabs answer the two questions LMEval exists to answer. Compare makes the user hand-pick two opaque cell IDs and shows two `<pre>` blocks; Metrics renders single-series bar charts that compare nothing; Timeline fabricates a one-point line chart; every view is keyed off generated `testCaseId` slugs so nothing on screen says what was actually tested.

---

## Why this change

Per `README.md` and `docs/SPECIFICATION.md` §5.3, LMEval replaces prompt-engineering-by-intuition with evidence. Two questions:

1. **Which model is the best fit for this prompt?**
2. **Did my prompt edit actually help, and where is it still failing?**

The current Results page answers neither.

- **Compare** (`CompareView.tsx`) asks the user to hand-pick two cells from a flat dropdown of opaque IDs (`client-mtmdyqbk-xpxgjk`), then shows two `<pre>` blocks. Nothing prevents selecting a cell against itself. No score delta, no assertion delta, no reason to use it.
- **Metrics** (`MetricsView.tsx`) renders three bar charts that each plot **one** model. A single-series bar chart conveys no information; a bar chart's job is comparison.
- **Timeline** (`TimelineView.tsx:13-21`) fabricates a one-point line chart out of the *current* summary. It is structurally incapable of showing a trend. Meanwhile `GET /api/eval/prompts/:id/history` already returns exactly the multi-eval score history the chart pretends to show, and the Results page never calls it.
- Every view keys rows off `testCaseId`, a generated slug, so nothing on screen says what was actually tested.
- Rich data that is already computed is never rendered: `modelSummaries[].perspectiveScores`, `pairwiseRankings`, `retryAttempts`, `errorType`, and `SummaryService.computeConsistency()` (written, exported, never called).

**Intended outcome:** a Results page whose default state states a **verdict**, whose second click explains **why**, and whose third click shows the **evidence** — with charts that only render when they actually compare something.

**Scope boundary:** a separate workstream owns `Scoreboard.tsx` / `HeatmapMatrix.tsx`. This plan touches those two files only through a shared label helper and the `onCellClick` contract (see *Coordination* below).

---

## Design

### Information architecture

Replace the flat 5-tab strip with a **persistent verdict header** plus the tab row:

```
┌────────────────────────────────────────────────────────────────────┐
│ VERDICT   granite4.1:8b wins · 4.2/5 · 100% pass · 1.0s avg        │
│           ↑ +0.4 vs baseline "v1"        [Save Baseline] [MD][HTML]│
├────────────────────────────────────────────────────────────────────┤
│ Scoreboard │ Breakdown │ Compare │ Detail │ Trend                  │
└────────────────────────────────────────────────────────────────────┘
```

The verdict line is phrased from `config.comparisonMode` (`src/types/eval.ts:92`), which already exists and is currently unused by the Results page:

| `comparisonMode` | Verdict sentence |
|---|---|
| `model` | "**granite4.1:8b** is the best fit — 4.2/5, 100% pass, 1.0s avg. Runner-up qwen3.5 trails by 0.6." |
| `prompt` | "**Prompt B** improves on A by +0.4 (4.2 → 4.6), and fixes 2 of 3 failing test cases." |
| `matrix` / unset | "Best cell: **granite4.1:8b × Prompt B** — 4.6/5." |

Add a one-line **caveat chip** when the verdict is weak: `n=1 run per cell — differences under ±0.3 are noise` (from `config.runsPerCell`), or `2 of 24 cells failed`. This is what turns a number into an "educated guess" the user can actually trust.

`RegressionBanner` folds into this header as a delta chip rather than a separate full-width band.

### Tab 1 — Scoreboard

Owned by the separate Scoreboard workstream; unchanged by this plan.

### Tab 2 — Breakdown (replaces "Metrics")

**Rule enforced across the tab: never render a chart with fewer than two comparable series or two categories.** If only one model ran, the chart is replaced with a stat tile row. This directly fixes the meaningless single-bar charts.

Ordered by decision value:

1. **Score vs. Latency scatter** — X = `avgDurationMs`, Y = `avgCompositeScore`, one point per model (per model × prompt in matrix mode), point size = success rate. Quadrant guides split at the median. This *is* the model-fit decision: the upper-left quadrant is "fast and good." Nothing in the app currently shows this tradeoff.
2. **Per-perspective grouped bars** — models on X, one bar per rubric perspective (Accuracy / Completeness / Conciseness / …). Reads straight off `modelSummaries[].perspectiveScores`, already computed in `SummaryService.ts:42-62` and never displayed. This is where "why did it win" lives: a model can win overall while being the worst at conciseness, which tells the user what to fix in the prompt.
3. **Hardest test cases** — horizontal stacked bars per test case (pass / fail / error across models), sorted worst-first, labeled with the real user message. Answers "which inputs break this prompt."
4. **Assertion failure breakdown** — horizontal bars of the most-failed assertion types with counts and one example reason each. The most directly actionable prompt feedback on the page; each row deep-links into Detail on a failing cell.
5. **Consistency** — per-model std-dev of composite score. Rendered **only when `runsPerCell > 1`**; otherwise the section is omitted with a hint that raising runs-per-cell enables it. Wires up the already-written `SummaryService.computeConsistency()`.
6. **Performance** — a collapsed-by-default section holding the current latency / tokens-per-second / token-usage bars. Real data, but secondary to quality, and belongs below the fold.

Follow the `dataviz` skill for palette, axis, and legend treatment; keep `scoreToColor()` (`src/lib/scoring.ts`) as the single source of score→color.

### Tab 3 — Compare (rebuilt)

Driven by an **axis**, not by two arbitrary dropdowns.

```
Compare across: [ Models ▾ ]   Holding: Test case #3 "Summarize this…" ▾   [2-up | All ]
```

- The axis defaults from `config.comparisonMode` (`model` → vary models; `prompt` → vary prompt A/B; `matrix` → user picks).
- The "holding" selector pins the fixed dimension. A/B pickers are then restricted to valid counterparts and are labeled with score and pass/fail, e.g. `qwen3.5 — 4.6 ✓4/4`, so the choice is informed. **A and B can never be the same cell.**
- **2-up body**: two response panels with a **delta ribbon** between them showing composite Δ, per-perspective Δ, and an assertion diff (`A passed / B failed: json-schema, icontains "refund"`). If `pairwiseRankings` covers the pair, show the judge's verdict and justification — this data is produced today and displayed nowhere.
- **Diff toggle** keeps reusing `PromptDiffView` (`src/components/prompt/PromptDiffView.tsx`).
- **All (N-up) toggle**: one column per value on the varying axis, each with score chip and assertion pips — for eyeballing 4 models at once on the same input.
- **Deep link**: clicking a heatmap cell opens Compare with that cell as A, and its strongest counterpart on the varying axis pre-selected as B (currently a heatmap click dead-ends in Detail).

### Tab 4 — Detail

Keep the cell drill-down, fix three things:

- Show deterministic assertions **and** judge scores together — currently mutually exclusive (`DetailView.tsx:47`).
- Render `retryAttempts` and `errorType` for failed cells (both stored, never shown).
- Add prev/next cell navigation and a "Compare this cell" button back into Tab 3.

### Tab 5 — Trend (Timeline, made real)

Fetch actual history instead of faking one point:

- Call the new `GET /api/eval/evaluations/:id/history` (below), which returns per-eval composite scores over time for the models/prompts in this eval.
- One line per model (model mode) or per prompt (prompt mode), a `ReferenceDot` marking the current eval, and a dashed `ReferenceLine` at the saved baseline score.
- **Honest empty state**: with fewer than 2 points, render no chart — show "This is the first run for this prompt. Save it as a baseline, then re-run after editing to see the trend," with the Save Baseline action inline. Never draw a one-point line chart again.

---

## Backend changes

All new fields are **optional** so previously-persisted `summary.json` files keep loading.

1. **`server/services/ExecutionService.ts`** — extract the test-case resolution at lines ~346-358 (`testSuiteId` / `inlineTestCases` / `userMessage`) into an exported `resolveTestCases(config): TestCase[]`, and call it from both the run path and the new route below. No behavior change.
2. **`server/routes/evaluations.ts`** — add `GET /:id/testcases` returning the resolved `TestCase[]` for the eval, so every view can label rows with the real user message instead of `client-mtmdyqbk-xpxgjk`.
3. **`server/services/SummaryService.ts`** — extend `computeSummary()` to also emit:
   - `testCaseSummaries: Array<{ testCaseId; passRate; avgCompositeScore?; byModel: Record<string, { score?: number; pass: boolean }> }>`
   - `assertionSummary: Array<{ type; metric?; total; passed; failed; sampleReason? }>`
   - `consistency?: Record<string, number>` — call the existing, currently-unused `computeConsistency()`, populated only when `runsPerCell > 1`
   - `perspectiveIds: string[]` — stable rubric axis order for the grouped-bar chart
4. **`server/routes/evaluations.ts`** — add `GET /:id/history`, generalizing the per-prompt logic in `server/routes/prompts.ts:78-114` to an eval's whole prompt set. Returns `Array<{ evalId; date; modelScores: Record<string, number>; promptScores: Record<string, number> }>` sorted ascending.
5. **`src/types/eval.ts`** — add the new optional fields to `EvaluationSummary` (mirrored in `server/types/`).

## Frontend changes

| File | Change |
|---|---|
| `src/lib/labels.ts` *(new)* | `testCaseLabel(tc, idx)`, `modelShortName(modelId)`, `promptLabel(id, version)`. One source of truth for every list, dropdown, axis, and heatmap header. Replaces the ad-hoc `modelId.split('/').pop()` repeated in `CompareView.tsx:20`, `TimelineView.tsx:23`, `MetricsView`, `Scoreboard`. |
| `src/api/eval.ts` | `getEvaluationTestCases(id)`, `getEvaluationHistory(id)`. `getEvaluation(id)` already exists — start calling it so `comparisonMode` is available. |
| `src/pages/ResultsPage.tsx` | Fetch config + test cases + history alongside results/summary. Render `VerdictHeader`. Retab to Scoreboard / Breakdown / Compare / Detail / Trend. Replace the `prompt()`/`alert()` baseline flow (`:52-58`) with a proper inline control in the header. |
| `src/components/results/VerdictHeader.tsx` *(new)* | Verdict sentence, caveat chip, regression delta, actions. Absorbs `RegressionBanner`. |
| `src/components/results/BreakdownView.tsx` *(new, replaces `MetricsView.tsx`)* | The six sections above, each guarded by the ≥2-series rule. |
| `src/components/results/CompareView.tsx` | Rebuilt: axis + hold selectors, delta ribbon, pairwise verdict, N-up toggle, deep-link support. |
| `src/components/results/DetailView.tsx` | Assertions + judge together, retries, error type, prev/next, "Compare this cell". |
| `src/components/results/TimelineView.tsx` → `TrendView.tsx` | Real history series, baseline reference line, honest empty state. |
| `src/components/results/*.css` | Matching styles using existing tokens (`--accent`, `--ok`, `--error`, `--heatmap-*`). No new theming system. |

## Coordination with the Scoreboard workstream

- `src/lib/labels.ts` is designed to be consumed by `Scoreboard.tsx` / `HeatmapMatrix.tsx` too — land it early and notify that workstream.
- `onCellClick(cell)` keeps its signature; this plan only changes where it routes (Compare instead of Detail-only).
- Two currently-visible bugs are Scoreboard-owned and **not** fixed here: clipped matrix column headers (`5 MAX::GRANITE4.1:8`), and every matrix cell rendering `…` while the leaderboard shows a completed run — a model appears in the matrix (`Y-TOWER::QWEN3.5`) with no cells behind it.

## Build order

1. `src/lib/labels.ts` + backend `resolveTestCases` / `GET /:id/testcases` → real labels everywhere (biggest legibility win, smallest diff).
2. `SummaryService` aggregation extensions + types.
3. `VerdictHeader` + ResultsPage retab.
4. `BreakdownView`.
5. `CompareView` rebuild.
6. `DetailView` upgrades.
7. `GET /:id/history` + `TrendView`.

Steps 1-3 are independently shippable and already fix the "nothing on screen says what was tested" problem.

## Verification

- `npm run test` — extend `src/test/pages/ResultsPage.test.tsx` plus new component tests: verdict sentence per `comparisonMode`; Breakdown renders stat tiles instead of charts with a single model; Compare cannot select A === B; Trend renders the empty state at <2 history points. Add `SummaryService` unit tests for `testCaseSummaries` / `assertionSummary` / `consistency`.
- `npm run lint`.
- `npm run dev`, then run a real eval sized to exercise comparison: **2 prompts × 2 models × 3 test cases × 2 runs**, with a judge model configured so `perspectiveScores` and `pairwiseRankings` are populated. Walk all five tabs.
- Regression path: save a baseline, edit Prompt B, re-run, confirm the verdict header shows the delta and Trend now plots two points.
- Degradation path: open one of the pre-existing evals under `data/evals/evaluations/` whose `summary.json` lacks the new fields, and confirm the page renders without errors.
