# Evaluation Runtime Observability — Implementation Plan

## Purpose

LMEval can currently answer “is this evaluation running?” and “how many Promptfoo cells have
completed?”, but it cannot quickly answer the operational questions that matter during a long run:

- How much work was configured?
- How much candidate and judge work remains?
- Which models and servers are active, queued, slow, or failing?
- Is the run progressing, merely slow, or plausibly stalled?
- How long is it likely to take?
- What happened before a browser connected or after its WebSocket disconnected?

The 2026-09-07 baseline runs exposed this directly. Answering a simple status question required
correlating two evaluation configs, benchmark split sizes, `progress.json`, timestamps, and the
feedback API. The two active runs represented 612 candidate cells (288 classification and 324
tagging), yet the product exposed only a combined cell counter per evaluation and no trustworthy ETA
or per-model/server attribution.

This plan adds durable, privacy-safe runtime telemetry for ordinary evaluations and makes it available
through the existing feedback API, a compact active-runs API, structured event history, and the Run
dashboard. The later judge-qualification and campaign UI work in
`2026-09-07-judge-qualification-and-campaign-ui.md` should consume these contracts rather than create a
second progress system.

## Current State

- `EvaluationProgress` contains only `total`, `completed`, `failed`, and `updatedAt`.
- `ExecutionService` initializes `progress.json`, increments its completed count from Promptfoo's
  `progressCallback`, and writes final counts after `evaluate()` resolves.
- Promptfoo 0.122.2's callback exposes cumulative progress and the current input step, not the completed
  response/grading result. Full `EvalMatrixCell` data is unavailable until the final result array is
  mapped.
- Candidate and judge LMApi calls already pass through LMEval-owned providers in `PromptfooAdapter`.
  Those providers know the model, server, logical call kind, start/end time, retry notifications, and
  final transport metadata. They are the correct instrumentation boundary.
- `GET /api/eval/evaluations/:id/feedback` reads persisted progress and survives missed WebSocket
  events, but exposes only aggregate counts.
- `GET /api/eval/evaluations/:id/results` returns no useful incremental results while a Promptfoo run
  is active.
- The Run dashboard builds detailed per-model state from late `cell:*` events/final results. During a
  long run, the useful `cell:completed` burst arrives only after Promptfoo returns.
- WebSocket events are transient. There is no persisted event journal, active-run summary endpoint,
  stall classification, provider-call breakdown, or runtime estimate.
- The Prepare page's existing duration estimate is a fixed approximation, not based on observed
  per-model/server throughput.

## Goals

1. Make the configured workload explicit before and during a run.
2. Persist enough telemetry to reconstruct current state after refresh or WebSocket loss.
3. Separate candidate calls, judge calls, retries, and completed evaluation cells so counts cannot be
   mistaken for one another.
4. Attribute work to model and server without storing prompt or response content in telemetry.
5. Provide cautious ETA ranges and evidence-based slow/stalled classifications without treating a
   long local-model call as dead prematurely.
6. Give humans, browser clients, and agents one consistent status contract.
7. Preserve Promptfoo as the execution engine and preserve existing evaluation/result artifacts.

## Non-Goals

- Replacing Promptfoo, parsing its internal logs, or reintroducing the former hand-rolled execution
  engine.
- Streaming partial model output or partial assertion results.
- Persisting prompts, user messages, model responses, API keys, headers, or request bodies in telemetry.
- Distributed tracing across LMApi and Ollama. LMEval records its side of the boundary and any IDs or
  server metadata LMApi already returns.
- Automatically cancelling a slow/stalled run.
- Treating ETA as a deadline or guaranteeing completion time.
- Comparing model speed across servers as a quality claim. Server and concurrency context remain
  visible caveats.
- Building a general log-management/search platform or adding a database solely for live telemetry.
- Retrofitting exact per-call history for old evaluations that predate this feature.

## Terminology

Use these terms consistently in types, APIs, UI, and documentation:

- **Cell** — one prompt × candidate model × test case × repetition. A cell is complete only after its
  candidate response and all configured assertions/judging finish.
- **Provider call** — one logical call from LMEval to LMApi. It is either `candidate` or `judge`.
- **Attempt** — one transport attempt inside a provider call. Retries increase attempts, not planned
  provider-call counts.
- **Work plan** — immutable counts derived from the pinned evaluation configuration before execution.
- **Progress snapshot** — the latest durable aggregate state.
- **Runtime event** — a small append-only lifecycle record used to explain how the snapshot was reached.
- **Slow** — work remains active longer than expected but is still within a plausible timeout/retry
  envelope.
- **Stalled** — no relevant progress or heartbeat has occurred beyond a conservative, documented
  threshold. It is a warning requiring investigation, not proof that the process is dead.

## Architecture

### Source of truth

Keep evaluation JSON files as the durable source of truth:

- `work-plan.json` — immutable planned dimensions and call counts, written before execution.
- `progress.json` — the latest versioned progress snapshot, replacing the current flat shape while
  retaining its four existing fields for compatibility.
- `runtime-events.jsonl` — append-only, metadata-only lifecycle events.
- existing `config.json`, `cells.json`, `results.json`, `summary.json`, and `error.json` remain unchanged
  in purpose.

Do not put live telemetry in the Insights SQLite index. That index describes completed cross-run
measurement data; runtime telemetry is evaluation-local, write-heavy, and disposable after diagnosis.

### Instrumentation boundary

Add optional telemetry callbacks to the candidate and judge provider builders in `PromptfooAdapter`.
Emit logical-call lifecycle events around `LmapiClient.chatCompletion()` and retry events from its
existing retry callback. This captures real activity while leaving Promptfoo in charge of scheduling,
assertions, and final result construction.

Do not use Promptfoo's file-based `afterEach` extension hook for v1. It requires a generated module and
still does not replace provider-level visibility into starts, retries, active duration, and judge calls.
Continue using `progressCallback` as the authoritative completed-cell signal, enriched with the input
step's model attribution where reliable.

### Runtime telemetry service

Introduce a backend service responsible for:

- creating and reading work plans;
- initializing/migrating progress snapshots;
- recording provider-call starts, retries, completions, and failures;
- recording completed cells from Promptfoo progress;
- maintaining per-model/server aggregates and active-call descriptors;
- appending bounded structured events;
- calculating elapsed time, throughput, ETA ranges, and health classification;
- reconciling terminal evaluation status with telemetry;
- serving safe active-run summaries.

All progress mutation passes through this service. `ExecutionService`, providers, feedback, and routes
must not independently derive subtly different counters.

## Public Types

Keep canonical types in `src/types/eval.ts` and re-export them server-side.

### Work plan

Add `EvaluationWorkPlan`:

- `schemaVersion`;
- `evalId`, `createdAt`;
- pinned dimensions: prompt count, model count, test-case count, repetitions;
- `candidateCells`;
- `plannedCandidateCalls`;
- `plannedJudgeCalls`;
- `plannedProviderCalls`;
- `judgeCallsPerCandidateCell`;
- `concurrencyLimit`;
- `byModel[]` with model ID, declared/server-qualified server, and candidate-cell count;
- `byServer[]` with server name and candidate-cell count;
- `estimate` with optional low/high minutes, confidence (`none | low | medium`), sample count, and an
  explanation when historical timing is insufficient;
- caveats covering judge work, multiple servers, concurrent evaluations, and unmeasured LMApi queue or
  model-loading time.

For deterministic/classification/tagging work, planned judge calls are zero. For grounded
summarization, count the actual configured rubric assertions (currently three passes for each of four
dimensions) per candidate cell. Pairwise remains rejected/no-op and contributes no speculative calls.

### Progress snapshot

Extend `EvaluationProgress` without removing the existing fields:

- existing `total`, `completed`, `failed`, `updatedAt` remain aliases for cell totals;
- `schemaVersion`;
- `startedAt`, optional `completedAt`, and computed/persisted `elapsedMs`;
- `cells: { total, queued, active, completed, failed }`;
- `providerCalls: { plannedCandidate, startedCandidate, completedCandidate, failedCandidate,
  plannedJudge, startedJudge, completedJudge, failedJudge, retries }`;
- `byModel: Record<modelId, RuntimeModelProgress>`;
- `byServer: Record<serverName, RuntimeServerProgress>`;
- `activeCalls: RuntimeActiveCall[]`;
- `timing: { cellsPerMinute?, providerCallsPerMinute?, etaLowMs?, etaHighMs?, estimateConfidence,
  lastProgressAt, lastHeartbeatAt }`;
- `health: { state: 'starting' | 'active' | 'slow' | 'stalled' | 'finishing' | 'terminal' |
  'unknown'; reason?: string; since?: string }`.

`RuntimeModelProgress` and `RuntimeServerProgress` contain planned/started/completed/failed candidate
counts, judge counts where applicable, retries, active count, last activity timestamps, completed-call
duration aggregates, and optional ETA range. Never infer an LMApi server when a model ID is ambiguous;
use `unknown` and state the limitation.

`RuntimeActiveCall` contains a generated correlation ID, call kind, model ID, server name when known,
started timestamp, attempt number, and non-sensitive cell correlation fields when available
(`promptId`, `testCaseId`, repetition). It must never include prompt or response text.

### Events and active-run summaries

Add:

- `EvaluationRuntimeEventType`: `run:planned`, `run:started`, `provider:started`, `provider:retry`,
  `provider:completed`, `provider:failed`, `cell:completed`, `run:slow`, `run:stalled`,
  `run:recovered`, `run:completed`, `run:failed`, `run:cancelled`, `run:interrupted`.
- `EvaluationRuntimeEvent` with monotonic sequence, event ID, evaluation ID, timestamp, type, and a
  typed metadata payload containing IDs/counts/errors but no content.
- `ActiveEvaluationSummary` with evaluation identity/name/task, status, work-plan totals, progress,
  elapsed time, ETA range, health, active models/servers, and browser paths.

Extend `EvaluationFeedback` with optional `workPlan` and the richer progress shape. Old consumers using
`progress.total/completed/failed/updatedAt` continue to work.

## Work-Plan and Estimate Calculation

### Deterministic counts

Build the work plan after test cases, prompt pins, template, purpose strategy, repetitions, and
benchmark split are resolved but before Promptfoo execution begins. Use the same matrix-building and
assertion-building inputs as execution; do not maintain a separate approximation that can drift.

Persist and expose:

- prompts × models × included cases × repetitions = candidate cells/calls;
- judge calls per cell derived from the generated assertion set;
- total planned provider calls excluding retry attempts;
- counts split by model and server.

The work plan is immutable once status becomes `running`. Retries and manual retry evaluations create
new telemetry under the new evaluation ID rather than rewriting the original plan.

### Historical estimates

Add a small runtime-estimate service that derives model/server timing samples from completed local
evaluation results. Prefer recent records matching the same server-qualified model and task; fall back
to the same model/server across tasks, then report no duration estimate when evidence is absent.

- Use robust percentiles/trimmed samples rather than a single global constant.
- Require a documented minimum sample count before `medium` confidence.
- Estimate each server lane independently, apply the configured LMEval concurrency limit, add planned
  judge work, and return a low/high range rather than one precise timestamp.
- Label model-load time, LMApi queueing, other active evaluations, retries, and cross-server contention
  as unmodelled or partially modelled.
- Never write invented zero/Infinity defaults. Unknown stays unknown.

The existing fixed Prepare-page estimate becomes the fallback only when it is clearly labelled
`rough estimate — no observed timing history`; replace it once an observed estimate is available.

### Live ETA

During execution, combine the immutable remaining work with observed completed durations and throughput.
Use a rolling window plus the full-run median to avoid wild changes from one call. Recompute at a
throttled interval, not on every filesystem read.

Suppress ETA when:

- fewer than a minimum number of comparable calls have completed;
- all recent calls failed;
- a judge phase cannot yet be estimated;
- telemetry reconciliation detects inconsistent counters.

Show the last valid range with a `low confidence` label rather than converting missing evidence into a
precise number.

## Runtime Events and Privacy

Write one JSON object per line with an increasing sequence. Events contain operational metadata only:

- evaluation/correlation IDs;
- call kind, server-qualified model, server name;
- timestamps and durations;
- retry attempt and sanitized error category/message;
- aggregate counters and health transitions.

Never record system prompts, user messages, responses, tool payloads, authorization headers, full URLs
with credentials, environment variables, or stack traces that may contain request data.

Redact/sanitize transport errors through one helper before they enter events, feedback, or structured
logs. Keep the existing detailed canonical failure artifacts where already appropriate; the telemetry
journal is not a second results store.

Cap journal growth with a configurable maximum event count or byte size. Preserve all terminal,
failure, retry, health-transition, and latest activity events; coalesce or rotate repetitive heartbeat
events. Do not delete canonical evaluation results.

## Health and Stall Classification

Health is derived, never manually set by the browser:

- `starting`: run is active but no provider call has started.
- `active`: provider/cell activity is arriving within its expected envelope.
- `slow`: an active call exceeds the recent p95-based expectation or there has been no cell completion,
  but provider heartbeats/retries remain within the configured timeout envelope.
- `stalled`: no provider lifecycle event, retry, completion, or heartbeat has occurred beyond a
  conservative threshold that accounts for the LMApi timeout and all configured retries/delays.
- `finishing`: all planned cells have completed according to Promptfoo but final result mapping,
  aggregation, or persistence is still running.
- `terminal`: completed, failed, or cancelled and reconciled.
- `unknown`: legacy/inconsistent telemetry cannot support a claim.

Expose the timeout/retry envelope used in the reason. With today's defaults, one logical call can spend
up to four 120-second attempts plus retry delays, so a two-minute model call alone must never be called
stalled. Prefer a dynamic threshold such as the larger of the configured retry envelope and a multiple
of recent p95 duration, with a small grace interval.

Do not auto-cancel. The UI presents Refresh, inspect active server state, and Cancel actions. A stalled
warning must say that it is diagnostic evidence, not proof the model process is dead.

## Persistence and Recovery

- Snapshot writes remain atomic through `FileService.writeJson`.
- Serialize event appends per evaluation so concurrent provider callbacks cannot interleave JSON lines
  or duplicate sequence numbers.
- Throttle snapshot writes to avoid excessive disk churn while guaranteeing that starts, retries,
  failures, health transitions, cancellation, and terminal state flush immediately.
- At `buildApp()` startup, inspect configs marked `running`. If no in-process controller owns the run,
  append `run:interrupted`, set health to `unknown`/interrupted, and reconcile the evaluation lifecycle
  through the existing failure/recovery policy. Do not pretend the process is still active and do not
  resume model calls automatically.
- When a terminal config and non-terminal progress disagree, terminal config wins; reconciliation writes
  a final snapshot and explanatory event.
- For legacy runs with the old four-field progress shape, synthesize cell aggregates and return unknown
  provider/model/ETA fields. Do not rewrite historical files merely by reading them.

## API Contract

### Enriched existing endpoint

`GET /api/eval/evaluations/:id/feedback` remains the canonical resumable status endpoint and returns:

- current lifecycle status;
- `workPlan` when available;
- the richer `progress` snapshot;
- validation, failures, artifact readiness, verdict, and browser paths as today.

Reading feedback must not re-run expensive model discovery on every rapid poll. Cache validation for an
immutable running configuration or separate static validation from runtime feedback so a temporarily
unavailable model catalog does not obscure persisted execution progress.

### New endpoints

- `GET /api/eval/evaluations/active` → `ActiveEvaluationSummary[]`, newest first, covering `pending`
  and `running` evaluations and optionally recent interrupted/stalled evaluations via query parameters.
- `GET /api/eval/evaluations/:id/runtime-events?after=<sequence>&limit=<n>` → a bounded page with
  `events`, `nextSequence`, and `hasMore`.

Register `/active` before `/:id` so Express does not interpret `active` as an evaluation ID. Bound
`limit`, validate `after`, and return `404` for an unknown evaluation.

Do not add a separate “logs” endpoint that returns console output. Runtime events are the stable,
machine-readable contract; application logging is a secondary sink.

### WebSocket contract

Continue broadcasting `eval:progress`, but extend its data with the snapshot sequence, candidate/judge
counts, per-model summary changes, timing, and health. Add small events for `provider:retry`,
`eval:slow`, `eval:stalled`, and `eval:recovered` only where they improve immediacy.

The browser treats WebSocket data as a fast hint and periodically/read-on-reconnect fetches feedback as
the durable truth. It must not reconstruct authoritative totals solely by replaying its in-memory event
array.

Update the checked-in OpenAPI document and typed `LMEvalClient`/frontend client in the same change as
the routes.

## Structured Application Logging

Emit concise structured log records for run start/terminal state, provider failures/retries, health
transitions, and cancellation. Include evaluation ID, correlation ID, model, server, call kind,
duration, and sanitized error category.

- Standalone mode may serialize these records to `console` in one consistent JSON shape.
- Hosted mode must use the `ApplicationLogger` supplied by HomeBase, with a child binding for LMEval and
  evaluation ID.
- Do not require operators to scrape these logs for product status; the persisted telemetry/API remains
  authoritative.
- Avoid logging every successful heartbeat at info level. Successful per-call detail belongs in the
  event journal; logs emphasize lifecycle and anomalies.

## Run Dashboard

Update the existing `/eval/run/:evalId` page rather than adding a second observability page.

### Summary strip

Show:

- cells completed/total and percentage;
- candidate calls and judge calls separately;
- retries and failures;
- elapsed time;
- ETA range with confidence/caveat, or `Not enough timing history`;
- last progress time;
- health state with a short reason.

### Per-model/server progress

Render a row/card per server-qualified model with planned, active, completed, failed, retry count,
rolling duration, and ETA when available. Group by LMApi server, because concurrent work and contention
are operational properties of the server as well as the model.

Do not claim that a queued model is “stuck.” Distinguish:

- not yet scheduled;
- active inference;
- active judging;
- retry/backoff;
- completed;
- failed.

### Active work and event history

Show a compact active-call list with model/server, candidate-versus-judge, elapsed duration, and attempt.
Provide a collapsed `Recent runtime events` panel fed by the paginated event endpoint. Errors display
sanitized messages and correlation IDs; prompt/response content remains on the existing Results/Detail
surfaces after it is available.

### Recovery behavior

- Fetch feedback on mount, periodically while active, after reconnect, and on manual Refresh.
- Merge WebSocket hints by snapshot/event sequence so an older event cannot roll progress backward.
- Stop polling at terminal status and fetch final results.
- When feedback is available but WebSocket is down, show `Live connection lost — persisted status is
  still updating` rather than implying the run is unobservable.
- Provide direct Cancel and Refresh actions. No automatic cancellation on a stall warning.

## Agent and Operator Experience

Update the typed client with helpers to list active evaluations, get rich feedback, and page runtime
events. Update `test:agent-workflow` status output to report:

- evaluation name and ID;
- configured candidate cells and judge calls;
- completed/failed/remaining counts;
- active models/servers;
- elapsed time, last progress, ETA range, and health;
- browser Run path.

This should make “what is running?” answerable with one active-runs request and “why is this taking so
long?” answerable with one feedback request plus, only when needed, recent runtime events.

## Relationship to Other Plans

- `2026-09-07-judge-qualification-and-campaign-ui.md` should consume `EvaluationWorkPlan`, enriched
  feedback, and active evaluation telemetry for each campaign phase. Its separate qualification-run
  progress remains necessary because judge qualification is not an `EvaluationConfig` run.
- The campaign implementation should not invent alternate ETA, stall, or per-model progress types.
- The cross-run Insights dashboard remains focused on completed quality and operational trends; it may
  link to active runs but should not become the live execution dashboard.
- The baseline evaluation and follow-up documents remain evidence records. They may link to this plan,
  but runtime-observability implementation belongs in `docs/TASK.md` as its own tracked work item.

## Implementation Sequence

1. **Contracts and calculations:** add work-plan/progress/event types, exact call-count calculation,
   legacy normalization, and duration/health pure functions with unit tests.
2. **Telemetry persistence:** add the runtime telemetry service, atomic snapshots, serialized/bounded
   event appends, redaction, reconciliation, and recovery tests.
3. **Provider instrumentation:** instrument candidate/judge logical calls and retries; retain Promptfoo
   progress as completed-cell truth; verify no prompt/response content reaches telemetry.
4. **Feedback and APIs:** enrich feedback, add active-runs and paginated-event routes, update OpenAPI and
   clients, and avoid repeated model-catalog validation during fast polling.
5. **Dashboard:** add summary, server/model progress, active work, health/ETA, event history, polling,
   and WebSocket reconciliation.
6. **Agent workflow and docs:** improve CLI status output and update README, specification, task list,
   and maintained workflow instructions.
7. **Controlled and live verification:** run synthetic timing/stall cases first, then a bounded real
   multi-model run when GPU capacity is available.

## Test Plan

### Unit tests

- Exact candidate/judge/provider counts for classification, tagging, ordinary judged evaluations, and
  grounded-summary median-of-three judging.
- Repetitions, benchmark split filtering, scoped retries, multiple prompts/models, and missing judge.
- Snapshot counter invariants: counts never negative, completed never exceeds planned, and terminal
  reconciliation is deterministic.
- Concurrent event append ordering and unique monotonically increasing sequences.
- Redaction rejects prompt/response/request-body fields and sanitizes transport errors.
- ETA unknown/low/medium confidence, rolling-window stability, multi-server lanes, and insufficient
  samples.
- Health transitions for starting, active, slow, stalled, recovered, finishing, terminal, and legacy
  unknown data.
- Stall threshold accounts for the configured timeout plus every retry/backoff interval.
- Legacy four-field progress and evaluations with no telemetry remain readable.

### Service and route tests

- Candidate and judge providers emit start/retry/completion/failure events with correct attribution.
- A provider failure increments provider failures; a completed response that misses an assertion does
  not become a transport failure.
- Feedback returns persisted progress when WebSocket events were missed and does not regress after a
  stale event.
- Active-runs endpoint returns only intended statuses, newest first, with correct browser paths under
  standalone and HomeBase mounts.
- Runtime-event pagination validates cursors/limits and never returns sensitive content.
- Restart/interruption and terminal reconciliation produce honest status and events without replaying
  calls.
- Model-catalog outage does not hide persisted runtime progress.
- OpenAPI contract tests cover added/extended schemas and routes.

### Frontend tests

- Summary strip renders counts, elapsed time, last progress, ETA uncertainty, and every health state.
- Candidate and judge calls cannot be conflated in labels or totals.
- Per-server/model rows distinguish queued, active, judging, retrying, completed, and failed.
- WebSocket loss falls back to polling; reconnect refreshes durable state; sequence handling prevents
  progress rollback.
- Recent-event pagination and sanitized error display work without leaking content.
- Legacy evaluations render aggregate progress and `Detailed runtime telemetry unavailable for this
  run` rather than failing.
- Terminal transition stops polling and loads results.

### Playwright scenarios

Use controlled API/provider fixtures for deterministic scenarios:

1. two simultaneous evaluations appear in the active-runs view with independent totals;
2. a six-model run advances unevenly and shows the active/queued model distinction;
3. a judged summarization run separates candidate cells from judge provider calls;
4. retry/backoff changes the active state without inflating planned calls;
5. a long call becomes slow but not stalled inside the retry envelope;
6. a genuinely stale event stream becomes stalled, then recovered;
7. refresh and WebSocket disconnect preserve accurate state;
8. cancellation and terminal failure reconcile progress and event history.

### Real runtime verification

Only after the current baseline/judge work releases the GPUs, run a bounded production-shaped matrix
through LMApi and verify:

- planned counts equal the actual matrix and configured judge calls;
- per-model/server activity matches LMApi's observable routing;
- retries and timeouts appear once with correct attempt counts;
- elapsed time and last-progress timestamps remain accurate across browser refresh;
- ETA is presented as a range and converges without being treated as a guarantee;
- cancellation records a terminal snapshot and retains partial evidence.

This smoke proves mechanics, not model calibration or promotion readiness.

## Documentation Updates During Implementation

- Add runtime telemetry, feedback, active-runs, and event contracts to `docs/SPECIFICATION.md`.
- Add a dedicated tracked item to `docs/TASK.md`; do not mark browser/live verification complete from
  unit tests alone.
- Update README's execution workflow and endpoint table.
- Update `docs/openapi/lmeval-eval-api.v1.json` with all schemas, response examples, and pagination.
- Update `.agents/skills/lmeval-evaluation-workflow/` so monitoring uses the active-runs/feedback
  contracts and reports candidate calls separately from judge calls.
- Cross-link the campaign UI plan so its monitoring implementation explicitly depends on this shared
  telemetry.

## Definition of Done

- Before Start, LMEval reports exact candidate-cell/call and judge-call counts plus an honestly caveated
  duration range when evidence exists.
- During execution, one feedback request identifies total/remaining work, active models and servers,
  retries/failures, elapsed time, last progress, ETA range, and health.
- One active-runs request answers how many evaluations are currently configured/running and their
  combined remaining workload without scanning evaluation directories manually.
- The browser remains accurate after refresh or WebSocket loss and never rolls progress backward.
- Slow and stalled are distinct, account for LMApi's timeout/retry envelope, and never trigger automatic
  cancellation.
- Telemetry persists no prompt, user-message, response, credential, or request-body content.
- Existing clients using the four original progress fields and existing result/summary endpoints remain
  compatible.
- Standalone and hosted modes use the shared composition root, correct base paths, and the appropriate
  structured logger.
- Unit, route, component, Playwright, standalone build, hosted build, and host-adapter checks pass, with
  pre-existing unrelated debt reported separately.
- A later bounded live run verifies mechanics; its evidence is not misrepresented as evaluation-quality
  or promotion evidence.
