# B1–B3 Track B Implementation Plan

## Context

Track B (`B1`–`B6`, TASK.md §4) is the remaining wizard-completion work, sitting on top of
already-complete backends for B1–B3. This document turns TASK.md's checklist bullets for B1, B2, and
B3 into an implementation-ready plan — which files to touch, which existing components to reuse, and
two places where TASK.md's own framing turned out to be slightly wrong once the code was actually read.

B4 (git integration frontend) is deliberately **not** planned here. The user wants to reconsider
whether prompt-version history should keep living in a git repo at all, versus a different local
"workspace" model for versions/diffs/run logs/eval output, and will scope that properly in its own
session. A forward-note capturing the current architecture is included below so that reconsideration
starts from facts, not a re-exploration.

This plan also carries forward
[`2026-09-05-a9-a10-ux-and-track-b-lessons-plan.md`](2026-09-05-a9-a10-ux-and-track-b-lessons-plan.md)'s
recommendation that A9/A10's campaign UI ship before Track B polish, since that doc argues Track B is
incremental UX on an already-usable wizard while A9/A10 currently have no UI at all. That sequencing
call is left open here — this plan makes B1–B3 ready to execute whenever they're picked up, in whatever
order the campaign-UI-vs-Track-B priority call lands.

---

## B1 — Prepare page (drag-to-reorder, import from suite)

**Files:** `src/components/config/TestCaseEditor.tsx` (row state: `addRow()`/`removeRow()`/`updateRow()`
at lines 93–109, inline table at 400–459), `src/utils/testCaseIO.ts` (`parseJSON`/`serializeJSON`,
93–241), `src/pages/ConfigPage.tsx` (wires `onInlineTestCasesChange`).

**Import from test suite** — reuse, don't reinvent: `TestCaseEditor` already fetches suites via
`listTestSuites()` (line 62) and already has a "Use benchmark suite" button (line 272) that *links* a
suite by id. B1 adds a second, adjacent button — "Import as editable rows" — that instead *copies*:
take the selected suite's cases, run them through the same `serializeJSON()` → `processText()` →
`confirmAppend()`/`confirmReplace()` pipeline already used for file-drop import (lines 198–212), so
imported rows land in `inlineTestCases` as independent, editable copies. No new parsing code — this is
entirely a second call path through existing I/O functions.

**Drag-to-reorder** — no dnd library exists in the codebase (`package.json` confirmed clean of
`dnd`/`sortable`/`draggable`; the only precedent is `TestCaseEditor`'s file-drop handlers). Given this
is a single flat list with no nesting, cross-list drag, or virtualization need, use native HTML5
`draggable`/`onDragStart`/`onDragOver`/`onDrop` on each row rather than pulling in `@dnd-kit` or
`react-beautiful-dnd` — matches this repo's stated bias against a new dependency when a few dozen lines
of native browser API do the job, and reuses the drag-event pattern the file-drop zone already
established. Reorder logic: on drop, splice the dragged row's id to the target index and call
`onInlineTestCasesChange()` with the reordered array — the same setter every other row mutation already
uses, so no new state-plumbing.

## B2 — Results page (failure drawer, run selector, skeletons)

**Corrections to TASK.md's framing, confirmed by reading the code directly:**

1. **`rawJudgeResponse` already exists.** `JudgeResult.rawResponse?: string`
   (`src/types/eval.ts:193`) is already populated at all three success paths in
   `JudgeService.parseRubricResponse()`'s fallback chain (`server/services/JudgeService.ts:90,99,113`).
   B2 needs to *display* it in the drawer; no type or service change required.
2. **The retry endpoint exists but doesn't do what its own parameter name promises.**
   `POST /api/eval/evaluations/:id/retry` (`server/routes/evaluations.ts:247–286`) accepts
   `{ failedCellsOnly?: boolean }` but never reads that field again after destructuring it (line 250) —
   it clones the *entire* config into a brand-new evaluation and calls `ExecutionService.run(newEvalId)`
   on the whole thing (line 281), which re-runs every cell. There is no cell-scoped or
   failed-cells-only code path anywhere in `ExecutionService`. **This is real backend work B2 cannot
   skip**: either (a) extend `ExecutionService.run()` to accept an optional cell-id filter and have the
   route pass through `failedCellsOnly` (and, for the drawer's single-cell "↻ Retry this cell" button,
   an explicit `cellIds: string[]`), or (b) keep `/retry` as whole-eval and add a new, narrower endpoint
   for single-cell retry. **Recommend (a)** — it's the smaller change and makes the existing
   `failedCellsOnly` flag finally do something, rather than adding a second endpoint with overlapping
   purpose.
3. **`Cell.retryAttempts?: { attemptNumber, error, timestamp }[]`** already exists
   (`src/types/eval.ts:242–246`), so "retry history" in the drawer is a read of existing data, not a
   new field — but nothing in `ExecutionService` currently *appends* to it. Confirm during
   implementation whether a retry today overwrites rather than appends; if so, it's a one-line fix
   alongside (2) above.

**Failure drawer UI** — reuse `src/components/dashboard/LiveFeed.tsx`'s modal-overlay pattern
(lines 50–65: dark overlay, centered panel, close button) as the drawer shell, and
`BreakdownView.tsx`'s collapse-toggle pattern (lines 215–220, `ChevronDown`/`ChevronRight` +
`bv-collapse-toggle`) for the deterministic-check-breakdown section inside it, rather than building a
new expand/collapse primitive. Wire it from `HeatmapMatrix.tsx`'s existing `onCellClick` (line 57),
which currently only navigates to Compare — add a branch that opens the drawer for a failed cell
instead of/alongside that navigation.

**Run selector + skeleton loaders** — smaller, additive UI. Run selector is a tab bar over
`SessionService`'s existing per-session `EvalRun[]` list. Skeleton loaders replace the heatmap
cell/leaderboard content while `ResultsPage`'s existing fetch is in flight — check its current
loading-state handling before adding a new one; it likely just needs a skeleton component swapped in
where a bare loading state exists today.

## B3 — Step 5: Summary & AI suggestions

**Files:** `src/pages/SummaryPage.tsx` (currently a pure stub, lines 5–34 — icon + "Coming Soon" text,
no substructure to preserve), `src/types/eval.ts` `ModelRecommendation` (542–562),
`server/services/ReportService.ts` (`renderTaskMetrics`, 31–73).

- **`SummaryOverview`** — headline gate-first framing, matching `VerdictHeader`'s established pattern
  (don't invent new verdict language for the same fact).
- **`ModelRecommendation` / `PerModelAnalysis`** — `ReportService.renderTaskMetrics()`'s per-model
  Markdown rendering is the shape reference: mirror its structure (per-model confusion/metric panels)
  as React components rather than guessing a new layout. `BreakdownView.tsx`'s `recharts` `ScatterChart`
  (lines 57–99, generic `{name, latency, score, success}` data shape) is reusable as-is for a
  quality-vs-latency view in `PerModelAnalysis` — no LMEval-specific coupling blocks reuse.
- **`ImprovementSuggestions`** — new `POST /api/eval/evaluations/:id/summary-analysis` per TASK.md's
  spec (accepts `{ refinementModel? }`, builds analysis prompt, dispatches via LMApi, parses typed
  sections, caches to `data/evals/evaluations/{id}/analysis.json`). Follow `JudgeService`'s existing
  4-step parse-fallback-chain convention (already used for rubric parsing) for parsing the model's
  response into sections, rather than a new ad hoc parser.
- **Apply Suggestion / Apply & Re-run** — "Apply" creates a new prompt version via the existing
  `PromptService.addVersion()` + a new session version via `SessionService.createVersion()` (both
  already used elsewhere in the wizard for prompt edits); "Apply & Re-run" additionally POSTs to the
  existing evaluation-run-creation path used by the Prepare page's own Run button.
- **Graceful degradation** — `GET /api/eval/health` should report whether `REFINEMENT_MODEL` is
  configured (this is also Track C1's own ask — implement it once, both tracks read it); absent it,
  `SummaryPage` renders the raw summary sections without `ImprovementSuggestions`, not an error state.
- Wire the existing "View Summary & Suggestions →" button already present on `ResultsPage.tsx` to
  navigate here.

## B4 — forward note only (not designed in this plan)

Held for its own planning session, since the user wants to reconsider git as the prompt-version
storage mechanism. Captured for that future session:

- **Current architecture** (confirmed by reading the code): `GitService`
  (`server/services/GitService.ts`) wraps `init`/`commit`/`log`/`revert`/`status` via child-process git
  calls, operating on `DATA_ROOT` — the same mutable directory that already holds
  `evals/prompts/{slug}/v{n}.md`, `evals/evaluations/{evalId}/*.json` (config/cells/results/testcases),
  and `sessions/{slug}/v{n}.json` + `runs/{runId}.json`. `REPO_ROOT` (shipped seed content — built-in
  templates, calibration fixtures) is already a *separate*, read-only root from `DATA_ROOT`
  (`FileService.ts:79–138`, `configurePaths()`). So the "local workspace" concept under discussion —
  instance data (prompt versions, run logs, eval output, configs) held apart from anything resembling
  LMEval's own application repo — **already exists as `DATA_ROOT`**; what's actually in question is
  only whether `DATA_ROOT`'s *version history* mechanism should be git (`git add -A` whole-directory
  commits gated by a `feat|fix|chore(prompt):` message regex, `GitService.ts`) or something else with a
  friendlier diff view than shelling out to git log/diff.
- **Open question for that session**: whether to replace `GitService` with an app-native version store
  (e.g., content-addressed snapshots of `prompts/`/`sessions/` with a purpose-built diff renderer in the
  UI) or keep git as the mechanism but stop exposing it as "git" in the UI (i.e., hide it entirely
  behind Commit/Revert/Diff buttons, arguably B4's original intent anyway). `EvalRun.commitHash`/
  `committedAt` (`src/types/session.ts:52–53`) already assume *some* content-hash concept, which would
  carry over to either design.
- **Docs to revisit once B4 is redesigned**: TASK.md's Phase 2.5 status line and its B4 bullet;
  `docs/SPECIFICATION.md` wherever it documents git-backed versioning (not yet checked — read it first
  in the dedicated B4 session); this section should be superseded by that session's own plan doc, not
  amended in place.

---

## Sequencing note (not decided here)

[`2026-09-05-a9-a10-ux-and-track-b-lessons-plan.md`](2026-09-05-a9-a10-ux-and-track-b-lessons-plan.md)
recommends building campaign UI, the judge-qualification badge, and `/settings` (all A9/A10-dependent)
*before* B1–B3, since those are the difference between "built" and "usable at all" while B1–B3 are
polish on an already-usable wizard. This plan doesn't override that recommendation — it makes B1–B3
ready to execute whenever picked up, and leaves the actual ordering as a separate prioritization call.

## Verification

- **B1**: manual browser check — drag-reorder a 3+ row inline table, confirm order persists through
  `onInlineTestCasesChange`; import a suite as rows, confirm rows are independently editable and suite
  linkage (`testSuiteId`) is *not* silently set.
- **B2**: after extending `ExecutionService.run()` for cell-scoped retry, add/extend a vitest case
  confirming only the targeted cell(s) re-execute and `retryAttempts` appends rather than overwrites;
  browser check the drawer against a real failed cell (raw response, deterministic breakdown, retry
  button round-trip).
- **B3**: vitest for the new `/summary-analysis` route's parse-fallback chain (mirroring
  `JudgeService.test.ts`'s existing coverage style); browser check Apply → new prompt version appears;
  Apply & Re-run → new run starts; health-flag-off path renders without the suggestions panel.
- **All**: per this repo's Track E convention, state explicitly which of the above was live-verified
  vs. unit-tested-only rather than implying more confidence than earned.
