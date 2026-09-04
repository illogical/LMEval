# LMEval — Unified Task List

> **Supersedes** [`prompt-eval-system/TASK.md`](prompt-eval-system/TASK.md) (backend/engine track) and
> [`features/eval-wizard/TASK.md`](features/eval-wizard/TASK.md) (wizard/UX track). Both remain in the
> repository as historical records of completed work; **all open work lives here.**
>
> **Last reconciled against the working tree:** 2026-09-04

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

MemoryApi is LMEval's first real consumer and its source of ground truth. It runs three ingestion
tasks per memory — classification (8 categories), tagging (61 tags), summarization — today all on
one shared `LLM_MODEL`. LMEval's three built-in purpose templates were seeded directly from
MemoryApi's `src/prompts/` and `src/samples/`.

The direction of the relationship is deliberately asymmetric, and neither project calls the other
at runtime or writes into the other's repository:

| Direction | Artifact | Content |
|---|---|---|
| MemoryApi → LMEval | `memory-eval-snapshot.v1` | Taxonomy, adjudicated benchmark datasets with grounding annotations, production prompt text + version, declared inference parameters and transport, provenance hashes |
| LMEval → MemoryApi | `prompt-promotion-record.v1` | Evaluated prompt + model, resolved inference parameters, task metrics with confidence intervals, slice breakdowns, gate verdicts, judge qualification, `ModelRecommendation` set, consumed snapshot hashes |

**MemoryApi owns truth and receives advice. LMEval owns measurement and receives data.** Both
artifacts move by human review and commit.

Full detail: [`plans/2026-09-03-professional-memory-evaluations.md`](plans/2026-09-03-professional-memory-evaluations.md)
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
| 7 | Prepare & Results refinement | ⚠️ mostly complete — see Track B |
| 8 | Automated refinement loop | ⛔ not started |
| 9 | Wizard Step 5: AI summary | ⛔ not started (placeholder page ships) |
| 10 | Promptfoo engine migration | ⚠️ complete except pairwise + live verification |
| 11 | Evaluation mode strip | ✅ complete except Full-Matrix N-slot UI |
| 12 | Purpose templates + gallery | ✅ complete, browser walkthrough unverified |
| F5 | AI-generated test cases | ⛔ deferred (dogfood candidate) |
| W1–W8 | Prepare wizard layout polish | ✅ complete |
| I1–I4 | Test case import/export | ✅ complete (verified in tree 2026-09-04) |
| PME | Professional memory evaluations | ⛔ planned — Track A, the critical path |

---

## 3 — Completed in this pass (2026-09-04)

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
> **Nothing else in this list produces a trustworthy number until A1 and A2 land.** LMEval currently
> measures a configuration that MemoryApi does not run.

**A1 — Inference parameters and provenance** *(first, because every later measurement is untrustworthy without it)*
- [ ] Add `inference?: { temperature: number; maxTokens: number; seed?: number }` to `EvaluationConfig`
- [ ] Thread it through `PromptfooAdapter.buildLmapiProvider()` into the LMApi request body — today it posts only `model`, `messages`, `stream`, `groupId`, so every cell runs at the provider default temperature
- [ ] Resolution order: per-run config → purpose template defaults → LMApi default; persist the resolved values on every result
- [ ] Built-in purpose templates default to `temperature 0.3` for all three tasks (classification, tagging, summarization) — matches MemoryApi's actual production temperature, read from `memoryTextProcessor.ts` (an earlier pass of this plan assumed `t=0`/`t=0`/`t=0.1`, which was wrong; only the unrelated `extractEntities` call uses `0.1`)
- [ ] Built-in purpose templates default `maxTokens` to **1000** for all three tasks — deliberately *not* mirrored from MemoryApi's tight production ceilings (50 / 100 / 150), since LMEval is a general tool and a thin default ceiling turns an ordinary long response into a silent truncation that reads as a quality failure. A strict MemoryApi production-parity run overrides `maxTokens` per-run to match production exactly; the generous default is for LMEval's own tuning and model-selection runs, and for any other prompt/task run through LMEval
- [ ] Mark results that ran without explicit parameters `inferenceParametersUnspecified` — unusable as a baseline or promotion input
- [ ] Record `finishReason` per cell and report a **truncation rate** — a summarization model that scores well only because it was cut off at 150 tokens has not passed *(the per-cell display half of this shipped in §3; the aggregate rate has not)*
- [ ] Record the LMApi endpoint path and message shape in each evaluation's provenance; refuse to treat a run as a promotion input when a snapshot declares a transport LMEval did not use

**A2 — Transport parity with MemoryApi**
- [ ] LMEval posts `messages: [system, user]` to `/api/chat/completions/any`; MemoryApi's `LMApiClient` flattens messages into one `ROLE: content` string and posts it as `prompt` to `/api/generate/any`. The plan assumes MemoryApi moves to structured chat messages. **Coordinate before benchmarking** — a prompt that wins in LMEval is otherwise not the prompt MemoryApi executes
- [ ] Imported snapshot cases must carry the `<memory>` delimiter wrapper inside `userMessage` exactly as production sends it, including the escaping rule for a literal closing delimiter

**A3 — Typed assertion strategies**
- [ ] Replace `AssertionStrategy.config: Record<string, unknown>` with the discriminated union: `exact-label` | `label-overlap` | `grounded-summary` | `custom`; validate at the service boundary, `400` on invalid custom templates
- [ ] Legacy key normalization in both directions: `categories`→`labels`, `tagVocabulary`→`vocabulary`, `threshold`→`minimumCaseF1`, `llm-rubric`+`dimensions`→`grounded-summary`+`templateId`. Read accepts either, write emits normalized
- [ ] Rewrite the three files under `data/evals/purpose-templates/` in the same change
- [ ] **Wire `exact-label`** — it is declared as a purpose strategy but `PromptfooAdapter` builds no assertion for it, and `TestCase.expectedOutput` is ignored entirely. Classification is currently graded by `expectedKeywords`, which accepts explanatory prose containing the label

**A4 — Test case grounding fields**
- [ ] Extend `TestCase` with `expectedLabels?`, `caseTags?`, `requiredFacts?`, `forbiddenClaims?`, `protectedTokens?`
- [ ] Keep `tags` as a deprecated import alias for `expectedLabels`; warn when both are present and differ
- [ ] Update JSON/CSV parse + serialize (semicolon-delimited arrays), the suite editor, and API types together

**A5 — Built-in benchmark suites**
- [ ] Extend `TestSuite` with `builtIn`, `purposeCategory`, `version`, `provenance{source, sourceRevision, taxonomySha256, datasetSha256, importedAt}`
- [ ] Version-controlled built-ins at `<repoRoot>/data/evals/test-suites/built-in/`; writable suites at `<dataRoot>/evals/test-suites/custom/`; legacy suites read as custom, never auto-migrated
- [ ] `TestSuiteService.list()` merges all three; updates/deletes rejected when `builtIn`
- [ ] Add `defaultTestSuiteId?` to `EvalPurposeTemplate` — starter cases stay a smoke run, the linked suite is the benchmark
- [ ] Import the reviewed MemoryApi v1 datasets: `memory-classification-v1` (64 cases), `memory-tagging-v1` (72), `memory-summarization-v1` (36), each with 25% marked `split:regression`
- [ ] Dataset linter rejecting duplicate IDs, out-of-taxonomy labels, coverage gaps, malformed slice tags, prompt-example leakage, and provenance hash mismatches

**A6 — Task-appropriate scoring**
- [ ] **Classification**: `exactOutput`, `normalizedCorrect`, `formatCompliant`, `validLabel` per response; aggregate accuracy, macro-F1, per-class P/R/F1, invalid-label rate, format-compliance rate, confusion matrix, run-to-run agreement. Gate: macro-F1 ≥ 0.90, per-class recall ≥ 0.80, zero invalid labels, 100% format compliance
- [ ] **Tagging**: parse raw output without silently repairing it; per case TP/FP/FN, P/R/F1, Jaccard, exact-set match, unknown tags, duplicates, format compliance. Gate: micro-F1 ≥ 0.85, macro label-F1 ≥ 0.70, exact-set ≥ 0.60, zero invalid labels
- [ ] **Summarization**: deterministic checks (no preamble/heading/fence, compression ratio in range, protected tokens preserved, no literal forbidden claims) *before* model grading; revise `summarization-quality` to Faithfulness 0.40 / Salient Coverage 0.30 / Retrieval Utility 0.20 / Concision 0.10; three independent judge passes at t=0 aggregated by median; a model may not judge itself. Gate: median weighted ≥ 4.2, median Faithfulness ≥ 4.5, no critical unsupported claim
- [ ] Persist metrics in a discriminated `EvaluationSummary.taskMetrics` union — do **not** manufacture rubric composite scores for classification and tagging

**A7 — Statistics that match the data's resolution**
- [ ] Bootstrap 95% confidence intervals over cases; McNemar paired test for baseline-vs-candidate
- [ ] Report the point estimate, the case count behind it, and **one case's worth of movement in pp** alongside every primary metric
- [ ] Express gates against the interval, not the point estimate; emit `inconclusive` with a needed-case-count rather than a false pass
- [ ] State regression-slice gates in **cases** ("at most one regression-slice case may flip"), not points — a 16-case slice moves in 6.25 pp steps, so a bare 2 pp rule reduces to "any single case flipped" and rejects good candidates on noise
- [ ] Default classification/tagging runs: production temperature (`t=0.3`, not `t=0`), ≥3 runs per prompt/model/case — `0.3` is noisier run-to-run than `0` would be, which is exactly why the repeated-run and run-to-run-agreement metrics can't be skipped here

**A8 — Judge qualification**
- [ ] `JudgeQualification` record: judge model id, calibration-set hash, date, measured statistics
- [ ] Qualify against ≥20 human-scored summaries: Spearman ≥ 0.6 with human overall, Faithfulness within 1 point on ≥80%, mean inflation within 0.5, self-consistency MAD ≤ 0.5 per dimension
- [ ] Re-qualify when the judge model or calibration set changes; label a summarization result **advisory, not promotable** when the judge is unqualified
- [ ] Derive `grounded-summary` compression bounds from the 10th/90th percentile of v1 reference summaries; record the derivation in the suite provenance

**A9 — Two-phase model selection**
- [ ] Phase 1: vary prompt, fix incumbent production model, calibration split only
- [ ] Phase 2: vary model across the declared candidate slate, fix the promoted prompt, both splits
- [ ] Phase 3: re-run a short phase-1 confirmation on the phase-2 winner; on failure recommend the runner-up and record why
- [ ] Selection rule, in order and recorded with the verdict: **gate** (discard any model failing the quality floor or emitting invalid output) → **quality** (primary metric with CIs; overlapping intervals are a tie group, not a ranking) → **budget** (p95 latency as a share of a whole-ingestion target) → **stability** (run-to-run agreement, then token efficiency)
- [ ] Report the full ordering, the tie groups, and the discarded-by-gate list
- [ ] Report the best **single** model across all three tasks alongside the per-task winners, with the quality delta — three per-task winners means three resident models or a swap per memory, and LMEval structurally cannot see that cost
- [ ] Emit `ModelRecommendation` per task as a first-class artifact to LMEval's own export directory

**A10 — Interchange contract**
- [ ] Vendor `memory-eval-snapshot.v1.schema.json` and `prompt-promotion-record.v1.schema.json` under `data/evals/schemas/`; validate on import; schema-version or hash mismatch is a **hard failure**, never a best-effort parse

**A11 — Task-specific reporting**
- [ ] Confusion/per-class panels (classification), micro/macro + per-tag panels (tagging), judge dimensions + unsupported-claim findings (summarization)
- [ ] Slice tables: calibration/regression, boundary pairs, input length, ambiguity, prompt-injection
- [ ] Model-selection view for `comparisonMode: 'model'` — gate pass/fail, primary metric with CIs and tie groups, p95 latency, truncation rate, run-to-run agreement, resulting recommendation
- [ ] Include benchmark version, provenance hashes, resolved inference parameters, transport, and judge qualification in HTML/Markdown exports and baseline comparisons

---

### Track B — Wizard completion

**B1 — Prepare page (Phase 7 remainder)**
- [ ] Drag-to-reorder for inline test case rows
- [ ] "Import from test suite" shortcut in the inline table (copies a suite's cases in as editable inline rows)

**B2 — Results page (Phase 7 remainder)**
- [ ] Failure detail panel: clicking a failed cell opens a drawer with error message + type, retry history (attempt, timestamp, error), full raw response, deterministic check breakdown, and a **↻ Retry this cell** button calling `POST /api/eval/evaluations/:id/retry` with `{ failedCellsOnly: true }`
- [ ] Add `rawJudgeResponse?: string` to `JudgeResult`; store it in the `JudgeService` parse fallback chain; display it in the failure panel
- [ ] Eval run selector when a session has multiple runs — a tab bar of run number + completion status
- [ ] Skeleton loaders for heatmap cells while results fetch; spinner in the model leaderboard

**B3 — Step 5: Summary & AI suggestions (Phase 9)**
- [ ] `SummaryPage.tsx` replacing the placeholder — `SummaryOverview`, `ModelRecommendation`, `PerModelAnalysis`, `ImprovementSuggestions` components
- [ ] `POST /api/eval/evaluations/:id/summary-analysis` — accepts `{ refinementModel? }`, builds the analysis prompt, dispatches via LMApi, parses into typed sections, caches to `data/evals/evaluations/{id}/analysis.json`
- [ ] "Apply Suggestion" → new prompt version + session version; "Apply & Re-run" → apply and start a new run
- [ ] Wire the "View Summary & Suggestions →" button on `ResultsPage.tsx`
- [ ] Graceful degradation: no `REFINEMENT_MODEL` configured → raw summary without AI sections

**B4 — Git integration frontend (Phase 2.5 remainder)**
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

Three walkthroughs were deferred because no live server/browser was available in the implementing pass.
None are code changes; all are owed before the phases they cover can be called done.

- [ ] **Phase 11** — Model Comparison renders one editor and blocks Next below 2 models; Prompt Comparison renders both and allows 1 model with a visible nudge
- [ ] **Phase 12** — Session Hub → New Evaluation → gallery shows 3 built-ins + Start Blank → selecting Classification lands on Step 1 pre-filled with the provenance badge, and Step 2's assertion card and test cases populated → Start Blank behaves like today's wizard
- [ ] **Phase 7 (this pass)** — blockers panel, Run tooltip, `Saving prompts…` label, judge-call count, error-boundary fallback, and Compare copy/stats confirmed in a running browser

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
- **Purpose template → benchmark suite affordance.** Once A5 lands, the Prepare page should offer
  "Load the `memory-classification-v1` benchmark" as a one-click action beside the starter cases, and
  say plainly which one is the smoke test and which one is the regression benchmark.
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
