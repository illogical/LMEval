# LMEval — Unified Task List

> **Supersedes** [`prompt-eval-system/TASK.md`](prompt-eval-system/TASK.md) (backend/engine track) and
> [`features/eval-wizard/TASK.md`](features/eval-wizard/TASK.md) (wizard/UX track). Both remain in the
> repository as historical records of completed work; **all open work lives here.**
>
> **Last reconciled against the working tree:** 2026-09-05 (A1, A3, A6, MemoryApi's A2, A7, A8, A9, A10, and B1/B2/B3 closed)

---

## 1 — What this project is for

LMEval exists to make one class of decision measurable: **which prompt wording, and which local
model, should a system that calls local LLMs actually ship?** Everything in the codebase is
downstream of that. The wizard collects the experiment (prompts, models, test cases, grading rules),
the engine runs it against LMApi's pooled local models, and the Results page turns the raw matrix
into a verdict a human can act on.

Two questions, and they are not the same experiment:

1. **Which prompt is best?** Vary prompt wording, hold the model fixed.
2. **Which model is best for this task?** Vary the model, hold the promoted prompt fixed.

Running them as one undifferentiated matrix produces a winner attributable to neither variable.
`EvaluationConfig.comparisonMode` (`model` | `prompt` | `matrix`) already encodes the distinction;
the two-phase protocol in §4 Track A is what makes it mean something.

### Relationship to MemoryApi

MemoryApi is LMEval's first real consumer. It runs three ingestion tasks per memory —
classification (8 categories), tagging (61 tags), summarization — with separate task-model
overrides that fall back to the shared `LLM_MODEL`. LMEval's three built-in purpose templates were
seeded directly from MemoryApi's `src/prompts/` and `src/samples/`, and LMEval's three built-in
benchmark suites (`memory-classification-v1`, `memory-tagging-v1`, `memory-summarization-v1`, A5)
were curated by LMEval itself from that same MemoryApi source material — harvested, augmented for
missing coverage, reviewed, and hashed entirely within this repository. There is no MemoryApi
exporter or snapshot this work waits on.

MemoryApi remains authoritative for its own current prompts, category/tag vocabularies, transport,
and production behavior; LMEval reads that material as a reviewed *input* to curation, not as a
delivered artifact, and never calls MemoryApi at runtime or writes into its repository:

| Direction | Artifact | Content |
|---|---|---|
| MemoryApi → LMEval | Source material (`src/prompts/`, `src/samples/`), read directly from a pinned MemoryApi revision | Prompt text, category/tag taxonomies, labeled sample memories — inputs LMEval curates into its own benchmark suites and review ledger |
| LMEval → MemoryApi | `prompt-promotion-record.v1` | Evaluated prompt + model, resolved inference parameters, task metrics with confidence intervals, slice breakdowns, gate verdicts, judge qualification, `ModelRecommendation` set, consumed snapshot hashes |

**LMEval owns curation of its own benchmark artifacts and their acceptance gate (human review of the
review ledger before `approved` provenance). LMEval owns measurement. MemoryApi owns its production
prompts, taxonomies, and runtime behavior, and receives advice via the promotion record.** A future
interoperability/export contract between the two projects (A10) is later work, not a prerequisite
for A4/A5.

Full detail: [`plans/2026-09-03-professional-memory-evaluations.md`](plans/2026-09-03-professional-memory-evaluations.md),
[`plans/2026-09-04-a4-a5-ground-truth-built-in-suites.md`](plans/2026-09-04-a4-a5-ground-truth-built-in-suites.md),
and the cross-project review in [`plans/2026-09-04-ingestion-eval-alignment-review.md`](plans/2026-09-04-ingestion-eval-alignment-review.md).

---

## 2 — Status at a glance

| Phase | Scope | State |
|---|---|---|
| 0 | MVP prompt-comparison UI | ✅ complete |
| 1 | Backend services + CRUD API | ✅ complete |
| 1.5 | Session management + prompt upload | ✅ complete |
| 2 | Evaluation engine (no judge) | ✅ complete |
| 2.5 | Git integration for prompt versioning | ⚠️ backend done, frontend buttons open |
| 3 | Export, baselines, history | ✅ complete |
| 4 | LLM judge system | ✅ complete |
| 5 | Frontend config + execution | ✅ complete |
| 6 | Frontend results + analysis | ✅ complete |
| 6.5 | Run dashboard fixes + redesign | ✅ complete |
| 7 | Prepare & Results refinement | ✅ complete 2026-09-05 (B1/B2), browser walkthrough owed — see Track B/E |
| 8 | Automated refinement loop | ⛔ not started |
| 9 | Wizard Step 5: AI summary | ✅ complete 2026-09-05 (B3), browser walkthrough owed — see Track B/E |
| 10 | Promptfoo engine migration | ⚠️ complete except pairwise + live verification |
| 11 | Evaluation mode strip | ✅ complete except Full-Matrix N-slot UI |
| 12 | Purpose templates + gallery | ✅ complete, browser walkthrough unverified |
| F5 | AI-generated test cases | ⛔ deferred (dogfood candidate) |
| W1–W8 | Prepare wizard layout polish | ✅ complete |
| I1–I4 | Test case import/export | ✅ complete (verified in tree 2026-09-04) |
| PME | Professional memory evaluations | ⚠️ A1, A3, A4, A5, A6, A7, A8, A9, A10 complete (2026-09-04/05) and MemoryApi's A2 transport implementation complete; A2's snapshot-import step remains — see §4; A3/A4/A5/A6/A7/A8/A9/A10 owe live model verification and/or human review-ledger approval, tracked in Track E |

---

## 3 — Completed in this pass (2026-09-04, second pass)

**Track A7/A8 — Statistics and judge qualification**, closing the two blockers that stopped the
first 2026-09-04 pass short of its intended scope (see the entry below):

- `npx vitest run` → **204 passing, 28 files, all green** — the pre-existing vitest 4.1.0/environment
  breakage recorded in the first pass's entry below **no longer reproduces**: every test file this
  pass touched or added ran to completion, including the earlier pass's R1-R8 tests
  (`AssertionStrategyService.test.ts`, `PromptfooAdapter.test.ts`, `SummaryService.test.ts`) that were
  previously only hand-traced. Root cause of the original breakage not diagnosed (out of scope); noting
  it's resolved rather than re-asserting the old caveat. `tsc -b`, `npm run build`, `npm run lint` clean
  (`npm run lint`'s 24 pre-existing errors are unchanged and none are in a file this pass touched).
- **`server/services/StatisticsService.ts`** (new, pure functions, unit-tested in isolation —
  12/12 passing in `StatisticsService.test.ts`): `bootstrapCI()` (percentile bootstrap, deterministic
  seeded resampling), `mcNemarTest()` (paired, continuity-corrected, normal-approximation p-value),
  `caseCountGate()` (pass only when the whole CI clears a threshold; `inconclusive` with a rough
  needed-case estimate otherwise, never a false pass).
- **`src/types/eval.ts`**: `GateResult` gains `verdict: 'pass' | 'fail' | 'inconclusive' | 'advisory'`,
  `caseCount`, `neededCases?` alongside the existing `pass`/`failures`. Each `TaskMetrics` variant gains
  its CI field (`accuracyCI`/`mcNemar` for classification, `jaccardCI` for tagging, `weightedCI`/
  `judgeQualified` for summarization). New `ConfidenceInterval`, `McNemarResult`, `JudgeQualification`
  types. `MetricRegression` gains `onCaseMovementPct?`.
- **`server/services/SummaryService.ts`**: all three `compute*Metrics()` functions now bootstrap a CI
  over their primary per-case metric and derive `gate.verdict` from `caseCountGate()` rather than a
  bare point-estimate boolean; classification accepts optional `baselineCells` for McNemar;
  summarization's gate is forced to `'advisory'` whenever `judgeQualified` is `false`/absent (judge
  never qualified, or qualification stale) — independent of the self-judge guard, which also forces
  `'advisory'`. `computeRegression()` accepts an optional `totalCases` and reports
  `onCaseMovementPct` per metric.
- **`server/services/ExecutionService.ts`**: defaults `runsPerCell: 3` / `inference: { temperature:
  0.3, maxTokens: 1000 }` for classification/tagging built-in purpose templates when both were left
  unset (previously silently ran at `runsPerCell: 1`, forfeiting run-to-run-agreement and any CI);
  reads a persisted `JudgeQualification` for `config.judgeModelId` and threads `judgeQualified` into
  `aggregate()` for summarization runs.
- **`server/services/JudgeQualificationService.ts`** (new): `qualify()` runs a judge model 3x
  (self-consistency, t=0) against each case in a calibration set via `LmapiClient.chatCompletion()`,
  computes Spearman (judge vs. human overall), Faithfulness-within-1-point rate, mean inflation, and
  per-dimension self-consistency MAD; persists a `JudgeQualification` record. `get()` reads it back.
- **`data/evals/calibration/summarization-v0.json`** (new): a **temporary, in-repo, 22-case
  hand-scored fixture** — explicitly LMEval-authored, not MemoryApi data. Distinct from A5's
  `memory-summarization-v1` benchmark suite (36 reviewed cases with reference answers); consider
  whether judge calibration should move onto a slice of that suite once its review ledger is approved.
- **`server/routes/judges.ts`** (new) + mounted at `/api/eval/judges` in `server/index.ts`:
  `POST /:modelId/qualify` (optional `{ calibrationSetId }`), `GET /:modelId/qualification`.
- **`src/components/results/VerdictHeader.tsx`**: the gate headline now reads `gate.verdict` (pass /
  fail / inconclusive-with-needed-cases / advisory-with-reason) instead of a bare boolean, per §5.3 of
  `docs/SPECIFICATION.md` (updated in this pass alongside §3's `EvaluationSummary`/`GateResult` shape).
- **Deferred/partial, stated plainly**: A8's compression-bounds derivation from real MemoryApi
  reference summaries is not built (blocked on A5); no Prepare-page UI surfaces judge-qualification
  status yet (route + gating logic only); macro-F1/micro-F1's CI is a per-case exact-match/Jaccard
  proxy, not a true macro-F1-specific bootstrap (see A7's scoping note in §4); live-model verification
  of all of the above is owed — added to Track E below.

## 3a — Completed in the first 2026-09-04 pass

**Track A3/A6 — Typed assertion strategies and task-appropriate scoring** (R1-R8 of
[`plans/2026-09-04-2053-feat-core-task-measurement-excellence-plan.md`](plans/2026-09-04-2053-feat-core-task-measurement-excellence-plan.md)),
scoped to exactly the three built-in task types per that plan's Key Decisions (no generalized
plugin/custom-task-type system built — that stays deferred in Track F):

- `tsc -b`, `npm run build` clean. `npm run lint`: 24 pre-existing errors, unchanged before/after
  (confirmed via `git stash`) and none in a file this pass touched.
- `npx vitest run` **could not be executed to a passing baseline in this environment** — every test
  file (frontend and backend, `26`/`5`+ files respectively) fails at the top-level `describe()` call
  with `TypeError: Cannot read properties of undefined (reading 'config')`, confirmed via `git stash`
  to reproduce identically on a clean `main` before this pass's changes. This is a pre-existing
  vitest 4.1.0 / environment breakage, unrelated to R1-R8 and out of this pass's scope to fix; new
  and touched tests below are logic-verified by hand-trace, not machine-executed. Flagged as owed
  verification, not claimed as passing.
- **`src/types/eval.ts`**: `AssertionStrategy.config: Record<string, unknown>` replaced with a
  discriminated union (`ExactLabelConfig`/`LabelOverlapConfig`/`GroundedSummaryConfig`/
  `CustomAssertionConfig`) keyed by `type: 'exact-label' | 'label-overlap' | 'grounded-summary' |
  'custom'` (R1-R3; `'llm-rubric'` retired as a type name — normalizes into `'grounded-summary'`).
  Added `TestCase.protectedTokens?`/`forbiddenClaims?` (minimal fields needed for R6's deterministic
  checks — not full A4). Added the R4-R7 discriminated `TaskMetrics` union
  (`ClassificationTaskMetrics`/`TaggingTaskMetrics`/`SummarizationTaskMetrics`, each with its own
  `GateResult`) and `EvaluationSummary.taskMetrics?`.
- **`server/services/AssertionStrategyService.ts`** (new): `normalizeAssertionStrategy()` validates
  and normalizes a raw assertion strategy, accepting either legacy or current keys on read
  (`categories`→`labels`, `tagVocabulary`→`vocabulary`, `threshold`→`minimumCaseF1`,
  `llm-rubric`+`dimensions`→`grounded-summary`+`templateId`) and always emitting normalized keys;
  throws `AssertionStrategyValidationError` for a structurally invalid strategy (R2), most notably an
  invalid `custom` config (must carry a non-empty `description` — deliberately not a plugin point,
  see the plan's Scope Boundaries).
- **`server/routes/purposeTemplates.ts`**: `POST`/`PUT` now run the strategy through
  `normalizeAssertionStrategy()` and return `400` with the validation message on failure, instead of
  silently accepting (and, for `custom`, silently no-op-ing) whatever shape was sent.
- **`server/services/PromptfooAdapter.ts`**: `buildExactLabelAssertion()` wires `exact-label` (R1) —
  a `javascript` assertion comparing the trimmed response against `TestCase.expectedOutput` exactly,
  replacing classification's previous `expectedKeywords` prose-matching (which accepted explanatory
  text containing the label). `buildLabelOverlapAssertion()` now reads the normalized
  `vocabulary`/`minimumCaseF1` keys. `buildSummaryDeterministicAssertion()` (R6) runs the
  preamble/heading/fence/compression/protected-token/forbidden-claim checks per cell, via the new
  shared `server/services/summarizationChecks.ts` module (also used by `SummaryService`, so the
  per-cell pass/fail and the aggregate rates can never disagree). `buildGroundedSummaryRubricAssertions()`
  emits 3 metric-suffixed (`${perspective}#1..3`) `llm-rubric` assertions per rubric dimension instead
  of 1 — the plan's own Outstanding Questions left the 3-pass mechanism's implementation open; this
  choice reuses Promptfoo's existing dispatch/parsing untouched. `buildJudgeProvider()` now forces
  `temperature: 0` on the grading call (R6's "t=0" judge passes).
- **`data/evals/templates/summarization-quality.json`**: perspectives revised to Faithfulness 0.40 /
  Salient Coverage 0.30 (renamed from Coverage) / Retrieval Utility 0.20 (new) / Concision 0.10
  (renamed from Conciseness), matching R6's weights exactly.
- **`data/evals/purpose-templates/{classification,tagging,summarization}.json`**: rewritten to the
  normalized key shapes (`labels`, `vocabulary`+`minimumCaseF1`, `grounded-summary`+`templateId`+
  `compressionRange`) per R3.
- **`server/services/SummaryService.ts`**: added `computeClassificationMetrics()`,
  `computeTaggingMetrics()`, `computeSummarizationMetrics()`, dispatched by the new
  `computeTaskMetrics()` and wired into `computeSummary()`'s options
  (`testCases`/`purposeCategory`/`assertionStrategy`/`selfJudgeGuardViolated`). Classification and
  tagging assertions are `javascript`, never `llm-rubric`, so `compositeScore` stays naturally absent
  for them — R7's "never manufacture a rubric composite for classification/tagging" holds without
  extra guarding. Summarization's median-of-3-judge-passes aggregation happens at both the per-case
  and cross-case level (median of the 3 pass scores per case, then median of those medians).
- **`server/services/ExecutionService.ts`**: threads `testCases`/`purposeCategory`/`assertionStrategy`
  through to `aggregate()`/`computeSummary()`; computes the R6 self-judge guard
  (`config.judgeModelId` also present in `config.modelIds`, on a summarization purpose template) and
  passes it through as `selfJudgeGuardViolated`.
- **`src/components/results/VerdictHeader.tsx`** (R8, minimal): when `summary.taskMetrics` is
  present, the headline becomes the gate verdict ("X clears/does NOT clear the &lt;task&gt; gate —
  &lt;first failure&gt;") with the previous score-based headline demoted to supporting detail. Scoped
  to `comparisonMode: 'model'`; a genuine multi-model per-task gate comparison panel is A11, not this
  pass.
- **Fixed 3 call sites** left on the old `AssertionStrategy` shape by the type change:
  `src/pages/ConfigPage.tsx`, `src/contexts/purposeTemplateStorage.ts`,
  `server/services/__tests__/ExecutionService.inference.test.ts`.
- **New/extended tests** (not machine-verified per the vitest note above, but logic hand-traced):
  `server/services/__tests__/AssertionStrategyService.test.ts` (new — bidirectional legacy key
  normalization, custom-config rejection, unknown-type rejection); `server/services/__tests__/
  PromptfooAdapter.test.ts` (extended — exact-label rejects label-containing prose, flags an
  out-of-set label, is skipped without `expectedOutput`; summary-deterministic assertion catches a
  preamble); `server/services/__tests__/SummaryService.test.ts` (extended — classification accuracy/
  macro-F1/confusion-matrix/gate/run-to-run-agreement; tagging TP-FP-FN-derived P/R/F1/Jaccard/
  unknown-and-duplicate-rate without repair; summarization self-judge-guard gating, 3-pass median
  aggregation, deterministic-check independence from the judge).

**Deferred/partial, stated plainly:**
- **R6's "critical unsupported claim"** is approximated as a per-case median Faithfulness score ≤ 1
  (the rubric's "multiple fabrications" floor) — there is no per-finding judge output to identify a
  *specific* unsupported claim yet; that's A8/A11 territory (judge qualification, finding-level
  reporting), not built here.
- **A7 (statistics/CIs)** and **A8 (judge qualification)** are untouched, as scoped — the gates above
  are point-estimate thresholds, not confidence-interval-aware ones, and a summarization result's
  judge is not qualified against a calibration set.
- **A11 (task-specific reporting)** beyond the single VerdictHeader gate-first headline (confusion-
  matrix panels, per-tag drill-down, multi-model gate comparison) is not built.
- **A4 (test case grounding fields)** is not built beyond the two minimal fields (`protectedTokens`/
  `forbiddenClaims`) R6 needed; `expectedLabels`/`caseTags`/`requiredFacts`, CSV/JSON import wiring,
  and the `tags`-deprecation warning remain open.
- **Live model verification** (a real LMApi + Ollama round trip exercising `exact-label`, the tagging
  parse-without-repair path, and the 3-pass judge) is owed — see the new Track E entry below.

**Track A1 — Inference parameters and provenance**, in full (`npx vitest run` → 169 passing,
29 files, up from 152/23; `tsc -b`, `npm run build`, `npm run lint` clean for the touched files):
`EvaluationConfig.inference`/`resolvedInference`/`inferenceParametersUnspecified`/
`transportProvenance` and `EvalPurposeTemplate.inference` added to `src/types/eval.ts`;
`temperature`/`max_tokens`/`seed` added to `LmapiChatCompletionRequest`; resolution logic extracted
as the standalone, unit-tested `ExecutionService.resolveInferenceAndProvenance()`
(config → purpose template → none); all three built-in purpose template JSON files carry
`inference: { temperature: 0.3, maxTokens: 1000 }`; `SummaryService.computeSummary()` computes an
aggregate truncation rate; `VerdictHeader` surfaces both truncation rate and an
"inference parameters unspecified" caveat; `ReportService`'s Markdown/basic-HTML exports carry
resolved inference and transport provenance. Two cross-repo handoff docs filed (plain markdown,
no code changes made by LMEval to either repo): `LMApi/docs/plans/2026-09-04-sampling-parameter-support.md`
(the `seed` schema gap plus informational Ollama native-option constraints) and
`MemoryApi/docs/plans/2026-09-04-lmeval-transport-parity-handoff.md` (an addendum to MemoryApi's
own ingestion-prompt-refinement plan, not a competing one). **The LMApi sampling-options handoff
closed the same day** — LMApi added `seed` to its chat-completions schema, so `seedHonored` ships
`true`. Ollama's compatible endpoint also supports `top_p`; request-level `top_k`/`num_ctx` do not,
but LMEval has no current consumer for them and can use Modelfile-derived model aliases if a fixed
configuration is needed. See `docs/plans/2026-09-04-lmapi-native-options-available.md`.

**MemoryApi transport-parity implementation handoff received and revision-verified:** MemoryApi
revision `c7ecb9e292947f88199c16548b88dc4fc8557a60` implements ordered `[system, user]` messages to
`/api/chat/completions/any`, the canonical `<memory>` wrapper and closing-delimiter escaping,
task-specific model/inference resolution, transport/prompt identities, and finish-reason capture.
See `docs/plans/2026-09-04-memoryapi-implementation-handoff.md`. This closes the MemoryApi
implementation dependency, not LMEval's snapshot import or live cross-process verification.

Phase 7 items closed against the working tree, all covered by tests (`npx vitest run` → 152 passing,
23 files; `tsc -b`, `npm run build`, and `npm run lint` clean for the touched files):

- [x] **Pre-run validation on the Prepare page** — `ConfigPage.tsx` computes a `blockers` list (no
  prompt content, no models, Model Comparison below 2 models, Prompt Comparison missing a second
  prompt) rendered in a `role="alert"` sidebar card, and a non-blocking `warnings` list (judge
  template with no judge model, no test cases defined). The Run button is disabled while any blocker
  stands and carries the blocker text in its `title` tooltip.
- [x] **Auto-save status on the Run button** — the header button reads `Saving prompts…` while
  `createPrompt()` calls are in flight, then `Starting…`, then returns to `Run Evaluation`.
- [x] **Plain-English cell count** — `ExecutionPreview` now states `N total LLM calls` beneath the
  `P × M × T × R` math, expands each factor in a legend, and — new — **counts judge calls
  separately** (`judgePerspectiveCount`, resolved from the selected template's perspectives), since
  every rubric perspective is one more LLM call. The large-matrix warning fires on the grand total,
  not the completion count.
- [x] **Runs-per-cell noise hint** — at `runsPerCell === 1` the preview says score differences under
  ±0.3 are within noise. This is the same honesty the Results verdict header carries; it belongs
  *before* the run, when the user can still change it.
- [x] **Test case row-count badge** next to the Test Cases section title.
- [x] **React error boundary** — `src/components/common/ErrorBoundary.tsx` wraps the wizard `<Outlet>`
  in `EvalLayout.tsx`, labeled by step and reset on navigation, with Try again / Reload actions and a
  collapsible stack trace. This is the structural fix for the class of failure recorded in
  [`fixes/2026-09-03-results-page-blank-crash.md`](fixes/2026-09-03-results-page-blank-crash.md),
  where one undefined prop unmounted the entire tree into a blank page.
- [x] **Compare view: copy + per-response stats** — each response panel gets a Copy button and a
  footer line with latency, input/output token counts, tok/s, and a flag when `finishReason` is not
  `stop`. Truncation is a measurement defect, not a quality signal, and it needs to be visible.
- [x] **Reconciled I1–I4** (test case import/export) as complete — `src/utils/testCaseIO.ts`,
  the Suite-tab toolbar, drag-and-drop, clipboard paste, CSV template download, Save-as-Suite, and
  the conditional Tags column all ship; `TestSuiteService.create()` spreads test cases whole, so
  `expectedOutput` and `tags` pass through. The task list was simply stale.

---

## 4 — Open work

### Track A — Measurement fidelity *(critical path — blocks everything downstream)*

> Plan: [`plans/2026-09-03-professional-memory-evaluations.md`](plans/2026-09-03-professional-memory-evaluations.md)
>
> **A1, A3, A6, A7, A8, A9, and A10 have landed.** MemoryApi's A2 transport implementation has also
> landed. Promotion evidence still requires the exact imported MemoryApi snapshot contract plus a live
> cross-project parity check; neither is implied by documentation or unit tests. A3/A6/A7/A8/A9/A10's
> logic is unit-tested (`npx vitest run` is now clean, 266/35 — see §3) but **not yet live-verified**
> against a real LMApi + Ollama round trip — see the Track E entries below. Track A's numbered items
> (A1-A10) are now closed except A2's snapshot-import step. Earlier passes' scoping notes mention an
> "A11" for finding-level unsupported-claim extraction and a genuine multi-model gate-comparison
> panel — that was never given its own numbered section here and remains uncommitted future scope
> (see Track F), not a tracked open item.

**A1 — Inference parameters and provenance** *(first, because every later measurement is untrustworthy without it)* — ✅ **complete 2026-09-04**
- [x] Add `inference?: { temperature: number; maxTokens: number; seed?: number }` to `EvaluationConfig`
- [x] Thread it through `PromptfooAdapter.buildLmapiProvider()` into the LMApi request body — `chatReq` now sends `temperature`/`max_tokens`/`seed` when a resolved inference object is present, omitted entirely otherwise (unchanged behavior for unspecified runs)
- [x] Resolution order: per-run config → purpose template defaults → LMApi default; persisted via `ExecutionService.resolveInferenceAndProvenance()` onto `config.resolvedInference` before `runPromptfoo` executes, mirrored onto `EvaluationSummary`
- [x] Built-in purpose templates default to `temperature 0.3` for all three tasks (classification, tagging, summarization) — matches MemoryApi's actual production temperature, read from `memoryTextProcessor.ts`
- [x] Built-in purpose templates default `maxTokens` to **1000** for all three tasks
- [x] Mark results that ran without explicit parameters `inferenceParametersUnspecified` — surfaced as a `VerdictHeader` caveat and in Markdown/basic-HTML exports
- [x] Record `finishReason` per cell and report a **truncation rate** — aggregate now computed in `SummaryService.computeSummary()` (excludes cells with no captured `finishReason` from the denominator) and surfaced as a `VerdictHeader` caveat and export line
- [x] Record the LMApi endpoint path and message shape in each evaluation's provenance (`EvaluationConfig.transportProvenance` / mirrored on `EvaluationSummary`) — this is the recording half only; the A10 import-guard that *refuses* a mismatched transport is not built yet
- [x] `seed` threaded through and honored end-to-end (`seedHonored: true` in provenance) — shipped inert-but-present first (LMApi didn't accept it yet), then LMApi added `seed` to `ChatCompletionSchema` the same day in response to the handoff doc filed at `LMApi/docs/plans/2026-09-04-sampling-parameter-support.md`. **LMApi handoff closed.** Ollama's compatible endpoint supports `top_p`, but not request-level `top_k`/`num_ctx`; neither is in A1's contract or needed by a current LMEval consumer. Use a provenance-recorded Modelfile-derived model alias for a fixed `top_k`/`num_ctx`, or revisit LMApi native `/api/chat` translation only when per-run control is required. See `docs/plans/2026-09-04-lmapi-native-options-available.md`

**A2 — Transport parity with MemoryApi** *(MemoryApi implementation complete; LMEval snapshot consumption and live parity verification remain)*
- [x] MemoryApi now posts ordered `messages: [system, user]` without flattening to `/api/chat/completions/any`, matching LMEval's endpoint and `chat-messages` provenance vocabulary. It also resolves task-specific models and inference values and captures `finish_reason`. Verified at MemoryApi revision `c7ecb9e292947f88199c16548b88dc4fc8557a60`; see `docs/plans/2026-09-04-memoryapi-implementation-handoff.md`
- [ ] Imported snapshot cases must carry the `<memory>` delimiter wrapper inside `userMessage` exactly as production sends it, including the escaping rule for a literal closing delimiter

**A3 — Typed assertion strategies** — ✅ **complete 2026-09-04**
- [x] Replace `AssertionStrategy.config: Record<string, unknown>` with the discriminated union: `exact-label` | `label-overlap` | `grounded-summary` | `custom`; validate at the service boundary, `400` on invalid custom templates
- [x] Legacy key normalization in both directions: `categories`→`labels`, `tagVocabulary`→`vocabulary`, `threshold`→`minimumCaseF1`, `llm-rubric`+`dimensions`→`grounded-summary`+`templateId`. Read accepts either, write emits normalized
- [x] Rewrite the three files under `data/evals/purpose-templates/` in the same change
- [x] **Wire `exact-label`** — it is declared as a purpose strategy but `PromptfooAdapter` builds no assertion for it, and `TestCase.expectedOutput` is ignored entirely. Classification is currently graded by `expectedKeywords`, which accepts explanatory prose containing the label

**A4 — Test case grounding fields** — ✅ **complete 2026-09-05**
- [x] Extend `TestCase` with `expectedLabels?`, `caseTags?`, `requiredFacts?` (`forbiddenClaims?`/`protectedTokens?` already added by R6, above)
- [x] Keep `tags` as a deprecated import alias for `expectedLabels`; order-insensitive comparison; warn when both are present and differ (`src/utils/testCaseIO.ts`)
- [x] Update JSON/CSV parse + serialize (semicolon-delimited arrays for `expectedLabels`/`caseTags`/`requiredFacts`/`forbiddenClaims`/`protectedTokens`), the suite editor (`TestCaseEditor.tsx`, task-aware columns), and API types together

**A5 — Built-in benchmark suites** — ✅ **complete 2026-09-05, per [`plans/2026-09-04-a4-a5-ground-truth-built-in-suites.md`](plans/2026-09-04-a4-a5-ground-truth-built-in-suites.md)**
> Built without waiting on a MemoryApi exporter — LMEval curated the three suites itself from
> MemoryApi source material read at a pinned revision, augmenting for coverage gaps and recording
> full provenance. `reviewStatus` is `pending-human-review` until the checked-in review ledger is
> approved; that approval is this workflow's acceptance gate, not a future MemoryApi deliverable.
- [x] Extend `TestSuite` with `builtIn`, `purposeCategory`, `version`, `provenance{source, sourceRevision, sourceFiles[], taxonomySha256, datasetSha256, curatedAt, reviewStatus}`
- [x] Version-controlled built-ins at `data/evals/test-suites/built-in/`; writable suites at the data-root `evals/test-suites/custom/`; legacy suites read as custom, never auto-migrated (`FileService.configurePaths()`, `TestSuiteService`)
- [x] `TestSuiteService` merges built-in/custom/legacy sources, fails loudly on duplicate IDs; updates/deletes rejected for `builtIn` suites with `403 BUILT_IN_SUITE_IMMUTABLE`
- [x] Added `defaultTestSuiteId?` to `EvalPurposeTemplate`, linked on all three built-in templates — starter cases stay a smoke run, the linked suite is the benchmark
- [x] Curated `memory-classification-v1` (64 cases, 48/16 calibration/regression), `memory-tagging-v1` (72 cases, 54/18), `memory-summarization-v1` (36 cases, 27/9) from MemoryApi revision `c7ecb9e292947f88199c16548b88dc4fc8557a60`'s 74 labeled memories plus LMEval-authored coverage/boundary/adversarial cases — checked in at `data/evals/test-suites/built-in/`, generated deterministically by `scripts/generate-memory-benchmarks.ts` from the canonical `data/evals/benchmarks/memory-benchmark-source.v1.json` corpus
- [x] Dataset linter (`scripts/lint-memory-benchmarks.ts` + `server/services/MemoryBenchmarkService.ts`) rejecting duplicate IDs, out-of-taxonomy labels/tags, coverage gaps, malformed slice tags, prompt-example leakage, provenance/hash mismatches, and `approved` status without a complete review ledger
- [ ] **Owed**: human review-ledger approval (`data/evals/benchmarks/memory-benchmark-review.v1.json`) to flip `reviewStatus` to `approved`, and live-model verification of all three suites — tracked in Track E

**A6 — Task-appropriate scoring** — ✅ **complete 2026-09-04** (statistics/CIs remain A7, judge qualification remains A8 — neither was in this pass's scope)
- [x] **Classification**: `exactOutput`/`formatCompliant`/`validLabel` derived per response in `SummaryService.computeClassificationMetrics()`; aggregate accuracy, macro-F1, per-class P/R/F1, invalid-label rate, format-compliance rate, confusion matrix, run-to-run agreement (when `runsPerCell` > 1). Gate: macro-F1 ≥ 0.90, per-class recall ≥ 0.80, zero invalid labels, 100% format compliance
- [x] **Tagging**: raw output parsed by comma-split + trim only, no repair; per-case TP/FP/FN, P/R/F1, Jaccard, exact-set match, unknown-tag rate, duplicate-tag rate, format compliance. Gate: micro-F1 ≥ 0.85, macro label-F1 ≥ 0.70, exact-set ≥ 0.60, zero invalid (unknown) tags
- [x] **Summarization**: deterministic checks (no preamble/heading/fence, compression ratio in range, protected tokens preserved, no literal forbidden claims) run *before* and independent of model grading (`server/services/summarizationChecks.ts`, shared by the per-cell assertion and the aggregate rates so they can't disagree); `summarization-quality.json` revised to Faithfulness 0.40 / Salient Coverage 0.30 / Retrieval Utility 0.20 / Concision 0.10; three independent judge passes at t=0 aggregated by median (implementation choice, since the plan left this open: three metric-suffixed `llm-rubric` assertions per perspective rather than a bespoke repeated-grading harness — see `buildGroundedSummaryRubricAssertions`'s doc comment); a self-judge guard flags (and gates） the result advisory-only when the judge model is also under evaluation. Gate: median weighted ≥ 4.2, median Faithfulness ≥ 4.5, zero cases with a critical unsupported claim (approximated today as a per-case median Faithfulness ≤ 1 — no per-finding judge output exists yet; a real "critical unsupported claim" *finding* extractor is A8/A11 territory)
- [x] Persisted in a discriminated `EvaluationSummary.taskMetrics` union (`ClassificationTaskMetrics` | `TaggingTaskMetrics` | `SummarizationTaskMetrics`) — classification and tagging assertions are `javascript`, never `llm-rubric`, so `compositeScore` is naturally absent for them; no composite is manufactured

**A7 — Statistics that match the data's resolution** — ✅ **complete 2026-09-04**
- [x] Bootstrap 95% confidence intervals over cases (`server/services/StatisticsService.ts`'s `bootstrapCI()`, percentile method, deterministic seeded resampling); McNemar paired test for baseline-vs-candidate (`mcNemarTest()`, wired into `computeClassificationMetrics()` when `baselineCells` is supplied)
- [x] Report the point estimate, the case count behind it, and **one case's worth of movement in pp** alongside every primary metric — `GateResult` now carries `caseCount`; `MetricRegression.onCaseMovementPct` (`100 / totalCases`) is emitted when `SummaryService.computeRegression()` is called with a case count
- [x] Express gates against the interval, not the point estimate; emit `inconclusive` with a needed-case-count rather than a false pass — `caseCountGate()` in `StatisticsService.ts`, wired into all three `compute*Metrics()` gate calculations via a new `GateResult.verdict: 'pass' | 'fail' | 'inconclusive' | 'advisory'` (extending the prior bare `pass: boolean`)
- [x] State regression-slice gates in **cases**, not points — `computeRegression()` accepts an optional `totalCases` and reports `onCaseMovementPct` per metric rather than a bare percentage threshold
- [x] Default classification/tagging runs: production temperature (`t=0.3`), 3 runs per cell — `ExecutionService.run()` now defaults `runsPerCell: 3` / `inference: { temperature: 0.3, maxTokens: 1000 }` when a built-in classification/tagging purpose template left both unset, so run-to-run-agreement and the new CIs are never silently forfeited at the old `runsPerCell: 1` default
- **Scoping note**: macro-F1/micro-F1's own gate CI is approximated via bootstrapping the per-case exact-match (classification) / Jaccard (tagging) arrays rather than re-deriving a macro-F1-specific bootstrap — the two correlate tightly at the case level and a true per-class-then-macro bootstrap wasn't judged worth the added complexity for a point-in-time gate check. Revisit if a live run shows this proxy disagreeing with macro-F1 in practice (Track E).

**A8 — Judge qualification** — ✅ **complete 2026-09-04**
- [x] `JudgeQualification` record: judge model id, calibration-set hash, date, measured statistics (`src/types/eval.ts`; computed by `server/services/JudgeQualificationService.ts`, persisted to `data/evals/judge-qualifications/{judgeModelId}.json`)
- [x] Qualify against ≥20 human-scored summaries: Spearman ≥ 0.6 with human overall, Faithfulness within 1 point on ≥80%, mean inflation within 0.5, self-consistency MAD ≤ 0.5 per dimension — all four thresholds implemented in `JudgeQualificationService.qualify()`, 3 self-consistency passes per case at t=0
- [x] Re-qualify when the judge model or calibration set changes; label a summarization result **advisory, not promotable** when the judge is unqualified — `SummarizationTaskMetrics.gate.verdict` is forced to `'advisory'` whenever `judgeQualified` is `false` or absent (including "qualification never run"), independent of how the scores look; `calibrationSetHash` changing invalidates a stale qualification (checked by comparing hashes, not yet auto-triggering a re-qualify — that's a manual `POST /api/eval/judges/:modelId/qualify` today)
- [x] Derive `grounded-summary` compression bounds from the 10th/90th percentile of v1 reference summaries — **complete 2026-09-05 alongside A5**; `data/evals/benchmarks/memory-benchmark-source.v1.json` records `derivedCompressionRange: [0.35, 0.69]` from the finalized `memory-summarization-v1` reference set, and `data/evals/purpose-templates/summarization.json`'s `assertionStrategy.config.compressionRange` uses it
- **Calibration set**: `data/evals/calibration/summarization-v0.json` is a **temporary, in-repo, 22-case hand-scored fixture** (LMEval-authored, not MemoryApi data), distinct from A5's now-landed `memory-summarization-v1` benchmark suite. `POST /api/eval/judges/:modelId/qualify` (optional `{ calibrationSetId }` body) runs it; `GET /api/eval/judges/:modelId/qualification` reads the persisted record.
- **Not built**: any Prepare-page UI surfacing qualification status (the plan's "reuses the self-judge-guard warning pattern" badge) — route + gating logic only this pass, no frontend surfacing yet.

**A9 — Two-phase model selection** — ✅ **complete 2026-09-05, per [`plans/2026-09-05-a9-a10-model-selection-reporting-plan.md`](plans/2026-09-05-a9-a10-model-selection-reporting-plan.md)** (data/service/export layer only, no UI — see that plan's scope boundary)
- [x] Phase 1: vary prompt, fix incumbent production model, calibration split only — `ModelSelectionService.runPhase1()` runs `comparisonMode: 'prompt'` against `[incumbentModelId]` with `benchmarkMode: 'calibration'`, groups the resulting cells by prompt (reusing `SummaryService`'s newly-exported `computeClassificationMetrics`/`computeTaggingMetrics`/`computeSummarizationMetrics` per prompt group, since per-model `perModelTaskMetrics` alone doesn't cover a prompt sweep), and promotes the gate-passing prompt with the best primary metric — or, per the plan's settled decision, the best-metric prompt regardless when none pass, flagging `advisory: true` downstream
- [x] Phase 2: vary model across the declared candidate slate, fix the promoted prompt, both splits — `runPhase2()` runs `comparisonMode: 'model'` with `benchmarkMode: 'promotion-check'`, which is exactly what makes `SummaryService`'s new `perModelTaskMetrics` (below) populate automatically
- [x] Phase 3: re-run a short phase-1-shaped confirmation on the phase-2 winner; on failure, `runCampaign()` re-confirms the runner-up and records the failure reason on `ModelRecommendation.confirmation`
- [x] Selection rule, in order and recorded with the verdict — `ModelSelectionService.selectModel()`: **gate** (discards any model whose `TaskMetrics.gate.verdict === 'fail'`) → **quality** (`StatisticsService.tieGroupsByOverlappingCI()`, new — chained/transitive CI overlap, not just pairwise, so A-B and B-C overlapping without a direct A-C overlap still merge into one tie group) → **budget** (p95 latency via the new `computeP95LatencyMs()`, re-ranking *within* a tie group only against `LatencyBudgetService`'s configured per-task share — never a silent 0/Infinity default when unconfigured, recorded instead as `ordering.latencyBudgetNote`) → **stability** (run-to-run agreement descending, then avg output tokens ascending)
- [x] Reports the full ordering, tie groups, and discarded-by-gate list on `ModelRecommendation.ordering`
- [x] Reports the best **single** model across all tasks (`ModelSelectionCampaign.bestSingleModel`) — **implementation choice, since the plan left the exact cross-task tie-break rule open**: the candidate scored in every task's phase 2 that minimizes total absolute quality distance from each task's own per-task winner, with `qualityDelta` recorded per task. `vramBudgetExceeded` is deliberately left **always unset** — LMEval has no real VRAM footprint data for a declared candidate (`parameterSize`/`quantization` are free text) and TASK.md itself states LMEval "structurally cannot see" resident-model cost; faking a number here would violate the same never-a-silent-default principle governing the latency budget gate
- [x] `ModelRecommendation` emitted per task to `data/evals/recommendations/{campaignId}-{task}.json` (`FileService.RECOMMENDATIONS_DIR`), independent of the campaign record; the campaign itself persists to `data/evals/model-selection/{campaignId}/campaign.json`
- [x] New types in `src/types/eval.ts`: `ModelCandidateMeta`, `TieGroup`, `ModelSelectionOrdering`, `ModelRecommendation`, `ModelSelectionCampaign`, `EvaluationSummary.perModelTaskMetrics`. **Added beyond the plan's own type**: `ModelSelectionCampaign.judgeModelId?` — the plan's campaign shape had no field for the judge model a summarization phase run needs (`EvaluationConfig.judgeModelId` is required for the built-in summarization purpose template's rubric grading); omitting it would make a summarization campaign task unrunnable
- [x] `server/services/ModelSelectionService.ts` (new): `createCampaign()`/`getCampaign()`/`listCampaigns()`/`runCampaign()`/`runPhase1()`/`runPhase2()`/`runPhase3()`/`selectModel()`/`computeP95LatencyMs()`/`computeBestSingleModel()`/`computeCrossServerFlag()`/`cancel()`/`findRecommendationByEvaluationId()` (the last used by A10's report section, below)
- [x] `server/routes/modelSelection.ts` (new) mounted at `/api/eval/model-selection` in `server/index.ts`: `POST /` (create + fire-and-forget `runCampaign()`, `202`), `GET /`, `GET /:id`, `GET /:id/recommendations`, `POST /:id/cancel`, plus `GET`/`PUT /latency-budgets` (the plan left this route optional/deferrable; built it since campaign creation has nothing else to configure the budget with)
- [x] `server/services/LatencyBudgetService.ts` (new) + `FileService.LATENCY_BUDGETS_PATH` (`data/evals/config/latency-budgets.json`) — externally-supplied per-task share (ms) of MemoryApi's whole-ingestion target, set once and reused, per the plan's settled decision
- [x] `StatisticsService.tieGroupsByOverlappingCI()` (new) + exported `percentile()` — **deviates from the plan's literal algorithm text**: the plan describes joining a candidate via `candidate.ci.lower <= groupMinUpper` alone (comparing only one bound against the group's running minimum upper bound), which a unit test caught merging two CIs that don't overlap at all whenever an earlier, wider interval in the group had a high upper bound. Implemented instead as a proper bidirectional overlap check against the previously-accepted candidate (`candidate.lower <= prev.upper && prev.lower <= candidate.upper`), which still produces the plan's own chained A-B-C example correctly
- [x] `SummaryService`: `computeClassificationMetrics`/`computeTaggingMetrics`/`computeSummarizationMetrics` exported (visibility-only, consumed directly by `ModelSelectionService` for phase 1/3's prompt-keyed grouping); `computeSummary()` gained a `comparisonMode` option and computes `perModelTaskMetrics` when `comparisonMode === 'model'` with more than one model present — additive, the existing whole-run `taskMetrics` is unchanged
- [x] Tests: `StatisticsService.test.ts` (tie grouping — single candidate, direct overlap, disjoint, chained transitive overlap; `percentile`), `LatencyBudgetService.test.ts` (new — get/set round trip, missing-file null), `SummaryService.test.ts` (extended — `perModelTaskMetrics` populated for `comparisonMode: 'model'` with >1 model, absent for single-model and for prompt-comparison runs), `ModelSelectionService.test.ts` (new — campaign validation, `computeP95LatencyMs`, `selectModel`'s full gate/quality/budget/stability pipeline including the all-gates-fail fallback, `computeCrossServerFlag`), `modelSelection.test.ts` (new, `server/routes/` — POST validation, 404s, latency-budgets round trip) — **204 → 266 passing, 35 files, `tsc -b`/`npm run build`/`npm run lint` all clean** (lint's pre-existing 23 errors unchanged, none in a touched file)
- **Not built / owed**: `runPhase1`/`runPhase2`/`runPhase3`/`runCampaign` are only hand-traceable against synthetic fixtures for their pure sub-steps (`selectModel`, `computeP95LatencyMs`, cross-task aggregation) — they were **not** exercised end-to-end against a real `ExecutionService.run()` + LMApi/Ollama round trip, consistent with this repo's standing convention of not claiming live-model behavior from unit tests. Tracked as a new Track E entry below

**A10 — Task-specific reporting** — ✅ **complete 2026-09-05, same plan as A9** (formatting only — no new computation; all data already existed on `EvaluationSummary`/`ModelRecommendation` after A9 landed)
- [x] Confusion/per-class panels (classification), micro/macro + per-tag panels (tagging), rubric dimensions + deterministic-check rates + judge/self-judge status (summarization) — `ReportService`'s new `renderTaskMetrics()`, plus the shared gate rendering (verdict/caseCount/neededCases/failures) for all three. **Not built**: a per-finding "unsupported-claim" list — no per-finding judge output exists yet (still A11/future territory per A6/A8's own scoping notes); `criticalUnsupportedClaimRate` (the existing coarse proxy) is rendered instead
- [x] Slice tables — `renderSliceTables()` groups the run's test cases (from the already-written `testcases.json`) by their `caseTags` family prefix (e.g. `split`, `shape`, `category`) and reports each value's case count and average pass rate, joined against the existing `testCaseSummaries` — no new data collection
- [x] Per-model breakdown table (`renderTaskMetrics()` reused once per model) when `EvaluationSummary.perModelTaskMetrics` is present
- [x] Model-selection section, gated on `comparisonMode === 'model'` — looks up the `ModelRecommendation` for the evaluation via `ModelSelectionService.findRecommendationByEvaluationId()`, renders gate pass/fail (discarded-by-gate list), primary metric with CI, tie groups, p95 latency + stability by model, and the resulting recommendation (including the advisory flag and any latency-budget note)
- [x] Provenance/judge-qualification block extending the existing inference/transport header with `benchmarkProvenance` and, for a summarization run with a `judgeModelId`, `JudgeQualificationService.get()`'s qualified/not-qualified/no-record status
- [x] Baseline comparison (`GET /api/eval/evaluations/:id/regression`) response extended with a `provenanceDiff` (current vs. baseline `resolvedInference`/`transportProvenance`/`benchmarkProvenance`) — pure pass-through, both sides already carried these fields
- [x] Tests: `ReportService.test.ts` (new) — per-task-type rendering, per-model breakdown presence/absence, slice-table grouping, provenance/judge block presence/absence, model-selection section rendering and its omission for a non-`'model'` comparisonMode or no matching recommendation
- **Not built**: any Track B UI surfacing (Results/Breakdown tab panels, SummaryPage) — out of scope per the plan's explicit boundary; only the Markdown export and the `/regression` JSON payload were extended this pass

---

### Track B — Wizard completion

> **Before picking up B1–B6, read
> [`plans/2026-09-05-a9-a10-ux-and-track-b-lessons-plan.md`](plans/2026-09-05-a9-a10-ux-and-track-b-lessons-plan.md).**
> It argues that A9/A10 shipping with zero UI (by deliberate scope boundary, above) leaves LMEval's two
> newest measurement features reachable only via `curl`, and recommends building that UI — a new
> `/campaigns` section, a judge-qualification status badge, and a small `/settings` page — **before**
> Track B's wizard-polish items, since Track B is incremental UX on an already-usable flow while A9/A10
> currently have no flow at all. It also extracts reusable precedent (the `BreakdownView` scatter chart,
> `VerdictHeader`'s gate-first framing, `DashboardPage`'s polling loop) that Track B's own items should
> check against before building anything new.
>
> **B1–B3 implemented 2026-09-05**, per
> [`plans/2026-09-05-b1-b3-track-b-implementation-plan.md`](plans/2026-09-05-b1-b3-track-b-implementation-plan.md).
> `tsc -b`, `npm run build`, `npm run lint` (23 pre-existing errors, unchanged, none in a touched file),
> and `npx vitest run` (278 passing, 37 files, up from 266/35 — 12 new tests) all clean. **Verification
> split, stated plainly**: the backend was live-verified against a real running server and real
> filesystem state (see the Track E entry below) — LMApi itself was unreachable in that environment, so
> only paths that don't require a live model response were exercised end-to-end; no live model call
> completed. The frontend (B1's drag-reorder and suite-import button, B2's failure drawer and skeleton,
> B3's Summary page) is `tsc`/lint-clean and follows existing component patterns but was **not**
> exercised in a browser — owed, tracked in Track E.

**B1 — Prepare page (Phase 7 remainder)** — ✅ **complete 2026-09-05, browser walkthrough owed**
- [x] Drag-to-reorder for inline test case rows — native HTML5 drag events (no new dependency), `TestCaseEditor.tsx`
- [x] "Import from test suite" shortcut in the inline table (copies a suite's cases in as editable inline rows), distinct from the existing suite-*linking* "Use benchmark suite" affordance — reuses `listTestSuites()` + `serializeJSON()`/`processText()`, live-confirmed `GET /test-suites` returns full `testCases[]` so no extra fetch is needed

**B2 — Results page (Phase 7 remainder)** — ✅ **complete 2026-09-05, browser walkthrough owed**
- [x] Failure detail panel (`FailureDrawer.tsx`, wrapping `DetailView.tsx` in a modal shell) opens from a failed heatmap cell with error message + type, retry history, full raw response, deterministic check breakdown, and a **↻ Retry this cell** button
- [x] **Fixed, not just wired**: `POST /:id/retry`'s `failedCellsOnly` was accepted but never implemented (always re-ran the whole evaluation) — `ExecutionService.run()` now accepts an optional `cellFilter` (exported pure helpers `narrowForCellFilter()`/`filterCellsByAllowList()`, unit-tested) that narrows prompts/models/test-cases to exactly the requested triples before promptfoo builds its matrix. The route derives the filter from either `cellIds` (single-cell retry) or `failedCellsOnly` (bulk), reading `results.json` (the post-execution status) rather than `cells.json` (the pre-execution pending snapshot) — **this file choice was itself a bug caught by live curl testing**, not review: reading `cells.json` made every `failedCellsOnly` retry report "No failed cells to retry" since that file's cells never leave `status: 'pending'`
- [x] `JudgeResult.rawResponse` (already existed, `src/types/eval.ts:193`) is now displayed in the drawer, collapsed by default
- [x] Eval run selector when a session has multiple runs — a tab bar of run number + completion status, `GET /sessions/:id/runs`
- [x] Skeleton loader (`ResultsSkeleton.tsx`) replacing the bare "Loading results…" text
- **Not built**: cross-eval retry history (attempt N against a *previous* retry's separate eval id) — `Cell.retryAttempts` displayed in the drawer is the existing per-run provider-level retry bookkeeping, not a new ledger across manual retries; scoped out as bigger than what B2 asked for

**B3 — Step 5: Summary & AI suggestions (Phase 9)** — ✅ **complete 2026-09-05, browser walkthrough owed**
- [x] `SummaryPage.tsx` replacing the placeholder — `SummaryOverview` (reuses `VerdictHeader`'s gate-first headline logic, extracted to `src/lib/verdict.ts` so both surfaces share one implementation instead of two), `GateMetricsPanel` (new: the Summary page's first home for `EvaluationSummary.taskMetrics`/`perModelTaskMetrics`, mirroring `ReportService.renderTaskMetrics()`'s data), `PerModelAnalysis` (embeds `BreakdownView` wholesale rather than a second chart set), `ImprovementSuggestions`
- [x] `POST /api/eval/evaluations/:id/summary-analysis` (`SummaryAnalysisService.ts`) — accepts `{ refinementModel? }`, builds the analysis prompt from the eval's model/prompt rankings and current prompt content, dispatches via `LmapiClient`, parses into typed sections via a 4-step fallback chain matching `JudgeService`'s convention (unit-tested: direct JSON, fenced, regex-extracted, malformed-suggestion-dropped, unknown-prompt-id), caches to `data/evals/evaluations/{id}/analysis.json`; `GET` reads the cache, `404` before one exists
- [x] "Apply Suggestion" → new prompt version (`PromptService.addVersion()`) + session version (`SessionService.createVersion()`) when the eval has a two-prompt session; "Apply & Re-run" → same, then `POST /evaluations` with the updated prompt
- [x] "View Summary & Suggestions →" on `ResultsPage.tsx` already pointed at `/eval/summary/:evalId` — wiring was already correct, the stub page was the only gap
- [x] Graceful degradation: `GET /api/eval/health` now reports `refinementModelConfigured` (`config.refinementModel`, shared with Track C1 — `REFINEMENT_MODEL` added to `.example.env`); `ImprovementSuggestions` shows a note instead of a Generate button when unset. Live-confirmed both states (unset → `false` + `400` on POST; set → `true` + request reaches `LmapiClient` and fails only on LMApi being unreachable, not on model resolution)

**B4 — Git integration frontend (Phase 2.5 remainder)** — **on hold, pending a dedicated re-scoping session**
> The git-backed commit/revert flow below is still what's implemented today (`GitService.ts` — `init`/
> `commit`/`log`/`revert`/`status` over `DATA_ROOT`, which already holds prompt/session/eval-output
> version history and is already separate from the read-only `REPO_ROOT` seed content). Before building
> the frontend buttons, revisit whether git is the right versioning mechanism at all versus an
> app-native version store with a purpose-built diff view — see the forward-note in
> [`plans/2026-09-05-b1-b3-track-b-implementation-plan.md`](plans/2026-09-05-b1-b3-track-b-implementation-plan.md#b4--forward-note-only-not-designed-in-this-plan)
> for what's already confirmed about the current architecture, so that session starts from facts.
- [ ] "Commit Improvement" button (visible after a positive `scoreDelta`) pre-filling `feat(prompt): improve {session.name} (+{delta} score)`
- [ ] "Revert to Previous" button with confirmation dialog
- [ ] Verification: init → commit → log → revert round trip

**B5 — Full Matrix N-prompt-slot UI (Phase 11 remainder)**
- [ ] Full Matrix currently behaves like Prompt Comparison's 2 slots. Lowest priority per the source plan

**B6 — Step icons (Wizard Task 1 remainder)**
- [ ] Optional step icons in the breadcrumb: pencil / sliders / play / bar chart / sparkle

---

### Track C — Automated refinement loop (Phase 8)

> ⚠️ **Constraint, enforced in code and not merely in prose:** the loop may read and optimize against
> the **calibration split only**. Exposing the regression split to an automated optimizer converts the
> promotion gate into a training objective and destroys the only unbiased estimate in the system.
> Its output is a candidate for human review — never a cross-repository write into MemoryApi.

**C1 — Environment**
- [ ] `REFINEMENT_MODEL` in `.example.env`; suggestions endpoint returns 400 when unset
- [ ] Expose it in `GET /api/eval/health` so the frontend can gate the button

**C2 — Human-in-the-loop (8a)**
- [ ] `ImprovementSuggestion` / `RefinementLoopConfig` types in `src/types/session.ts`
- [ ] `RefinementService.ts`: `buildImprovementPrompt()`, `parseSuggestions()` (4-step fallback, same pattern as `JudgeService`), `applySuggestion()`
- [ ] Routes: `POST /sessions/:id/suggest-improvements`, `POST /sessions/:id/apply-suggestion`, `GET /sessions/:id/suggestions`
- [ ] Frontend suggestion cards with rationale, estimated impact, Show diff / Apply / Reject

**C3 — Automated loop (8b, deferred)**
- [ ] `POST /sessions/:id/refine-loop` with stop conditions (target delta, max iterations, 3 consecutive no-improvement, no parseable suggestions, user cancel); `refine:*` WebSocket events; cancel endpoint
- [ ] Auto-commit successful iterations / auto-revert regressions **within LMEval's own data directory only**
- [ ] Loop progress UI: iteration counter, current action, live score trajectory, Cancel

**C4 — Eval definition improvement (8c, lowest priority)**
- [ ] `buildEvalImprovementPrompt()` / `parseEvalSuggestions()` — propose new test cases, adjusted weights, refined criteria

---

### Track D — Engine follow-ups

- [ ] **Pairwise / `select-best` decision (Phase 10)** — `select-best` throws `Invalid provider definition` from both a function-valued `ApiProvider` and a plain `{ id, config }` reference on promptfoo 0.122.2 via the programmatic Node API; looks like a genuine bug in that version's `getAndCheckProvider` path. `config.enablePairwise` is currently a **no-op**. Choose: try another promptfoo version, or reintroduce a bespoke pairwise judge call outside the assertion system. Blocks re-enabling the UI toggle with working behavior
- [ ] **Live engine verification** — re-run `scripts/test-execution.ts` end-to-end against a real LMApi + model. Phase 10 was verified with `npm run build` / `vitest` / a fake-provider smoke test only; a real model round trip is still owed
- [ ] **AI-generated test cases (F5)** — `buildTestCaseGeneratorPrompt()` + `parseTestCaseGeneratorResponse()` in `JudgeService`, `POST /api/eval/test-cases/generate`, and a ✨ Generate button in the Suite toolbar feeding the existing replace/append confirm flow. **Dogfood gate: the generation prompt must itself be validated using LMEval before the feature ships**

---

### Track E — Verification debt

The following live checks and walkthroughs were deferred because no live server/model/browser was
available in the implementing pass. None are code changes; all are owed before their covered runtime
behavior can be called verified.

- [ ] **A1 seed runtime verification** — send repeated identical evaluations with the same explicit seed through a real LMApi + Ollama model and confirm reproducible output on the same model and Modelfile configuration; this verifies the closed handoff without reopening its implementation
- [ ] **A2 cross-project transport parity** — against MemoryApi revision `c7ecb9e292947f88199c16548b88dc4fc8557a60`, run a real LMApi evaluation containing `</MEMORY   >`; confirm endpoint, ordered messages, exact wrapper/escaping, task temperature/token ceiling, prompt identity/taxonomy hash, routable model, response content, and `finish_reason`, then reproduce the headline result with MemoryApi's evaluator under `MEMORY_DATA_ENV=test`
- [ ] **Phase 11** — Model Comparison renders one editor and blocks Next below 2 models; Prompt Comparison renders both and allows 1 model with a visible nudge
- [ ] **Phase 12** — Session Hub → New Evaluation → gallery shows 3 built-ins + Start Blank → selecting Classification lands on Step 1 pre-filled with the provenance badge, and Step 2's assertion card and test cases populated → Start Blank behaves like today's wizard
- [ ] **Phase 7 (this pass)** — blockers panel, Run tooltip, `Saving prompts…` label, judge-call count, error-boundary fallback, and Compare copy/stats confirmed in a running browser
- [ ] **A3/A6 task-appropriate scoring (this pass, 2026-09-04)** — a real LMApi + Ollama round trip
  for all three built-in purpose templates, confirming: `exact-label` actually rejects a real model's
  explanatory prose (not just the hand-written unit-test strings); tagging's parse-without-repair
  path against real (possibly malformed) model output; the 3-pass `llm-rubric` judge calls actually
  fire 3 times per perspective per case with `temperature: 0`, and `SummaryService`'s median
  aggregation reads the resulting `assertionResults` correctly; the self-judge guard fires when
  `judgeModelId` really does overlap `modelIds`. The `npx vitest run` baseline referenced here is now
  clean (see §3, second pass) — this item is otherwise still owed as live-model verification.
- [ ] **A4/A5 (2026-09-05)** — human review-ledger approval of `data/evals/benchmarks/memory-benchmark-review.v1.json` (flips `reviewStatus` to `approved` on all three built-in suites, gated by the linter's "approved without complete ledger" rejection); a browser walkthrough of purpose template → starter cases → "Use benchmark suite" → linked suite selected; and at least one live LMApi model run against each of `memory-classification-v1`/`memory-tagging-v1`/`memory-summarization-v1` confirming the production `<memory>` wrapper, escaping, and split tagging behave as scored. None of dataset linting, unit tests, or this audit's static review count as this verification.
- [ ] **A7/A8 (2026-09-04, second pass)** — a real LMApi + Ollama round trip confirming: bootstrap CIs
  and the McNemar test produce sane numbers against real (not synthetic) per-case data; the
  classification/tagging `runsPerCell: 3` / `t=0.3` default actually fires for a built-in template run
  and doesn't regress latency past what the Prepare page's execution preview implies; a real judge
  model run through `JudgeQualificationService.qualify()` against the temporary calibration fixture
  produces plausible Spearman/inflation/MAD numbers (not just structurally-valid JSON parsing); an
  unqualified judge's summarization result actually renders as `advisory` in `VerdictHeader`, not just
  in the underlying `gate.verdict` data. Also owed: revisiting the macro-F1/micro-F1 CI proxy (per A7's
  scoping note) once real confusion-matrix data is available to check the proxy's fidelity.
- [ ] **A9/A10 (2026-09-05)** — a real LMApi + Ollama round trip, since `ModelSelectionService`'s
  `runPhase1`/`runPhase2`/`runPhase3`/`runCampaign` were only hand-traced and unit-tested against
  synthetic fixtures for their pure sub-steps (`selectModel`'s gate/quality/budget/stability pipeline,
  `computeP95LatencyMs`, cross-task aggregation), never exercised against a live `ExecutionService.run()`.
  Confirm: running a full 3-phase campaign per task over a real declared candidate slate produces a
  sane `ModelRecommendation` (tie groups, discarded-by-gate list, single-model alternative) exported to
  `data/evals/recommendations/`; `perModelTaskMetrics` reflects real per-model confusion
  matrices/gates, not just structurally-valid JSON; a phase-1 gate miss really does promote the
  best-metric prompt with `advisory: true` rather than throwing; a phase-3 confirmation failure really
  does fall back to the runner-up; and the Markdown report's new Task Metrics / Per-Model Breakdown /
  Slice Breakdown / Model Selection sections render correctly against a real evaluation with a
  configured latency budget and a qualified judge. None of unit tests or static review count as this
  verification, per this repo's standing convention (TASK.md §6).
- [x] / [ ] **B1/B2/B3 (2026-09-05) — partially verified, split stated precisely**:
  - **Live-verified against a real running server + real filesystem state** (LMApi unreachable in the
    implementing environment, so no path requiring an actual model response could complete):
    `POST /:id/retry` with `cellIds` on a single failed cell produces a new evaluation whose matrix
    contains *exactly* that one (promptId, modelId, testCaseId) triple, not the original's full set;
    the same with `failedCellsOnly: true` against two failed cells produces exactly two, matching the
    originals; an invalid `cellIds` value returns `400`, an unknown evaluation id returns `404`;
    `GET /test-suites` returns full `testCases[]` (confirms B1's suite-import button needs no extra
    fetch); `GET /summary-analysis` returns `404` before generation; `POST /summary-analysis` returns
    `400` with a clear message when `REFINEMENT_MODEL` is unset, and — once set — proceeds far enough
    to reach `LmapiClient` and fail only on the network call, not on model resolution; `GET /health`'s
    `refinementModelConfigured` flips correctly with the env var in both directions. **This live pass
    caught two real bugs no amount of review or unit testing had**: the retry route originally read
    `cells.json` (the pre-execution 'pending' snapshot) instead of `results.json` (the actual
    post-execution status), which made every `failedCellsOnly` retry report "No failed cells to retry"
    even with real failed cells on disk; and exporting `VerdictHeader`'s verdict-string builders
    directly triggered a `react-refresh/only-export-components` lint error, fixed by extracting them to
    `src/lib/verdict.ts`. Both are fixed in the current tree, not just noted here.
  - **Not verified — owed**: a real LMApi + Ollama round trip completing an actual retry or
    summary-analysis call (only structural/validation behavior was reachable without one); a browser
    walkthrough of every new frontend surface — B1's drag-to-reorder and suite-import button, B2's
    failure drawer (including the collapsible raw-judge-response toggle and the loading skeleton), B3's
    full Summary page (gate panels, per-model `BreakdownView` embed, suggestion cards, Apply / Apply &
    Re-run round trip). None of `tsc`/lint/vitest passing, nor the curl-level checks above, stand in for
    either.

---

### Track G — Agent-drivable evaluation workflow *(active)*

> Plan and rationale: [`plans/2026-09-06-agent-api-parity-gap-analysis.md`](plans/2026-09-06-agent-api-parity-gap-analysis.md)

- [x] **G1 — Shared contract and validation**: caller-only `EvaluationInput`, stable validation issue/result types, reference/cardinality/test-source/inference/repetition/benchmark/judge checks, pairwise no-op rejection, canonical grouped-model client route, and preserved legacy create-and-start behavior.
- [x] **G2 — Reproducible prompt and inference persistence**: new evaluations pin ordered prompt versions at creation, execution reads those pins, draft/create routes persist `inference`, retries preserve the full config, and unused live `baselineId` was removed from the current type while historical JSON remains readable.
- [x] **G3 — Draft lifecycle**: persisted `draft` status, validate/create/patch/start endpoints, one-way start transition, post-start immutability, and session-run linkage at actual start.
- [x] **G4 — Browser configuration handoff**: `/eval/config/:evalId` loads server state, pinned prompt content, validation, call estimate, editable draft JSON/content, new prompt versions on content edits, read-only started state, and safe read-only handling for API matrices with more than two prompts.
- [x] **G5 — Feedback and progress**: `progress.json` survives missed WebSocket events; feedback combines lifecycle, progress, validation, failures, readiness, CI-aware verdict, and standalone/HomeBase-relative browser paths.
- [x] **G6 — Published contract and clients**: checked-in/served OpenAPI 3.1 document, corrected README workflow/route table, frontend API client and existing typed `LMEvalClient` extended, and executable `test:agent-workflow` smoke harness added.
- [ ] **G7 — Full automated gate**: full unit suite, lint, standalone build, hosted frontend build, host adapter build, API integration, and relevant Playwright draft-handoff coverage all pass. Record pre-existing lint failures separately.
- [ ] **G8 — Live three-task evidence**: with LMEval + LMApi running, execute bounded production-shaped classification, tagging, and summarization smokes through the agent SDK; record IDs, pinned prompts, models/judge, call counts, paths, failures, verdicts, and advisory reasons. This can close older Track D/E live-engine items only where their original criteria were actually exercised.
- [ ] **G9 — Gated workflow skill**: only after G7/G8, create and validate `.agents/skills/lmeval-evaluation-workflow/`; keep discovery/draft-first/one-axis/ground-truth/production-shape rules concise and require explicit authority for delete, git, promotion, or external writes.

### Track F — Future use cases *(captured, not scheduled)*

> Surfaced during the 2026-09-04 brainstorm behind
> [`plans/2026-09-04-2053-feat-core-task-measurement-excellence-plan.md`](plans/2026-09-04-2053-feat-core-task-measurement-excellence-plan.md).
> Deliberately **not** designed or scoped yet — each needs its own brainstorm before planning. Listed
> here so they aren't lost, not as a commitment to build them next. LMEval's first real use case is
> MemoryApi, but the tool exists to evaluate *any* local-model use case; these are where that shows up.

- [ ] **Generalized custom task-type support** — today, adding a task type beyond classification/tagging/
  summarization means teaching `PromptfooAdapter`/`ExecutionService`/`SummaryService` a new name (see
  A3/A6). A real fourth use case should motivate designing `assertionStrategy: 'custom'` and a generic
  metric/gate spec as an actual plugin boundary — declarative assertions (Promptfoo's native types)
  plus a named metric rollup, so a new task type needs no core-service code changes. Deliberately
  deferred until a concrete new use case exists to design against, rather than guessing the right
  abstraction now.
- [ ] **Deeper tool-calling effectiveness evaluation** — a Tool Calling `EvalTemplate` already ships;
  strengthening its assertions/metrics (beyond today's basic tool-call matching) for evaluating agentic
  tool-use quality is future work once a concrete tool-calling use case needs it.
- [ ] **Evaluating MemoryApi's multi-source retrieval merge/fusion step** — MemoryApi assembles context
  from multiple separate databases into one LLM/MCP-consumable response for downstream decision-making;
  evaluating the quality of that merge/fusion is a materially different, more complex evaluation shape
  than single-call classification/tagging/summarization and needs its own design.
- [x] **Agent-drivable API moved to active Track G** — the draft lifecycle, feedback surface, OpenAPI
  contract, clients, live proof, and gated skill are tracked there. Automated refinement remains the
  separate future item below.
- [ ] **Automated refinement-loop harness** — a further-out extension of the above: an agent loop that
  iterates on prompt (and eventually eval) refinements automatically. Candidate approach floated: an
  agent SDK, possibly as a separate project outside this repo. Explicitly longer-term; not the same
  scope as Track C's in-app human-in-the-loop suggestion UI (C1–C2), which stays LMEval-internal.

---

## 5 — Suggested improvements

Analysis, not committed scope. Ordered by value per hour. The first four come out of the
cross-project review's open "further suggestions"; the rest are LMEval-side observations.

### 5.1 — Run the model sweep *before* the prompt work

The cheapest experiment available is the current production prompt across the candidate model slate,
unchanged. If a model change alone clears the gate for a task, prompt refinement for that task
becomes optional; if it does not, the sweep still tells you the ceiling you are writing against.
This inverts Track A's phase order for one throwaway run and is plausibly the highest-value hour in
the entire plan. **Recommendation: do it, as an explicit one-off, once A1 lands.**

### 5.2 — Derive prompt tie-breakers from a measured confusion matrix

Both plans name the same category boundaries a priori (Event/History, Note/Snippet, Prompt/Idea,
Reminder/Note). Those are plausible guesses about where a model gets confused, not observations. Run
the baseline, read the confusion matrix, then write tie-breakers for the confusions that actually
occur. Prompt text spent on a boundary the model already handles is context budget spent on nothing.
**This makes A6's confusion matrix a prompt-authoring tool, not just a report panel.**

### 5.3 — Report tagging recall by group; keep per-tag as drill-down

61 tags at ≥2 positive cases each means per-tag recall takes exactly three values: 0, 0.5, or 1. That
is a useful pointer to a broken tag and a useless promotion statistic. MemoryApi's `allTags.json`
already carries four described groups (~15 tags each) — group-level recall has real resolution and
maps to how the vocabulary is actually organized.

### 5.4 — A contract-violations strip, above the quality panel

For all three tasks the dominant failure mode is **format, not semantics**: a label with a trailing
period, a tag list wrapped in brackets, a summary opening with "Here is a summary of". These are
binary, they are fixable by one sentence of prompt wording, and averaging them into a quality score
hides both facts. A model at 0.91 macro-F1 with a 12% wrapper-text rate is one edit from winning, and
a blended score will never say so. **Surface invalid label / unknown tag / duplicate / wrapper text /
truncation as its own strip on the Results page.** This is the single highest-leverage Results-page
addition on this list, and it generalizes past MemoryApi to any structured-output prompt.

### 5.5 — Plot quality against latency; retire the leaderboard for gated tasks

A ranked list implies a total order that overlapping confidence intervals do not support. A scatter
of primary metric vs. p95 latency, tie groups shaded, gate drawn as a floor line, shows the actual
decision: which models are admissible, which are indistinguishable, and which of those is cheapest.
The Breakdown tab's score-vs-latency scatter is the right foundation; A11's model-selection view
should extend it rather than adding a second ranked table.

### 5.6 — Harvest labeled data from MemoryApi's review UI

MemoryApi's status lifecycle is `draft → stored | rejected`, and its review UI is where a human
corrects an auto-assigned category or tag set. **Every one of those corrections is a labeled
model-vs-human disagreement, produced for free during normal use, drawn from the real input
distribution rather than from someone imagining hard cases.** Capture the before/after pair at review
time and route it into the candidate dataset for sanitization and annotation. This is the cheapest
path to a benchmark that keeps growing without anyone writing test cases by hand — and it is the one
suggestion here that requires a MemoryApi change to unlock.

### 5.7 — Measure whether classification and tagging should be one call

Ingestion makes three model calls per memory. Classification and tagging read the same content and
draw on overlapping judgments; a single structured response could return both — potentially a third
of ingestion latency and one less model swap. The cost is coupling: one malformed response loses both
fields, and the two tasks stop being independently promotable, which is exactly what this evaluation
architecture is built to support. **Worth a measured comparison as a deliberate follow-on; not worth
assuming in either direction now.**

### 5.8 — Make the wizard state the experiment design, not just the settings

Track A's two-phase protocol is a *procedure* the user currently has to remember and execute by hand
across three separate wizard runs. The mode strip already knows whether this is a prompt experiment
or a model experiment. The natural next step is a **campaign** object: phase 1 (prompt sweep) →
promote → phase 2 (model sweep) → phase 3 (confirmation), with the wizard pre-filling the fixed
variable from the prior phase's winner and refusing to vary both at once. That turns the discipline
the plan describes into the path of least resistance rather than a document someone has to follow.

### 5.9 — Surface the gate, not just the score

Every built-in purpose template in Track A has an absolute quality gate attached
(macro-F1 ≥ 0.90, micro-F1 ≥ 0.85, median weighted ≥ 4.2). Once those exist, the verdict header
should read **pass / fail against the gate first** and the ranking second — "granite4.1:8b is the
only candidate that clears the classification gate" is a decision; "granite4.1:8b scored 4.2/5" is a
number. Wire `EvaluationSummary.taskMetrics` into `VerdictHeader` as soon as A6 lands.

### 5.10 — Smaller UI wins, cheap and independent

- **Estimated wall-clock, not just call count.** The Execution Preview now counts calls honestly. A
  rolling average of observed per-call latency per model turns that into "≈4 min" — the number a user
  actually needs before committing to a 200-cell matrix.
- ~~**Purpose template → benchmark suite affordance.**~~ Done — A5 landed `defaultTestSuiteId` and
  the Prepare page's "Use benchmark suite" / "Use starter cases" toggle with version/review-status
  badge (`TestCaseEditor.tsx`).
- **Judge-model self-grading guard.** A6 forbids a model judging itself. The Prepare page can enforce
  this at selection time with an inline warning rather than discovering it at scoring time.
- **Make the Summary step's absence legible.** Step 5 ships a "Coming Soon" placeholder inside a
  numbered wizard, which reads as a broken step. Until B3 lands, either gray the step out in the
  indicator or have Step 4's CTA say what Step 5 will do once configured.

---

## 6 — Design constraints (carried forward)

- **No new colors.** Use existing CSS variables from `src/index.css` (dark / cyan / green).
- **No automatic synchronization into MemoryApi.** Recommendations and promotion records are advisory
  exports a human reviews and copies.
- **No reading from or writing to production MemoryApi stores.**
- **No optimizing against the regression split**, by hand or by the refinement loop.
- **LMEval does not measure end-to-end ingestion latency or model residency cost.** It times single
  calls against a warm pool. MemoryApi owns the pipeline measurement, and a recommendation is not
  actionable until MemoryApi has made it.
- Report model-backed verification separately from automated checks; never claim it from unit tests.
