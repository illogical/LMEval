# A9/A10 — Two-Phase Model Selection & Task-Specific Reporting

## Context

Track A ("Measurement fidelity") is LMEval's critical path — it's what turns raw evaluation runs into
a trustworthy answer to the app's second founding question: "which local model should this task
actually use?" A6 (task-appropriate scoring), A7 (confidence intervals), and A8 (judge qualification)
have all landed and are unit-tested. What's still missing is the layer that actually *uses* those
measurements to make a recommendation (A9) and the layer that makes the already-computed data visible
in exports (A10). Right now the app can score a model correctly but has no selection algorithm and no
way to surface most of what it already computes.

A9 and A10 were scoped in detail back in
[`2026-09-03-professional-memory-evaluations.md`](2026-09-03-professional-memory-evaluations.md)
("Per-Task Model Selection" and "Results and Reporting" sections) before A6-A8 existed to build on.
This plan translates that existing design into concrete file-level work against the codebase as it
stands today, and settles the decisions the original doc left open.

**Scope boundary, deliberately held:** this plan is data/service/export layer only — no UI. A9's
`ModelRecommendation` artifact and A10's report sections will eventually surface on Track B's Results
page (Breakdown tab) and Step 5 SummaryPage, but Track B is a separate, independent track (confirmed
during brainstorming: neither blocks the other — B3's SummaryPage "ModelRecommendation" component is
actually LLM-generated free text, unrelated to A9's structured artifact despite the name collision —
they just share screen real estate later). This plan notes those hook points in passing and stops
there.

**Decisions made with the user during brainstorming:**
- **Latency budget** lives in a new shared, persisted config file (not re-entered per campaign) —
  because "whole-ingestion target" is a number LMEval cannot measure itself (TASK.md §6: LMEval doesn't
  see MemoryApi's pipeline), it's an externally-supplied constant set once and reused.
- **Per-model task metrics**: `EvaluationSummary` gains a first-class `perModelTaskMetrics` field
  (not just an internal per-call convenience), since per-model breakdowns are useful beyond model
  selection alone.
- **Phase 1 gate miss**: if no prompt clears the gate in the prompt-sweep phase, promote the
  best-metric prompt anyway and flag the resulting recommendation advisory, rather than hard-failing
  the task.

---

## 1 — New types in `src/types/eval.ts`

Add after `JudgeQualification` (~line 513), before `EvalPurposeTemplate`:

```ts
// --- A9: two-phase model selection ----------------------------------------

/** Declared per campaign — LMEval has no VRAM/quant introspection today. */
export interface ModelCandidateMeta {
  modelId: string;
  lmapiServer: string;
  parameterSize?: string;   // e.g. "8B" — free text, declared by the user
  quantization?: string;    // e.g. "Q4_K_M"
  contextLength?: number;
}

export interface TieGroup {
  rank: number;              // 1-based; all members statistically indistinguishable on the primary metric
  modelIds: string[];
}

export interface ModelSelectionOrdering {
  tieGroups: TieGroup[];
  discardedByGate: Array<{ modelId: string; reason: string }>;
  p95LatencyMs: Record<string, number>;
  stability: Record<string, { runToRunAgreement?: number; avgOutputTokens: number }>;
}

export interface ModelRecommendation {
  task: 'classification' | 'tagging' | 'summarization';
  recommendedModelId: string;
  runnerUpModelIds: string[];
  discardedByGate: Array<{ modelId: string; reason: string }>;
  primaryMetric: { name: string; value: number; ci95: [number, number] };
  p95LatencyMs: number;
  inference: { temperature: number; maxTokens: number };
  promptId: string;
  promptVersion: number;
  suiteId: string;
  suiteVersion: string;
  provenance: { taxonomySha256: string; datasetSha256: string; sourceRevision: string };
  evaluationId: string;
  judgeQualificationId?: string;
  singleModelAlternative?: { modelId: string; qualityDelta: Record<string, number> };
  generatedAt: string;
  ordering: ModelSelectionOrdering;
  confirmation: { ranModelId: string; passed: boolean; reason?: string };
  advisory?: boolean;   // true when promoted from a phase-1 gate miss
}

/** Persisted campaign record driving the 3-phase protocol; one per POST /model-selection run. */
export interface ModelSelectionCampaign {
  id: string;
  status: EvalStatus;
  tasks: Array<'classification' | 'tagging' | 'summarization'>;
  incumbentModelId: string;
  candidateSlate: ModelCandidateMeta[];
  promptIdsByTask: Record<string, string[]>;
  testSuiteIdByTask: Record<string, string>;
  totalVramBudgetGb?: number;
  phase1EvalIds: Record<string, string>;
  phase2EvalIds: Record<string, string>;
  phase3EvalIds: Record<string, string>;
  recommendations: Record<string, ModelRecommendation>;
  bestSingleModel?: { modelId: string; qualityDelta: Record<string, number> };
  crossServerFlag?: boolean;
  vramBudgetExceeded?: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
```

On `EvaluationSummary` (~line 311), add:

```ts
/** A9: per-model breakdown for comparisonMode: 'model' runs — same TaskMetrics shape, one per candidate. */
perModelTaskMetrics?: Record<string, TaskMetrics>;
```

`ModelCandidateMeta` fields must be hand-entered at campaign creation — no existing LMApi client call
introspects parameter size, quantization, or context length.

---

## 2 — Shared latency-budget config

New file, analogous to how judge qualifications are stored per-model:
- `data/evals/config/latency-budgets.json` — `Record<'classification'|'tagging'|'summarization', number>`
  (ms), representing each task's share of MemoryApi's whole-ingestion target.
- `server/services/FileService.ts`: add `LATENCY_BUDGETS_PATH = join(DATA_DIR, 'config',
  'latency-budgets.json')`, wired into the mutable exports and `configurePaths()` alongside the
  existing dir constants (same pattern as `JUDGE_QUALIFICATIONS_DIR`).
- New tiny service `server/services/LatencyBudgetService.ts`: `get(): Record<Task, number> | null`,
  `set(budgets)`. No route needed yet beyond what `ModelSelectionService` calls directly — expose a
  minimal `GET/PUT /api/eval/latency-budgets` only if the campaign-creation flow needs to read/edit it
  interactively (defer to Track B if so; keep the route trivial either way).
- `ModelSelectionService.runCampaign()` reads this once per campaign; if unset, the budget gate step is
  skipped for that run and every tie group is marked with a note that latency wasn't scored — never a
  silent 0/Infinity default.

---

## 3 — `StatisticsService.ts` additions

New pure function:

```ts
export interface TieGroupInput { id: string; ci: ConfidenceInterval }
export function tieGroupsByOverlappingCI(candidates: TieGroupInput[]): TieGroup[]
```

Algorithm: sort descending by `ci.point`; walk the list maintaining `groupMinUpper` (the minimum upper
bound seen in the currently-open group); a candidate joins the open group if
`candidate.ci.lower <= groupMinUpper` (chained/transitive overlap — A–B overlap plus B–C overlap forms
one group even without a direct A–C overlap), otherwise close the group and start a new one; assign
`rank` in closing order.

Also **export** the module-private `percentile()` helper so `ModelSelectionService` can reuse it for
p95 latency instead of duplicating percentile math.

---

## 4 — `SummaryService.ts` changes

- Export `computeClassificationMetrics`, `computeTaggingMetrics`, `computeSummarizationMetrics`
  (visibility-only change — no signature change).
- `computeSummary()`: when `config.comparisonMode === 'model'` and there's more than one `modelId`,
  additionally compute `perModelTaskMetrics` by calling the appropriate `compute*Metrics()` once per
  model against that model's filtered cell subset, and attach it to the returned `EvaluationSummary`.
  This is additive — the existing whole-run `taskMetrics` field is unchanged and still computed the
  same way it is today.

---

## 5 — New service: `server/services/ModelSelectionService.ts`

- `createCampaign(input): ModelSelectionCampaign` — validates incumbent is present and slate is
  non-empty; persists `campaign.json`; `status: 'pending'`.
- `runPhase1(campaign, task)` — builds an `EvaluationConfig` with `comparisonMode: 'prompt'`,
  `modelIds: [incumbentModelId]`, `benchmarkMode: 'calibration'` (reuses
  `ExecutionService.resolveTestCases()`'s existing `split:calibration` filter — no new filtering code
  needed). Runs via `ExecutionService.run()`. Promotes a prompt: gate-passing prompt with the best
  primary metric if any pass; otherwise the best-metric prompt regardless, with `advisory: true`
  recorded on the eventual `ModelRecommendation` (per the settled decision above).
- `runPhase2(campaign, task, promotedPromptId)` — `comparisonMode: 'model'`,
  `modelIds: candidateSlate.map(c => c.modelId)`, `promptIds: [promotedPromptId]`,
  `benchmarkMode: 'promotion-check'` (both splits, same existing branch in `resolveTestCases()`).
- `runPhase3(campaign, task, winnerModelId)` — re-runs phase 1's config with
  `modelIds: [winnerModelId]` only (calibration split only is already the "short confirmation" — no
  new concept needed).
- `selectModel(task, summary, campaign): ModelSelectionOrdering & { winner, runnerUp? }`, reading
  `summary.perModelTaskMetrics` from phase 2:
  1. **Gate** — per model, read its `TaskMetrics.gate` and invalid-output rate; discard failures into
     `discardedByGate`.
  2. **Quality** — build `TieGroupInput[]` from survivors' CIs (`accuracyCI`/`jaccardCI`/`weightedCI`
     depending on task), call `tieGroupsByOverlappingCI`.
  3. **Budget** — read `LatencyBudgetService.get()`; if present, within each tie group compute p95
     latency via `computeP95LatencyMs` and re-rank intra-group by p95 ascending against the task's
     budget share (doesn't change group membership, only order within it). If absent, skip with a
     recorded note.
  4. **Stability** — remaining ties broken by run-to-run agreement, then avg output tokens ascending.
- `computeP95LatencyMs(cells, modelId)` — filters completed cells for the model, sorts `durationMs`,
  applies the exported `percentile()` at `0.95`.
- `runCampaign(campaignId)` — drives phase1 → promote → phase2 → `selectModel` → phase3 confirm →
  assemble `ModelRecommendation` → persist, per task; then computes `bestSingleModel` /
  `crossServerFlag` / `vramBudgetExceeded` across all tasks' recommendations.
- `getCampaign(id)`, `listCampaigns()`.

Candidate-slate composition (incumbent + smaller + larger + resident instruction-tuned) is treated as
advisory guidance, not a hard validation — `createCampaign` does not reject a slate that skips one of
these categories.

---

## 6 — Persistence and route

- `FileService.ts`: add `MODEL_SELECTION_DIR = join(DATA_DIR, 'model-selection')` (one
  `{campaignId}/campaign.json` per campaign) and `RECOMMENDATIONS_DIR = join(DATA_DIR,
  'recommendations')` (one `{campaignId}-{task}.json` per recommendation, durable independent of the
  campaign record), wired into the mutable exports and `configurePaths()`.
- New `server/routes/modelSelection.ts`, mounted at `/api/eval/model-selection` in `server/index.ts`
  next to the existing `judgesRouter` mount:
  - `POST /` — validates and creates the campaign, fires `ModelSelectionService.runCampaign(id).catch(...)`
    fire-and-forget (same shape as the existing `evaluationsRouter.post('/')`), returns `202`.
  - `GET /:id` — campaign status, phase eval ids, recommendations produced so far.
  - `GET /:id/recommendations` — reads `RECOMMENDATIONS_DIR` directly.
  - `POST /:id/cancel` — cancels any in-flight phase eval via `ExecutionService`'s existing cancel path.

---

## 7 — `ReportService.ts` extensions

All of this data already exists on `EvaluationSummary`/`ModelRecommendation` after sections 1-6 land —
this section is formatting only, no new computation.

- **TaskMetrics detail** (after the existing Regression Analysis block): confusion matrix + per-class
  table (classification), micro P/R/F1 + per-tag table (tagging), rubric dimensions +
  `criticalUnsupportedClaimRate` + self-judge/qualified flags (summarization), plus a shared `gate`
  rendering (verdict / caseCount / neededCases / failures).
- **Per-model breakdown table** when `perModelTaskMetrics` is present — one row per candidate model
  reusing the same per-task-type columns as above.
- **Slice tables**: group the run's test cases (already written to `testcases.json` by
  `ExecutionService.run()`) by their existing `caseTags` families (`split:`, `shape:*`, `category:*`)
  and join against `EvaluationSummary.testCaseSummaries`'s per-case pass rate — no new data collection,
  just grouping and rendering.
- **Provenance/judge-qualification block**: extend the existing inference/transport header with
  `summary.benchmarkProvenance` and, for summarization runs, `JudgeQualificationService.get(config.judgeModelId)`.
- **Model-selection section** (new, gated on `comparisonMode === 'model'`): looks up the
  `ModelRecommendation` for this evaluation from `RECOMMENDATIONS_DIR` by `evaluationId` and renders
  gate pass/fail per model, CI + tie groups, p95 latency, truncation rate (already computed), run-to-run
  agreement, and the resulting recommendation (including the advisory flag when phase 1 didn't clear
  the gate).
- Baseline-comparison routes (`/regression`, `/baseline`): extend their response payload with a
  provenance/inference/transport/judge-qualification diff — both sides already carry these fields, so
  this is pass-through, not new computation.

**Track B forward note (not designed here):** a future SummaryPage would consume
`GET /api/eval/model-selection/:id/recommendations` plus these report sections to render A9's
structured recommendation alongside B3's free-text LLM suggestions; a future Results/Breakdown tab
panel would render the confusion-matrix/per-tag/slice data this section formats for Markdown/HTML
today. Neither is built in this plan.

---

## 8 — Sequencing

1. Types in `src/types/eval.ts` (§1) — no dependents, do first.
2. Latency-budget config + `LatencyBudgetService` (§2) — independent, do early.
3. `StatisticsService.tieGroupsByOverlappingCI` + exported `percentile` (§3) — pure, unit-testable
   standalone.
4. `SummaryService`: export the three `compute*Metrics` functions and add `perModelTaskMetrics` (§4).
5. `FileService`: new dir/path constants + `configurePaths()` wiring (§6, the storage half).
6. `ModelSelectionService.ts` (§5, depends on 1–5): build `computeP95LatencyMs`/`selectModel` first
   against synthetic fixtures, then `runPhase1/2/3`/`runCampaign`, which depend on live
   `ExecutionService.run()`.
7. `server/routes/modelSelection.ts` + mount (§6, the route half — depends on 6).
8. `ReportService.ts` (§7): the taskMetrics/per-model/provenance/slice-table sections depend only on
   already-existing `EvaluationSummary` fields plus step 4, and can be built independently of A9's
   service work; the model-selection section depends on steps 6-7. Build the former first, the latter
   last.

---

## 9 — Test coverage

- `server/services/StatisticsService.test.ts` (extend): chained-overlap tie grouping, disjoint CIs,
  single/empty input.
- `server/services/LatencyBudgetService.test.ts` (new): get/set round trip, missing-file returns null.
- `server/services/SummaryService.test.ts` (extend): `perModelTaskMetrics` populated correctly for a
  `comparisonMode: 'model'` run with >1 model; absent for single-model/prompt-comparison runs.
- `server/services/ModelSelectionService.test.ts` (new): gate exclusion; tie grouping from synthetic
  per-model metrics; budget tie-break via `computeP95LatencyMs` against a hand-computed percentile,
  and correct skip-with-note when no latency budget is configured; stability tie-break (agreement then
  tokens); full `ModelRecommendation` construction (`ordering`, `confirmation`, `provenance`
  populated); phase-1 gate-miss → `advisory: true` promotion; phase-3 confirmation failure → runner-up
  fallback with recorded reason; `bestSingleModel`/`crossServerFlag`/`vramBudgetExceeded` from a
  fixture slate.
- `server/services/ReportService.test.ts` (extend/new): taskMetrics rendering per task type; per-model
  breakdown table; slice-table grouping from fixture `testcases.json` + `testCaseSummaries`;
  provenance/judge block presence/absence; model-selection section rendering and its omission when
  `comparisonMode !== 'model'` or no recommendation exists.
- `server/routes/modelSelection.test.ts` (new): POST validation (missing incumbent, empty slate), 404
  on unknown campaign, cancel wiring.

---

## 10 — Verification (runtime, owed separately — do not claim from unit tests alone)

Per this repo's standing convention (TASK.md Track E), unit tests verify logic; the following require a
real LMApi + Ollama round trip and should be tracked as a Track E entry once this lands, not claimed as
verified by the tests above:

- Run one full 3-phase campaign per task over a real declared candidate slate; confirm the
  recommendation, tie groups, discarded-by-gate list, and single-model alternative are produced and
  exported to `data/evals/recommendations/`.
- Confirm `perModelTaskMetrics` reflects real per-model confusion matrices/gates, not just structurally
  valid JSON.
- Confirm the Markdown/HTML report's new sections render correctly against a real evaluation with a
  configured latency budget and a qualified judge.
