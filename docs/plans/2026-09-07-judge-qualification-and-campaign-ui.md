# Judge Qualification and Model-Selection Campaign UI — Implementation Plan

## Purpose

LMEval already contains the measurement logic for judge qualification and three-phase model-selection
campaigns, but neither capability is safely operable from the browser. This plan makes those backend
capabilities usable without weakening the project's evidence rules:

1. turn judge qualification into a persisted, observable long-running job and show its state wherever
   a judge is selected; then
2. add a draft-first campaign workflow for configuring, reviewing, starting, monitoring, cancelling,
   and interpreting model-selection campaigns.

These are the next features to implement while the current baseline evaluation finishes because their
requirements do not depend on its eventual scores. They close a larger usability gap than the remaining
wizard polish: A8 and A9 are implemented at the service/API layer, but a normal user cannot safely drive
them without direct API calls.

## Current State and Corrections to Earlier UX Notes

The implementation must begin from these verified facts rather than treating the work as frontend-only:

- `POST /api/eval/judges/:modelId/qualify` waits for the entire qualification in one request. The
  service makes three calls for every calibration case and persists only the final
  `JudgeQualification`; there is no job record, progress, cancellation, or interrupted-run state.
- `POST /api/eval/model-selection` creates and immediately starts a campaign. There is no validate,
  draft, patch, explicit-start, or consolidated-feedback contract.
- `ModelSelectionService` writes a phase evaluation ID to the campaign only after
  `ExecutionService.run()` returns. While a phase is actually running, campaign polling cannot identify
  the active evaluation, and campaign cancellation cannot reliably reach it.
- Phase evaluation configs are written directly rather than created through `EvaluationService`; this
  bypasses the normal validation and prompt-version pinning path.
- `phase3EvalIds[task]` holds only one ID, so a failed winner confirmation followed by a runner-up
  confirmation overwrites part of the audit trail.
- Campaign tasks execute sequentially today. Preserve that behavior: sharing a GPU between candidate
  matrices and judge work has already caused multi-minute contention.
- The existing `BreakdownView` scatter is not reusable verbatim. It charts average latency against a
  1–5 composite score, while a campaign decision needs p95 latency against a task-specific primary
  metric with its own scale and confidence interval.
- The checked-in OpenAPI document describes the current synchronous judge and create-and-start campaign
  routes. New routes and response types must be added without silently changing those contracts.

## Scope Boundaries

### In scope

- Persisted asynchronous judge-qualification runs, including progress, cancellation, failure, stale
  qualification detection, and honest restart recovery.
- A shared judge-qualification status/control component used by the existing wizard judge selector and
  the new campaign form.
- Server-side campaign validation, drafts, explicit start, consolidated feedback, prompt pins, call
  estimates, warning acknowledgement, active phase tracking, cancellation, and interruption recovery.
- Campaign list, create, review/monitor, and recommendation views.
- Backward-compatible API behavior, shared frontend/backend types, OpenAPI/client updates, automated
  tests, browser verification, and documentation reconciliation.

### Deferred

- A global Settings page and editable latency budgets in the browser. This feature reads and explains
  existing budgets; missing budgets remain a warning.
- Task-specific diagnostics or contract-violation panels on the ordinary Results page.
- B4's Git-versus-app-native version-history redesign.
- Full Matrix N-prompt UI, pairwise/select-best repair, AI-generated test cases, and automated prompt
  refinement.
- A general background-job framework. Build the two small file-backed lifecycles required here and
  share only primitives that are clearly identical.
- Automatic continuation after a server restart. Replaying partially completed model work could
  duplicate expensive calls and corrupt the audit trail.

## Product and Safety Decisions

1. **Qualification first, campaigns second.** The campaign form reuses the shared qualification
   component, and summarization recommendations are advisory when the judge is not currently qualified.
2. **Draft first in the browser.** Saving a campaign creates a server-backed draft. Starting requires a
   separate review action after server validation and call estimation.
3. **Legacy create-and-start remains.** Existing callers of `POST /model-selection` retain their current
   behavior; the new browser uses the draft endpoints.
4. **Warnings are explicit but not hard blockers.** Missing/stale/failed judge qualification,
   self-grading, pending ground-truth review, and missing latency budgets require visible treatment.
   Unqualified or self-judging summarization requires explicit acknowledgement before Start and remains
   advisory/non-promotable after execution, matching the existing specification.
5. **Errors block; warnings require acknowledgement only when marked.** Missing entities, invalid task
   relationships, duplicate candidates, unroutable models, missing prompt pins, and missing required
   judge configuration are errors. Informational caveats do not become acknowledgements by default.
6. **Long jobs are observable and cancellable.** Persist state before dispatching work, update it during
   work, and never infer success from a lost process.
7. **No hidden concurrency.** Campaign tasks and phases stay sequential. The UI must not offer parallel
   task execution in this slice.

## Shared Types and Persistence

Keep canonical shared interfaces in `src/types/eval.ts`; server code imports or re-exports them rather
than defining divergent wire types.

### Judge qualification types

Add:

- `JudgeQualificationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' |
  'interrupted'`.
- `JudgeQualificationRun` with `id`, `judgeModelId`, `calibrationSetId`, `calibrationSetHash`, `status`,
  `totalCalls`, `completedCalls`, timestamps, optional `result`, `error`, and `cancelRequestedAt`.
- `JudgeQualificationState = 'missing' | 'running' | 'qualified' | 'unqualified' | 'stale' | 'failed' |
  'cancelled' | 'interrupted'`.
- `JudgeQualificationStatus`, combining the current final record, whether its calibration hash matches
  the current set, and the active or latest qualification run.

Persist run records under a dedicated `data/evals/judge-qualification-runs/{runId}.json` directory.
Continue writing successful final records to the existing
`data/evals/judge-qualifications/{safeModelId}.json` location so evaluation gating and historical data
remain compatible.

### Campaign types

Add:

- `ModelSelectionCampaignInput`, separate from the persisted campaign. It carries tasks, incumbent,
  candidate metadata, exact prompt pins by task, suites by task, optional VRAM context, and the
  summarization judge.
- `CampaignValidationIssue` with a stable `code`, `severity: 'error' | 'warning'`, `path`, user-facing
  `message`, and `requiresAcknowledgement`.
- `CampaignCallEstimate` with per-task phase-one, phase-two, phase-three-minimum,
  phase-three-maximum, total-minimum, and total-maximum counts. Summarization estimates include the
  configured rubric assertion multiplier; phase-three maximum includes runner-up fallback.
- `CampaignValidationResult` with `valid`, `issues`, and `callEstimate`.
- `CampaignPhase = 'prompt-sweep' | 'model-sweep' | 'confirmation'`.
- `CampaignActiveWork` with task, phase, evaluation ID, and start/update timestamps.
- `CampaignFeedback`, combining campaign lifecycle, validation, call estimates, active evaluation
  progress/status, recommendation readiness, and deployment-relative browser paths.

Extend `ModelSelectionCampaign` with exact `promptPinsByTask`, optional `activeWork`, acknowledged
warning codes, and `phase3AttemptEvalIds: Record<string, string[]>`.

Keep `promptIdsByTask`, `phase1EvalIds`, `phase2EvalIds`, and `phase3EvalIds` readable and updated as
compatibility fields. For old campaign JSON, normalize missing prompt pins from the referenced prompt's
current version only when loading for display; do not start or retry an old record until server
validation has persisted explicit pins. `phase3EvalIds[task]` remains the final selected confirmation
for old clients, while `phase3AttemptEvalIds[task]` is the complete audit history.

## Judge Qualification Backend

### Service behavior

Refactor the existing qualification loop so both synchronous and asynchronous entry points call the
same scoring implementation. The implementation accepts progress and cancellation callbacks; it does
not duplicate threshold or parsing logic.

For an asynchronous run:

1. Load and validate the calibration set, compute its hash, and calculate `totalCalls` before returning.
2. Reject a second active run for the same model and calibration-set hash with `409`, returning the
   active run identifier in the error payload.
3. Persist `pending`, return control, then transition to `running` before the first LMApi call.
4. Persist `completedCalls` after every response is parsed, even when a later call fails.
5. Check the persisted/in-memory cancellation flag before each call. A request already sent to LMApi is
   allowed to finish; then mark the run `cancelled` without computing or replacing the final record.
6. On success, persist the normal `JudgeQualification`, attach it to the run, and mark the run
   `completed` whether the thresholds passed or failed. Threshold failure is `unqualified`, not a job
   failure.
7. On transport or parsing failure, retain progress and record a concise error in a terminal `failed`
   run. Never replace a previously valid qualification with a failed attempt.

At `buildApp()` startup, scan only run records marked `pending` or `running` and mark them
`interrupted`, with a reason that the host restarted before completion. Do not replay them.

### API contract

Preserve:

- `GET /api/eval/judges/:modelId/qualification` — existing raw final record/404 contract.
- `POST /api/eval/judges/:modelId/qualify` — existing synchronous compatibility contract.

Add:

- `GET /api/eval/judges/:modelId/qualification-status` → `JudgeQualificationStatus`.
- `POST /api/eval/judges/:modelId/qualification-runs` with optional `calibrationSetId` → `202` and
  `JudgeQualificationRun`.
- `GET /api/eval/judges/qualification-runs/:runId` → the persisted run or `404`.
- `POST /api/eval/judges/qualification-runs/:runId/cancel` → `202` when cancellation is requested,
  `409` for a terminal run, and `404` when absent.

Encode model IDs with `encodeURIComponent` in clients and decode exactly once at the route boundary.
Do not add qualification WebSocket events in this slice; polling the persisted resource is sufficient
and recovers after refresh or a missed connection.

## Campaign Backend

### Validation

Create a campaign validation service instead of extending route handlers. It must:

- reject empty/duplicate/unknown tasks;
- require an incumbent and at least two unique candidate models;
- verify every grouped `server::model` ID is currently routable through the canonical grouped-model
  discovery path;
- require at least two pinned prompts for each prompt-sweep task, verify every version exists, and
  preserve their order;
- require one task-appropriate suite per task, verify it is readable and suitable for the selected
  purpose, and surface provenance/review status;
- require a judge for summarization;
- surface current qualification state and self-judge overlap as acknowledgement-required warnings;
- surface pending benchmark review and missing latency budgets as warnings without fabricating values;
- synthesize each phase's `EvaluationInput` and reuse `EvaluationValidationService` so cardinality,
  inference, benchmark, and judge rules do not fork;
- compute call estimates from the actual suite split, prompt/model cardinality, resolved runs per cell,
  and assertion strategy.

Stable issue codes are part of the API. At minimum define codes for invalid task, duplicate candidate,
unroutable model, missing prompt pin, missing/mismatched suite, missing judge, unqualified/stale judge,
self-judge, pending ground-truth review, and missing latency budget.

### Draft lifecycle and API

Preserve current routes, including legacy `POST /api/eval/model-selection` create-and-start.

Add:

- `POST /api/eval/model-selection/validate` — normalize and validate without persistence.
- `POST /api/eval/model-selection/drafts` — validate and persist a `draft` campaign.
- `PATCH /api/eval/model-selection/:id` — replace allowed draft fields after revalidation; reject
  non-drafts with `409`.
- `POST /api/eval/model-selection/:id/run` — revalidate, verify required warning acknowledgements,
  atomically transition `draft` to `pending`, and return `202`. Concurrent starts yield one `202` and
  one `409`.
- `GET /api/eval/model-selection/:id/feedback` — return consolidated `CampaignFeedback`.
- Keep `GET /`, `GET /:id`, `GET /:id/recommendations`, and `POST /:id/cancel` compatible.

The start request supplies `acknowledgedWarningCodes`. Persist only codes present in the current
validation result; reject missing required acknowledgements. Revalidation after a draft edit or stale
external dependency may add or remove warnings, so the server—not the browser—decides what must be
acknowledged.

Return browser paths relative to the mount path passed into the shared composition root, matching the
existing evaluation feedback behavior. Paths include campaign detail plus Run/Results links for every
known phase evaluation.

### Orchestration corrections

Replace direct phase config writes with this sequence:

1. Build a normalized `EvaluationInput` containing the exact prompt pins selected by the campaign.
2. Create the phase evaluation through `EvaluationService` as `pending`.
3. Persist the evaluation ID into the appropriate compatibility map, append confirmation attempts when
   relevant, and set `activeWork` **before** calling `ExecutionService.run()`.
4. Run the evaluation and clear/update `activeWork` only after reading its terminal persisted state.

Carry the winning phase-one prompt ID **and version** into phases two and three. A newer prompt version
created while the campaign runs must not change its input.

After every awaited phase and before scheduling the next one, reload the campaign and stop if it is
cancelled or cancellation was requested. Campaign cancellation calls the existing evaluation
cancellation path for `activeWork.evaluationId`, persists `cancelled`, and prevents the outer catch/final
block from rewriting that state as `failed` or `completed`.

If winner confirmation fails and a runner-up exists, append both evaluation IDs to
`phase3AttemptEvalIds[task]`; retain the final accepted/final attempted ID in `phase3EvalIds[task]` for
compatibility and record the fallback reason in the recommendation.

At startup, mark campaigns left in `pending` or `running` as `failed`/interrupted with a specific
recoverable reason. Provide an explicit retry action that clones the immutable configuration and pins
into a new draft rather than attempting to continue inside a partially executed campaign.

## Frontend API and Shared Qualification Component

Add typed client functions for all new judge and campaign routes. Continue deriving the API base from
Vite's base URL so standalone and HomeBase-hosted paths behave identically.

Create a shared `JudgeQualificationStatus` component with a selected `modelId` and optional compact
mode. It must:

- load consolidated status when the model changes;
- render `Never tested`, progress, `Qualified`, `Not qualified`, `Stale`, `Failed`, `Cancelled`, and
  `Interrupted` distinctly using existing color variables;
- display Spearman and the remaining qualification metrics in expandable detail after completion;
- start an asynchronous run, poll while non-terminal, stop polling on unmount/model change, and recover
  an active run after page refresh;
- offer cancellation and retry where valid;
- explain that qualification is expensive and should not compete with a running candidate matrix;
- never label a threshold failure as an execution error.

Wire it below the existing judge dropdown in `JudgeConfig`. Pairwise remains disabled/no-op according to
its existing constraints; this work must not imply pairwise support.

## Campaign UI

### Routes and discovery

Add:

- `/campaigns` — campaign list;
- `/campaigns/new` — campaign builder;
- `/campaigns/:id` — draft review, live monitoring, or completed recommendation according to status.

Add a `Model Selection Campaign` action/card to `SessionHubPage`. Do not introduce a new global
navigation or redesign the hub.

### Campaign list

Show newest-first cards using the existing gallery/card language. Each card includes task badges,
incumbent, candidate count, lifecycle status, updated time, and completed task recommendations. Include
clear empty, loading, and request-failure states plus a New Campaign action.

### Campaign builder

The single-page builder loads grouped models, prompts with versions, purpose templates, suites, latency
budgets, and judge status. It provides:

- incumbent model selection;
- unique candidate rows with server/model selection and optional declared parameter-size,
  quantization, and context-length metadata;
- classification/tagging/summarization task selection;
- ordered prompt-version pins and a suite for each selected task, defaulting to that purpose template's
  linked built-in benchmark;
- a required judge selector plus shared qualification component when summarization is selected;
- optional total-VRAM context, explicitly labelled as declared metadata that LMEval cannot validate or
  use to compute `vramBudgetExceeded`.

Saving calls the draft endpoint and navigates to `/campaigns/:id`. Client validation may improve form
feedback, but server validation is authoritative.

### Draft review and Start

For `draft` campaigns, the detail page shows the complete fixed/varying-variable design, exact prompt
versions, suite provenance and review status, candidate slate, inference/runs behavior, per-phase call
estimate range, latency-budget state, and judge state.

Errors disable Start and link back to editing. Required warnings render checkboxes keyed by their stable
codes. The Start request carries the checked codes; handle new server-side warnings by refreshing the
review rather than discarding the user's draft.

### Monitoring and cancellation

Poll campaign feedback while status is `pending` or `running`, with backoff after request failures and a
manual Refresh action. Render one task row at a time because execution is sequential. Each row shows:

- Prompt sweep → Model sweep → Confirmation → Recommendation;
- pending/running/completed/failed/cancelled state;
- current cell progress from the active evaluation feedback;
- a Run-page link for active work and Results-page links for terminal phase evaluations;
- every confirmation attempt when fallback occurs.

Cancel requires confirmation, disables while submitting, and remains available until the campaign is
terminal. After cancellation, retain all completed phase links and partial evidence without presenting
a recommendation as complete.

### Recommendation view

For each completed task, lead with the gate-aware recommendation and clearly label advisory outcomes.
Then show:

- primary metric and 95% CI;
- statistical tie groups rather than a misleading total-order leaderboard;
- p95 latency and stability used within the selection rule;
- discarded-by-gate candidates and reasons, collapsed by default;
- winner and runner-up confirmation attempts, including fallback reason;
- suite/prompt/inference provenance.

Add a focused quality-versus-p95-latency chart with a task-specific y-domain, a gate reference line,
confidence-interval representation, tie-group encoding, and accessible textual/table fallback. Extract a
small generic chart primitive only if it leaves the existing Results behavior unchanged; otherwise keep
the campaign chart separate.

When all selected tasks complete, show `bestSingleModel` and its per-task quality deltas. Render
`crossServerFlag` as an operational caveat, never as a measured cost. Do not show
`vramBudgetExceeded` unless future work supplies real footprint data.

## Failure Modes and Compatibility

- A stale qualification is detected by comparing the persisted calibration hash with the current set;
  it is not treated as current merely because `qualified: true` was once recorded.
- Refreshing or closing a browser does not affect a qualification or campaign job.
- A server restart produces `interrupted`, not a frozen spinner and not automatic replay.
- Failed qualification attempts do not erase the last completed record; the UI shows both the prior
  qualification and latest attempt state.
- A campaign cannot be edited after start. Retry creates a new draft with preserved pins and metadata.
- Deleting or changing a referenced prompt/suite before Start causes revalidation failure. Changes after
  Start cannot alter persisted prompt pins or already-snapshotted phase inputs.
- Legacy campaign files remain listable. Records lacking the new fields render with a compatibility
  caveat and cannot be resumed until cloned/revalidated as a new draft.
- Missing latency budgets do not receive `0`, `Infinity`, or an invented default.
- Advisory, inconclusive, failed, and passed remain distinct throughout API responses and UI copy.
- All routes are mounted in `buildApp()` and browser paths remain correct under both `/` and `/lmeval/`.

## Implementation Sequence

1. **Qualification lifecycle:** add run types/storage, refactor the scorer, implement progress,
   cancellation, duplicate protection, restart interruption, routes, OpenAPI, and service/route tests.
2. **Qualification UI:** add typed clients and the shared component; wire it into `JudgeConfig`; add
   component tests.
3. **Campaign contracts:** add input/validation/feedback types, prompt pins, call estimation, warning
   codes, draft lifecycle, compatibility normalization, routes, and OpenAPI.
4. **Campaign orchestration:** route phase creation through `EvaluationService`, persist active IDs
   before execution, preserve confirmation attempts, and correct cancellation/interruption semantics.
5. **Campaign browser flow:** add list, builder, draft review/start, monitoring/cancel, recommendation
   view, chart, hub entry point, API clients, and component tests.
6. **Verification and docs:** add Playwright coverage, run automated gates/builds, perform later live
   browser checks when GPU capacity is free, and reconcile README, `docs/SPECIFICATION.md`, and
   `docs/TASK.md` only after the behavior is implemented and verified.

Keep each increment reviewable. The qualification backend/UI can land before campaign routes; campaign
contracts/orchestration should land before campaign pages.

## Test Plan

### Unit and service tests

- Qualification progress totals, per-call persistence, threshold-failure-as-completed, transport
  failure, cancellation between calls, duplicate-active-run rejection, stale hash detection, prior
  record preservation, and startup interruption.
- Campaign normalization and validation for every stable issue code.
- Exact prompt pins preserved across all phases even when a newer prompt version appears mid-campaign.
- Call estimates for each task, repeated runs, summarization assertion multiplier, and runner-up range.
- Draft mutation, post-start immutability, warning acknowledgements, and simultaneous start attempts.
- Active evaluation ID persisted before the execution promise resolves.
- Cancellation during every phase, no next-phase dispatch after cancellation, and terminal state not
  overwritten by an outer error handler.
- Winner failure plus runner-up confirmation preserves both attempt IDs and the final recommendation.
- Old campaign records remain readable and are not silently resumed.

### Route tests

- Successful and invalid qualification-run creation, status lookup, duplicate `409`, terminal cancel
  `409`, unknown `404`, and synchronous endpoint compatibility.
- Campaign validate/draft/patch/start/feedback contracts, required acknowledgement failure, one-winner
  concurrent start, immutable patch rejection, cancellation, clone-to-retry behavior, and legacy
  create-and-start compatibility.
- Browser paths for standalone and a configured HomeBase mount path.
- OpenAPI contract tests enumerate every new route and status.

### Frontend tests

- Every qualification visual state, metric details, progress, retry/cancel actions, polling recovery,
  and polling cleanup on model change/unmount.
- Campaign form uniqueness/task requirements, default suite selection, exact version selection,
  summarization judge requirement, and API error display.
- Draft review call estimates, error blocking, warning acknowledgements, stale-warning refresh, and
  explicit Start.
- Campaign polling, phase links, request recovery, cancellation, interrupted state, fallback history,
  advisory copy, tie groups, chart/table accessibility, and cross-task summary.
- Session Hub entry point and route navigation.

### Playwright and live verification

Use controlled service fixtures or route interception for deterministic browser coverage of:

1. qualification start → progress → completion;
2. qualification cancellation and reload recovery;
3. campaign builder → saved draft → review → acknowledgement → explicit Start;
4. active phase monitoring with Run link → completed phase Results link;
5. cancellation and interrupted recovery;
6. completed recommendation with tie groups, fallback confirmation, advisory state, and
   best-single-model summary.

Run:

- full Vitest suite;
- lint, reporting pre-existing unrelated failures separately;
- standalone frontend build;
- hosted frontend build;
- host adapter build;
- relevant API integration tests and Playwright specs.

After the implementation is complete and the existing evaluation/qualification work no longer occupies
the GPU, perform a real LMApi browser walkthrough. A bounded smoke proves mechanics only. Record the
qualification's actual statistics and any campaign gate/recommendation as model-backed evidence, and do
not call either promotion-quality evidence while benchmark review or judge qualification remains
unresolved.

## Documentation Updates Required During Implementation

- Update `docs/SPECIFICATION.md` with the qualification-run lifecycle, campaign draft/feedback
  contracts, campaign browser routes, and current Step 5 state if its existing placeholder description
  remains stale.
- Update `docs/TASK.md` to track the two UI/lifecycle increments and mark them complete only after the
  corresponding automated and browser evidence exists.
- Update README user workflows and endpoint table for qualification and campaigns.
- Update `docs/openapi/lmeval-eval-api.v1.json` and its contract tests in the same change as each public
  route.
- Preserve the standing distinction between automated mechanics, live model verification, benchmark
  approval, and promotion evidence.

## Definition of Done

- A user can start qualification, leave or refresh the page, return to accurate progress, cancel or
  retry, and understand whether the final model is qualified, unqualified, stale, or operationally
  failed.
- A user can configure and save a reproducible campaign draft, review exact pins/costs/caveats, explicitly
  start it, monitor and cancel the real active phase, inspect every phase evaluation, and understand the
  final gate-first recommendation and its uncertainty.
- Prompt versions cannot drift during a campaign; runner-up attempts and partial/cancelled work remain
  auditable.
- Existing synchronous qualification and create-and-start campaign clients continue to work.
- Standalone and HomeBase-hosted operation share the same composition-root behavior and correct links.
- Automated checks and controlled browser tests pass, with unrelated baseline failures stated plainly.
- Real-model/browser evidence is reported separately after GPU capacity is available.

## Implementation refinements (2026-09-07)

Implementation retained the plan's lifecycle and UI shape with four evidence-driven corrections:

- Qualification freshness uses a SHA-256 hash of the complete calibration set, including source text,
  candidate summaries, and human scores. Hashing case IDs alone would miss changes to the actual anchor
  evidence. Active qualification is exclusive per judge model because its final record is keyed by
  model; allowing two different calibration sets to race would make the winner nondeterministic.
- Campaign phase inputs pin MemoryApi's production-shaped inference limits: temperature 0.3 and token
  caps 50/100/150 for classification/tagging/summarization. Every phase uses three repetitions, while
  call estimates keep candidate calls and summarization rubric calls explicit.
- A phase may finish its execution loop with many transport failures. The two baseline sweeps eventually
  did exactly that. A campaign therefore stops without selecting a winner unless the phase has a summary,
  every expected cell completed successfully, and no execution failures. Partial results and links remain
  visible for diagnosis.
- Confirmation passes only on a CI-backed `pass` verdict. `inconclusive`, `advisory`, and `fail` remain
  distinct and trigger the documented runner-up path. Every attempt and fallback reason is retained.
- Tagging summaries persist which statistic their compatibility `jaccardCI` field represents. Campaign,
  feedback, and insights views therefore label MemoryApi's recall-weighted mode as `microRecall` rather
  than presenting its interval as Jaccard.
