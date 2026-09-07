# LMEval — Specification

> **Status**: Living document. This is the authoritative reference for what LMEval is and how it works — current state plus the target state of in-flight design decisions. Where this document and an older planning doc under `docs/prompt-eval-system/` or `docs/features/eval-wizard/` disagree, **this document wins**; the older docs remain as historical implementation detail and phase-tracking, not as competing specs. See "Relationship to prior docs" below.

---

## 1. Mission & Scope

LMEval is a standalone web application for systematic prompt engineering and model evaluation, built on top of [LMApi](https://github.com/illogical/LMApi) (a local multi-model routing layer, itself typically hosted under [HomeBase](https://github.com/illogical/HomeBase)). It replaces prompt-engineering-by-intuition with reproducible, local, deterministic-first measurement: run prompt variants and models against a shared test suite, score the results, and see which combination actually performs best — ranked by accuracy, speed, and consistency.

Core principles, unchanged since the project's inception:
- **Local first** — all model calls route through the user's own LMApi instance; no data leaves the machine
- **Deterministic checks before LLM-judge scores** — cheap, reliable checks run first; subjective rubric scoring is a second layer, not the only layer
- **Reproducible** — evaluation configs and results are plain JSON/Markdown on disk, git-trackable
- **Model-agnostic** — works with any model LMApi can reach (Ollama, OpenRouter, any OpenAI-compatible endpoint)

## 2. Architecture

```
┌───────────────────────────────┐     HTTP/WS      ┌─────────────────────────┐
│  LMEval                       │ ◄──────────────── │  LMApi (external)       │
│  Vite + React frontend        │ ──────────────►   │  Ollama server pool     │
│  Express backend (port 3200)  │                   │  OpenRouter fallback    │
│  File-based JSON storage      │                   │  OpenAI-compatible API  │
└───────────────┬───────────────┘                   └─────────────────────────┘
                │ Node API (in-process)
                ▼
        ┌───────────────┐
        │  Promptfoo     │   evaluate(testSuite, { progressCallback })
        │  (npm package) │   — the execution engine, see §4
        └───────────────┘
```

- **Frontend**: Vite + React 19 + TypeScript, `react-router-dom` v7, CSS custom properties (no Tailwind), Recharts for charts, `highlight.js` for response syntax highlighting.
- **Backend**: Express 5, file-based JSON/Markdown storage under `data/`, WebSocket server (`ws` package) for real-time eval progress, optional git-tracked `data/` directory for prompt/eval version history. A SQLite read-index (`data/evals/index.db`, via Node's built-in `node:sqlite` — no new dependency) is additive to this file storage — never a replacement for it — indexing one row per (evaluation × model × activity) plus a long-format table for activity-specific diagnostic metrics (`server/services/InsightsIndexService.ts`), populated by a write-through step at the end of `ExecutionService.aggregate` and backfillable from every already-completed evaluation without re-running it (`npm run insights:backfill`). See `docs/plans/2026-09-06-evaluation-dashboard-and-sqlite-schema.md`.
- **LMApi**: a separate, already-running service. LMEval never talks to Ollama or OpenRouter directly — always through LMApi's chat completions endpoints. LMEval can run standalone (`npm run dev`, backend on port 3200) or hosted inside HomeBase's single Node process under `/lmeval/` (see `docs/plans/2026-08-23-homebase-integration.md`).
- **Promptfoo**: the evaluation execution engine (§4). A pure npm dependency — Node ≥22, no Python, no separate service to run, confirmed against a real dependency-tree audit (see `docs/plans/2026-09-03-promptfoo-adoption-and-purpose-templates.md`).

## 3. Core Data Model

The canonical type definitions live in `src/types/eval.ts` (re-exported for backend use in `server/types/eval.ts`). This section documents the model conceptually, including fields that are part of the target state from the Promptfoo migration (§4) and not yet in the codebase — those are marked **(planned)**.

### Prompts
- `PromptManifest` — versioned system prompt: `id`, `slug`, `name`, `versions: PromptVersionMeta[]`, optional `tools: ToolDefinition[]` for function-calling prompts. Each version's content lives in its own file; `PromptService.diff()` produces a unified diff between any two versions.

### Test data
- `TestCase` — one row of test input: `userMessage`, optional `expectedKeywords`/`forbiddenKeywords`, `expectedToolCalls`, `referenceAnswer`, `jsonSchema`, `expectedOutput`, `tags`, `protectedTokens?`, `forbiddenClaims?`. Full grounding-field support (added 2026-09-05, TASK.md Track A4) also carries `expectedLabels?`, `caseTags?`, `requiredFacts?`; `tags` is a deprecated import alias for `expectedLabels` (order-insensitive comparison, import warning when they differ, both handled in `src/utils/testCaseIO.ts`), and JSON/CSV import/export emit the new fields (CSV semicolon-delimited) rather than `tags`.
- `TestSuite` — a named, saved collection of `TestCase[]`, reusable across evaluations. Gains `builtIn`, `purposeCategory?`, `version`, and `provenance?` (2026-09-05, TASK.md Track A5): three repository-owned, deterministically-generated built-in suites (`memory-classification-v1` 64 cases, `memory-tagging-v1` 72, `memory-summarization-v1` 36 — see `docs/plans/2026-09-04-a4-a5-ground-truth-built-in-suites.md`) ship at `data/evals/test-suites/built-in/`, merged by `TestSuiteService` alongside data-root-owned custom suites and legacy compatibility files; built-ins are immutable through the API (`403 BUILT_IN_SUITE_IMMUTABLE`) and carry `reviewStatus: 'pending-human-review' | 'approved'` in their provenance.
- An evaluation can instead use `inlineTestCases` (ad hoc, not saved as a suite) or a single `userMessage` (quick mode).

### Evaluation configuration
- `EvaluationConfig` — the full setup for one run: ordered `promptIds[]` plus pinned `promptVersions[]`, `modelIds[]`, exactly one of `testSuiteId`/`inlineTestCases`/`userMessage`, `templateId`, judge settings (`judgeModelId`, `enablePairwise`, `runsPerCell`), optional per-run inference, and optional `sessionId`/`sessionVersion` linking. New records pin prompt versions at creation; historical records without pins remain readable. Regression comparison uses saved baseline slugs, not an evaluation `baselineId` field.
- `comparisonMode: 'model' | 'prompt' | 'matrix'` records the experimental axis. The matrix-building formula (`promptIds.length × modelIds.length × testCaseCount × runsPerCell`) remains unchanged.
- Evaluations may be persisted as server-backed `draft` records. Draft creation never starts model calls; only drafts can be patched; starting performs the one-way `draft` → `pending` transition and started evidence is immutable.
- `EvaluationValidationService` is the shared API/browser experiment-shape boundary. It returns stable error and warning codes for references, comparison cardinality, test-source exclusivity, inference/repetition bounds, benchmark eligibility, judge caveats, and unsupported settings.

### Templates
- `EvalTemplate` — judge rubric: `perspectives: JudgePerspective[]` (each with `weight`, `criteria`, `scoringGuide`), plus a `deterministicChecks` block (being superseded — see §4). Four built-in templates ship today: General Quality, Tool Calling, Code Generation, Instruction Following.
- `EvalPurposeTemplate` — a richer entity layered above `EvalTemplate`, bundling a starter prompt, an assertion strategy, and starter test cases. See §5.2 for the full shape and the 3 built-in purpose templates (Classification, Tagging, Summarization). `AssertionStrategy` is a discriminated union keyed by `type` (2026-09-04, replacing an untyped `config: Record<string, unknown>`): `exact-label` (`{ labels: string[] }`), `label-overlap` (`{ vocabulary: string[]; minimumCaseF1: number }`), `grounded-summary` (`{ templateId: string; dimensions?: string[]; compressionRange?: [number, number] }`), `custom` (`{ description: string }` — validated but not a plugin point; see §4's Key Decisions on deferring a generalized custom task-type system). `server/services/AssertionStrategyService.ts` validates and normalizes legacy config keys bidirectionally on read (`categories`→`labels`, `tagVocabulary`→`vocabulary`, `threshold`→`minimumCaseF1`, `llm-rubric`+`dimensions`→`grounded-summary`+`templateId`); writes always emit the normalized shape, and an invalid `custom` config is a `400` at the purpose-template routes.
- `EvalPreset` — a *different* concept from both of the above: a reusable evaluation *configuration* (model selection + template + test suite + judge settings), not tied to any specific prompt. Distinct from `EvalPurposeTemplate`, which also seeds prompt content and starter test cases and is meant as the entry point to a brand-new evaluation rather than a config to reapply to an existing one.

### Results
- `EvalMatrixCell` — one (prompt × model × test case × run) execution: request/response, token counts, latency, `serverName`, retry attempts, and a metrics block. `assertionResults: Array<{ type: string; pass: boolean; score?: number; reason?: string; metric?: string }>` mirrors Promptfoo's own `GradingResult` shape directly and is implemented (the legacy fixed-shape `deterministicMetrics` field still exists alongside it for pre-migration data, unused by new runs) — see §4.
- `EvaluationSummary` — aggregated `modelSummaries`/`promptSummaries` (composite score, latency, success rate, rank), optional `pairwiseRankings`, optional `regression` (delta vs. a saved baseline, classified improved/regressed/unchanged; each `MetricRegression` also carries `onCaseMovementPct?` — one case's worth of movement in points, added 2026-09-04 for A7, so a regression-slice threshold reads in cases rather than a bare percentage). `taskMetrics?: TaskMetrics` (added 2026-09-04, R4-R7; extended 2026-09-04 for A7/A8) is a discriminated union keyed by `taskType`: `ClassificationTaskMetrics` (accuracy, macro-F1, per-class precision/recall/F1, invalid-label rate, format-compliance rate, confusion matrix, run-to-run agreement, `accuracyCI?`, `mcNemar?` vs. a supplied baseline), `TaggingTaskMetrics` (micro/macro P-R-F1, Jaccard mean, exact-set match rate, unknown/duplicate-tag rates, format compliance, `jaccardCI?`, plus `gateMetric` identifying whether that compatibility interval represents Jaccard or recall), `SummarizationTaskMetrics` (deterministic-check rates, median-of-3-judge-pass rubric scores per R6 weights, critical-unsupported-claim rate, self-judge-guard flag, `weightedCI?`, `judgeQualified?`). Each variant carries its own `gate: GateResult` — `{ pass: boolean; failures: string[]; verdict: 'pass' | 'fail' | 'inconclusive' | 'advisory'; caseCount: number; neededCases? }` (A7/A8, 2026-09-04): `pass`/`fail` mean the confidence interval clears or misses the threshold outright; `inconclusive` means the CI straddles it — never a false pass — with `neededCases` estimating how many more cases would resolve it; `advisory` (summarization only) means the judge model is self-judging or is not qualified against a calibration set (A8), so the result is informative but not promotable regardless of score. Classification and tagging never populate a rubric-style composite — only summarization's `medianRubric.weighted` is a composite, by design (R7). Computed in `SummaryService.computeSummary()` only when the run used a built-in purpose template (`purposeCategory` + a matching `assertionStrategy` are both required); absent otherwise.
- `JudgeQualification` (A8, added 2026-09-04) — `{ judgeModelId, calibrationSetHash, qualifiedAt, spearman, faithfulnessWithin1Pct, meanInflation, selfConsistencyMAD, qualified }`. Computed by `server/services/JudgeQualificationService.ts` via `POST /api/eval/judges/:modelId/qualify` against a calibration set of human-scored summaries (3 self-consistency passes per case, t=0). Thresholds: Spearman ≥ 0.6 vs. human overall, Faithfulness within 1 point on ≥80% of cases, mean inflation within 0.5, per-dimension self-consistency MAD ≤ 0.5. Persisted to `data/evals/judge-qualifications/{judgeModelId}.json`; read back by `ExecutionService.run()` and threaded into `SummarizationTaskMetrics.judgeQualified`. The calibration set itself (`data/evals/calibration/summarization-v0.json`, 22 hand-scored cases) is a **temporary in-repo fixture**, LMEval-authored and distinct from the reviewed `memory-summarization-v1` benchmark suite (Track A5).
- `JudgeQualificationRun` makes qualification an observable file-backed job (`pending`, `running`,
  `completed`, `failed`, `cancelled`, or `interrupted`) with parsed-call progress. The complete calibration
  content is SHA-256 hashed for freshness. Browser clients poll the consolidated status and can cancel or
  retry; restart recovery marks unfinished work interrupted and never replays costly calls.
- `ModelSelectionCampaign` supports a server-backed `draft` before its immutable run. It stores exact
  prompt/version pins, warning acknowledgements, active phase work, and every confirmation attempt.
  Validation composes the ordinary evaluation validator, model discovery, suite provenance, judge state,
  and per-phase call estimates. Campaign tasks and phases execute sequentially. A phase with any execution
  failures cannot produce a winner; its partial evidence remains linked from campaign feedback.

## 4. Execution Engine: Promptfoo

LMEval's evaluation runs are executed by [Promptfoo](https://www.promptfoo.dev/), invoked as an in-process Node dependency (not shelled out to its CLI). This was validated by a standalone POC (`docs/plans/2026-09-02-promptfoo-poc-evaluation.md`, full results in that POC's own `README.md` at `C:\LocalDev\Projects\promptfoo-poc\`) before adoption, which confirmed:

- Swapping the model backend (Ollama → LMApi) is a pure `providers:` config change — no other file needs to change, and LMApi was materially faster for the same request volume.
- Promptfoo's Node API `evaluate(testSuite, { progressCallback })` fires once per (prompt × provider × test case) cell during a live run, which is what LMEval's WebSocket event stream is built on. Two integration details to get right: `evalStep.provider.id` is a *method*, not a resolved string, and the `metrics` argument passed to `progressCallback` is the cumulative run total, not the current cell's own result — per-cell pass/fail only appears in the final resolved `results` array.
- Multi-label assertions (e.g. tagging: does the output's tag set sufficiently overlap an expected set?) have no built-in Promptfoo assertion type, but a small custom `javascript` assertion handles it cleanly and composes with everything else Promptfoo provides (results table, `promptfoo view`, export) for free.

`server/services/ExecutionService.ts` owns the translation: an `EvaluationConfig` plus resolved prompt content and test cases becomes a Promptfoo `TestSuite` (prompts array, providers array built from `modelIds` via LMApi's OpenAI-compatible endpoint at `apiBaseUrl`, a `tests` array with per-case `assert` blocks). `evaluate()`'s results are mapped back into the existing `EvalMatrixCell[]`/`EvaluationSummary` shapes so the WebSocket event contract, `SummaryService`, `ReportService`, and the Results UI (§6) are unaffected by the engine underneath them.

This replaces two former internal engines:
- **`MetricsService`'s hand-rolled checks** (keyword matching, JSON Schema validation via `ajv`, tool-call matching) → Promptfoo assertion types (`icontains`, `equals`, `contains-json`, `javascript`, `llm-rubric`, etc.).
- **`JudgeService`'s custom rubric/pairwise prompt construction** → Promptfoo's native `llm-rubric` assertion type, with the judge model configured as a grader-provider override.

Full migration task breakdown (Phase 10 in the phase-numbering below): `docs/plans/2026-09-03-promptfoo-adoption-and-purpose-templates.md`.

## 5. Wizard UX

Five-step guided flow with free navigation (click any visited step to jump back), per the "Guided Flow with Free Navigation" architecture decision in `docs/features/eval-wizard/EVAL_WIZARD.md`. Routes:

```
/                    → Session Hub (recent sessions, "New Evaluation" / "Quick Compare")
/eval/gallery         → Template Gallery (NEW, see §5.2) — the "New Evaluation" landing screen
/eval/prompts         → Step 1: Prompts & Models
/eval/config           → Step 2: Prepare
/eval/run/:id           → Step 3: Run Dashboard
/eval/results/:id        → Step 4: Results & Analysis
/eval/summary/:id         → Step 5: Summary (not yet implemented — placeholder)
```

Outside the wizard flow, `/insights` is the cross-run Run History & Insights dashboard (§5.5 below) and `/compare` is the standalone Quick Compare A/B page — both are peers of the Session Hub, not wizard steps.

Model selection is also a peer workflow: `/campaigns` lists campaigns, `/campaigns/new` builds or clones
a draft, and `/campaigns/:id` provides review, explicit warning acknowledgement and start, active phase
progress/cancellation, retained Run/Results links, and gate-first recommendations with tie groups and
quality-versus-p95-latency evidence. The judge selector on Prepare and the campaign builder share the
persisted qualification status/control component.

### 5.1 Entry flow & Evaluation Mode

"New Evaluation" from the Session Hub lands on the **Template Gallery** (§5.2), not directly on Step 1. From there, either a purpose template is selected (pre-filling the wizard) or "Start Blank" proceeds exactly like the flow described below with nothing pre-filled.

Step 1 opens with an **Evaluation Mode** strip above the prompt editors — this is a new axis, orthogonal to "what kind of task is this" (that's the purpose template). It answers: *is the user varying the model, or varying the prompt?*

| Mode | Prompt slots shown | Model selector | Answers |
|---|---|---|---|
| **Model Comparison** | 1 | Requires ≥2 models before advancing | "Which model is best for this fixed prompt?" |
| **Prompt Comparison (Regression)** | 2 (A/B) | Allows 1+, UI nudges toward 2+ | "Did my prompt edit help — on this model, or across every model I have?" |
| **Full Matrix (Advanced)** | N | Unrestricted | Both axes vary freely — a power-user mode; lower build priority than the two above |

This choice determines the shape of the rest of Step 1 (whether Prompt B renders at all) and what "Next" requires before advancing. It does not change the underlying matrix math (`promptIds.length × modelIds.length × testCaseCount × runsPerCell`), which already supports arbitrary prompt/model counts.

### 5.2 Purpose Templates & Template Gallery

The Template Gallery is a card grid: one card per purpose template (built-in + any user-saved), plus an explicit **"Start Blank"** card for a from-scratch evaluation.

`EvalPurposeTemplate` bundles everything needed to jump straight into a meaningful first run for a specific kind of task:

```ts
interface EvalPurposeTemplate {
  id: string;
  name: string;
  description: string;
  purposeCategory: 'classification' | 'tagging' | 'summarization' | 'custom';
  builtIn: boolean;
  seedPromptContent?: string;
  defaultComparisonMode: 'model' | 'prompt' | 'matrix';
  assertionStrategy: { type: 'exact-label' | 'label-overlap' | 'llm-rubric' | 'custom'; config: Record<string, unknown> };
  starterTestCases: TestCase[];
  createdAt: string;
  updatedAt: string;
}
```

**The 3 built-in templates**, seeded from MemoryAPI's real classification/tagging/summarization prompts (`C:\LocalDev\Projects\MemoryAPI\src\prompts\`, `src\samples\`) — chosen because they're a concrete use case the user already needs solved, and because the source prompts are actively being refined for MemoryAPI's own sake, so LMEval benefits from that same work:

| Template | `assertionStrategy` | Source | Notable fix vs. verbatim source |
|---|---|---|---|
| **Classification** | `exact-label` — Promptfoo `equals`/`icontains` against an 8-category list | `categorization.txt` + `allCategories.json` | The shipped prompt's few-shot example says `Category: Code snippet`; the real label is `Snippet`. The POC deliberately preserved this mismatch to prove the eval catches it — the *template*, meant to help users going forward, ships the corrected label instead. |
| **Tagging** | `label-overlap` — a bundled `javascript` Jaccard-overlap assertion (ported from the POC's `scripts/tag-overlap-assert.js`) | `tagging.txt` + `allTags.json` (~60 tags) | The shipped prompt's example #16 references tag `"Personal"`, absent from the real tag list — same fix-not-reproduce treatment. |
| **Summarization** | `llm-rubric` — conciseness, faithfulness, coverage | `memory_summary.txt` | Deliberately **not** deterministic; summarization quality is inherently subjective, which is why the original POC scoped it out as "the logical next POC" rather than force-fitting exact-match scoring. |

Selecting a template pre-fills `EvalWizardContext` before landing on Step 1: `comparisonMode` (all 3 defaults default to `'prompt'` — the primary refinement loop is "did my edit help"), Prompt A content, `inlineTestCases` (a copy of `starterTestCases`, editable without mutating the template), and — on Step 2 — the assertion/success-criteria card and (for `llm-rubric` templates) the Judge Configuration card, which becomes required rather than optional.

A **"Save as Template"** action on Step 2 lets a user capture their own refined prompt + assertion config + test cases as a new `purposeCategory: 'custom'` template, so a MemoryAPI prompt refinement done today becomes tomorrow's one-click starting point.

### 5.3 Step-by-step reference

**Step 1 — Prompts & Models** (`/eval/prompts`): Evaluation Mode strip (§5.1) → prompt editor(s) with drag-and-drop upload, saved-prompt version selector, collapsible side-by-side JetBrains-style diff (word-level highlights) → multi-model selector grouped by LMApi server.

**Step 2 — Prepare** (`/eval/config`): template/assertion configuration (pre-filled if arrived via a purpose template, §5.2), test case editor (Quick single-message mode / Suite table mode with import/export), Judge Configuration, shared server validation, sticky execution preview, and preset/template save-load. `/eval/config/:evalId` is the stable handoff page for a server-backed draft or an immutable started configuration; it loads pinned prompt content and returns base-path-aware run/results/summary links.

**Step 3 — Run** (`/eval/run/:id`): elapsed timer, WebSocket connection status, per-prompt cards with per-model status rows (pending/running/completed/failed), live feed of completed cells, error panel with per-cell retry.

**Step 4 — Results** (`/eval/results/:id`): five tabs — Scoreboard (heatmap matrix + model/prompt leaderboards + regression banner), Compare (side-by-side response + diff + per-assertion pass/fail once `assertionResults` lands, §4), Detail (full cell drill-down), Metrics (Recharts latency/token charts, deterministic-compliance table), Timeline (historical composite score per model). Export to HTML/Markdown; "Save as Baseline" for future regression comparisons.

`VerdictHeader`'s gate-first headline (R8) reads the CI-aware `gate.verdict` (A7/A8, 2026-09-04), not a bare pass/fail: `pass` — "X clears the &lt;task&gt; gate (N cases)"; `inconclusive` — "X's &lt;task&gt; gate is inconclusive at N cases — need ~M more to resolve"; `advisory` (summarization only, judge self-judging or unqualified) — "X's &lt;task&gt; result is advisory only — &lt;reason&gt;"; `fail` — "X does NOT clear the &lt;task&gt; gate — &lt;first failure&gt;". This intentionally never renders a false pass off a threshold an under-sampled run can't actually support.

**Step 5 — Summary** (`/eval/summary/:id`): **not yet implemented.** Placeholder page; full design (executive summary, model recommendation, per-model failure analysis, prompt improvement suggestions with diff preview and one-click apply) is Phase 9 in `docs/prompt-eval-system/TASK.md`.

### 5.4 Agent API contract

`GET /api/eval/evaluations/:id/feedback` is the resumable orchestration surface: it combines lifecycle
status, persisted progress, validation, failures, artifact readiness, a compact CI-aware verdict, and
deployment-relative browser paths. Detailed results remain on their existing endpoints. The checked-in
OpenAPI 3.1 document at `docs/openapi/lmeval-eval-api.v1.json`, also served at
`GET /api/eval/openapi.json`, is the machine-readable route contract. Standalone passes `/` and the
HomeBase adapter passes its configured mount path into the shared `buildApp()` composition root.

### 5.5 Run History & Insights (cross-run dashboard)

`/insights` (`src/pages/InsightsPage.tsx`) is a cross-run dashboard surface, separate from the per-evaluation wizard above and from the live-run `DashboardPage.tsx` (Step 3): a leaderboard, metric-trend + confidence-interval band, gate-verdict-history strip, diagnostic-issue panel, and an explicitly-caveated operational panel, spanning *all* evaluations for an activity (classification/tagging/summarization) rather than one evaluation's own prompt lineage. Backed by `server/routes/insights.ts` (`/api/eval/insights/*`) reading the SQLite index described in §2, not the per-evaluation JSON files directly — that index is populated automatically by a write-through step at the end of `ExecutionService.aggregate()`, plus a one-time `npm run insights:backfill` for evaluations that completed before this feature existed. Linked from the Session Hub. Full design: `docs/plans/2026-09-06-evaluation-dashboard-and-sqlite-schema.md`.

## 6. Relationship to prior docs

This document is the current source of truth for LMEval's architecture and wizard UX. The following documents remain valuable but are **historical inputs**, not competing specs:

- `docs/prompt-eval-system/IMPLEMENTATION_PLAN.md`, `docs/prompt-eval-system/TASK.md` — the original phase-by-phase build plan (Phases 0-9, F5) and its checklist-based progress tracking. Still the right place to track implementation checkboxes; new phases (10-12, from the Promptfoo migration) extend that numbering — see `docs/plans/2026-09-03-promptfoo-adoption-and-purpose-templates.md`.
- `docs/features/eval-wizard/EVAL_WIZARD.md` — the frontend implementation plan for the current 5-step wizard (routes, components, state management). Still accurate for Steps 3-5 and the overall architecture; Steps 1-2 are extended, not replaced, by §5 above.
- `docs/features/eval-wizard/PROMPTFOO_CONFIG_WIZARD_MOCKUP_BRIEF.md` — an earlier, more speculative design brief written *before* the POC existed, assuming Promptfoo from documentation alone. Correctly anticipated a lot (hard-gate/soft-score split, generated-config-preview sidebar, agent/API tool-verification UI) but its "Evaluation Profile" concept (Agent skill/MCP, API workflow, Summarization, Categorization, Tagging, LLM judge, Repeatable experiment, Software engineering agent, Custom) is broader than what's specified in §5.2 here — this document's 3-template v1 scope (Classification, Tagging, Summarization) is the validated subset to build first; the agent/API/tool-verification profiles remain aspirational, tracked as non-goals below.
- `docs/features/eval-wizard/PREPARE_WIZARD_FUTURE_ITERATIONS.md` — future workstreams (determinism controls, hard-gate/soft-score split, Summary Intelligence, continuous regression mode) written before the Promptfoo decision. Still a reasonable roadmap for what comes after Phases 10-12; its `EvaluationProfile` type sketch overlaps with `EvalPurposeTemplate` (§5.2) — treat §5.2 as the one to implement.
- `docs/plans/2026-09-02-promptfoo-poc-evaluation.md` and the POC's own results (`C:\LocalDev\Projects\promptfoo-poc\README.md`, outside this repo) — the validation work behind §4's engine decision. Read that README's decision log for the full reasoning, not just the summary in §4.

## 7. Non-goals / deferred

- **Tool-call / API-contract / trace verification** (the mockup brief's Step 2 Card 4) — relevant once agent/MCP workflows are in scope for LMEval; not part of the Promptfoo migration or purpose-template work in this document.
- **RAG source evaluation** (SQL/Graph/Vector result analysis) — deliberately deferred, the most complex future use case per the user.
- **Promptfoo's red-teaming/security-scanning features** — irrelevant to LMEval's use case.
- **Summarization as a deterministic check** — explicitly rejected; summarization quality is subjective and belongs behind `llm-rubric`, not exact/overlap matching.
- **Live sync between LMEval's purpose templates and MemoryAPI's source JSON files** — templates are seeded once from a snapshot; no automated refresh mechanism exists or is planned for v1.
- **Step 5 (Summary) full implementation** — tracked separately as Phase 9 in `docs/prompt-eval-system/TASK.md`; out of scope for the Promptfoo/purpose-template work described here.
