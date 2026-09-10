# Evaluation Failure Recovery and Resume - Implementation Plan

**Date:** 2026-09-08

**Status:** Ready for implementation handoff

**Source proposal:** [`docs/plans/2026-09-08-evaluation-failure-recovery-and-resume.md`](../../docs/plans/2026-09-08-evaluation-failure-recovery-and-resume.md)

**Primary dependency:** [`docs/plans/2026-09-07-evaluation-runtime-observability.md`](../../docs/plans/2026-09-07-evaluation-runtime-observability.md)
**Scope:** Durable per-cell execution, interruption reconciliation, explicit same-evaluation resume,
structured recovery diagnostics, and candidate/judge routing parity.

## Handoff instructions

This document is the implementation plan. The source proposal explains the motivation and remains a
useful design record, but this plan resolves its open implementation choices against the current tree.

Before changing code, read these files in precedence order:

1. `README.md`
2. `docs/SPECIFICATION.md`
3. `docs/TASK.md`
4. `docs/plans/2026-09-07-evaluation-runtime-observability.md`
5. `docs/plans/2026-09-08-evaluation-failure-recovery-and-resume.md`
6. This plan

Use the documents as guides, but verify every named seam in the current working tree. Preserve
unrelated worktree changes and the Git index. Do not edit or commit the nested `data/.git` repository.
Do not mark `docs/TASK.md` complete until automated restart tests and a browser walkthrough pass.

## Outcome

For evaluations created with the new execution schema, a process stop after durable cell commits must
produce an `interrupted` evaluation. An operator can explicitly resume the same evaluation ID. The new
attempt reuses validated checkpoints, runs only unfinished logical cells, finalizes once, and retains
which attempt committed every cell.

This feature must never infer completed work from the old aggregate `progress.json` count. The known
stale run `eval-mts7kvz5-8lodnt` may be reconciled and explained, but its reported 48/240 cells cannot
be reused because no exact graded cell checkpoints exist.

## Current-state findings to preserve

- `ExecutionService.run()` currently calls Promptfoo once for the entire matrix. Promptfoo's live
  callback exposes a cumulative count, while graded rows are available only after `evaluate()` resolves.
- `cells.json` is a pending pre-run snapshot. `results.json` and `summary.json` are written only during
  final aggregation.
- `FileService.writeJson()` currently writes directly to the destination; it is not atomic despite the
  older observability proposal referring to it as atomic.
- `ExecutionService.cancel()` relies on an in-memory `AbortController`; `POST /:id/cancel` currently
  returns ambiguous `{ success, cancelled }` data when no controller is present.
- `POST /:id/retry` creates a new evaluation and identifies selected work by prompt/model/test triples,
  so repetitions are not exact. This remains a clone/retry feature, not resume.
- Candidate calls split `server::model` and use the server-pinned LMApi route. Judge scoring and judge
  qualification pass the full canonical ID to the unpinned route. Recovery must not preserve that bug.
- `buildApp()` is the shared standalone/hosted composition root. Recovery initialization must run there,
  after `configurePaths()` and before requests can start work.
- `ModelSelectionService.interruptCampaigns()` currently terminates active campaigns on restart. This
  plan does not rebuild the campaign state machine.
- Pairwise evaluation is rejected by validation in the current Promptfoo integration. Do not add
  pairwise recovery logic as part of this feature.

## Resolved design decisions

### 1. Exact Promptfoo execution unit

The first implementation MUST invoke Promptfoo once per logical work item, with exactly one prompt,
one provider, one test case, and one repetition. An LMEval-owned worker pool supplies concurrency;
each inner Promptfoo invocation uses `maxConcurrency: 1` and `cache: false`.

This is intentionally more conservative than passing a heterogeneous batch to `buildTestSuite()`.
Promptfoo builds a Cartesian product, so a multi-item batch can silently run combinations that were
not selected. A future optimization may group work only after a test proves that the group is an exact
rectangle and that result-to-cell identity remains one-to-one. Do not make that optimization in v1.

All deterministic and LLM-judge assertions still run inside Promptfoo. LMEval owns scheduling,
checkpointing, cancellation, and finalization; it does not own grading.

The maximum hard-crash replay bound is therefore the number of in-flight workers, not the full matrix.
Each worker has at most one uncommitted logical cell.

### 2. Meaning of a committed cell

A checkpoint is reusable only when Promptfoo returned exactly one complete graded row and LMEval
atomically persisted its mapped `EvalMatrixCell` plus checkpoint envelope.

- An assertion miss is a completed cell, as today (`failureReason === 1`).
- A complete Promptfoo provider-failure row is a terminal failed cell and may be checkpointed.
- A thrown Promptfoo invocation, missing/duplicate/unmappable row, checkpoint write failure, or lost
  process leaves that work item uncommitted.
- Progress is derived from the work plan plus valid checkpoints. Callback counts and provider responses
  that have not reached a checkpoint are operational telemetry only.

An evaluation can finalize with terminal failed cells, preserving current behavior. In this case its
lifecycle is `completed`, its summary reports failed cells, and promotion/campaign gates continue to
reject it. Evaluation lifecycle `failed` is reserved for an orchestration, integrity, persistence, or
finalization failure that prevents a valid terminal aggregate.

### 3. Same-ID attempts

Resume creates a new attempt under the original evaluation ID. It never edits immutable execution
inputs or clones the evaluation. Retry remains a new evaluation derived from selected terminal cells.

Use these product terms consistently:

- **Resume:** same evaluation and work plan; reuse checkpoints; run unfinished work.
- **Retry selected/failed:** new evaluation derived from selected result cells.
- **Full rerun:** new evaluation with the full selected configuration.

### 4. No hidden model calls during preflight

Resume compatibility preflight may read local artifacts and the LMApi model/server catalog. It MUST NOT
send a completion or judge probe. A successful response must truthfully describe only the remaining
planned provider calls. Route health beyond catalog presence is discovered by the resumed planned work
and recorded as a typed provider failure.

A structured-output judge diagnostic probe may be added later as an explicit operator action. It is
not part of `POST /:id/resume`.

### 5. Immutable execution snapshot

Do not re-read mutable prompt manifests, current test suites, purpose templates, or rubric templates
when resuming. At first start, persist an `execution-inputs.json` snapshot containing the exact prompt
contents/tools, resolved test cases, assertion strategy/template, inference settings, benchmark
provenance, judge policy, and resolved model references used to build Promptfoo suites.

`config.json` remains the user-facing evaluation record and carries lifecycle fields. Hash only the
normalized execution snapshot, not mutable status/timestamps. This avoids declaring the config
incompatible merely because `status` or `updatedAt` changed.

### 6. Model identity limitation

Compatibility guarantees the same canonical server-qualified identifier and server-pinned route. It
cannot guarantee identical model weights unless LMApi exposes a stable artifact digest. Persist an
optional `artifactDigest` when available, compare it when present on both sides, and surface
`MODEL_ARTIFACT_IDENTITY_UNAVAILABLE` as an informational limitation otherwise. Do not invent a digest
from the model name.

### 7. Judge qualification policy

Resume preserves the original run's judge policy; it does not strengthen it retroactively.

- If the original run was explicitly advisory because its judge was unqualified, resume remains
  advisory and may proceed with the same snapshotted judge route/settings.
- If the original plan required a qualified judge, the qualification snapshot and calibration hash
  must still satisfy that requirement.
- A changed qualification record must never silently upgrade or downgrade the original run.

### 8. Campaign boundary

V1 same-evaluation resume supports ordinary Wizard/API evaluations only. A campaign phase is controlled
by the campaign's sequential state machine, whose awaited process continuation is lost on restart.
Until campaign-aware continuation is separately implemented, resume preflight must reject an evaluation
identified as campaign protocol work with `CAMPAIGN_MANAGED_RUN`; supplemental evaluations remain
ordinary and may resume.

If current phase evaluations do not persist campaign ownership, add internal provenance when the
campaign creates them (for example `campaignContext: { campaignId, role: 'protocol-phase', task,
phase }`). Keep the public `campaignRole: 'supplemental'` meaning unchanged. Do not let a resumed phase
select a winner or advance a terminal campaign by accident.

### 9. Destructive delete is not cancellation

The recovery UI and clients must use `POST /:id/cancel`. `DELETE /:id` currently deletes the entire
evaluation directory and therefore all checkpoints; document it as destructive deletion, not abort.
As a compatibility hardening change, reject deletion of `pending`/`running` evaluations with `409`
unless the repository already has a separately specified force-delete contract. Do not silently turn
DELETE into resume-safe cancellation.

## Persisted artifacts

Each schema-v1 evaluation directory contains:

```text
evaluations/<eval-id>/
  config.json
  execution-inputs.json
  work-plan.json
  run-state.json
  attempts/
    <attempt-id>.json
  cell-results/
    <cell-id>.json
  failures.jsonl
  runtime-events.jsonl
  progress.json
  results.json
  summary.json
```

`runtime-events.jsonl` and the richer `progress.json` are delivered by the observability dependency.
If that plan has not been implemented, implement its minimal persistence/types/API subset before this
feature: monotonic events, privacy-safe failure references, enriched durable progress, feedback recovery
fields, and startup interruption events. ETA/history UI can remain in its own work item.

### Type contracts

Add shared types in `src/types/eval.ts`; continue re-exporting them from `server/types/eval.ts`.
Names may be adjusted to fit conventions, but the information and invariants are required.

```ts
type EvalStatus =
  | 'draft' | 'pending' | 'running' | 'interrupted'
  | 'completed' | 'failed' | 'cancelled';

interface ServerQualifiedModelRef {
  canonicalId: string;       // exact server::model value
  serverName: string;
  modelName: string;
  artifactDigest?: string;
}

interface EvaluationExecutionInputs {
  schemaVersion: 1;
  evalId: string;
  prompts: Array<{
    promptId: string;
    version: number;
    content: string;
    contentSha256: string;
    tools?: ToolDefinition[];
  }>;
  testCases: TestCase[];
  testCasesSha256: string;
  candidates: ServerQualifiedModelRef[];
  runsPerCell: number;
  template: EvalTemplate | null;
  purposeCategory?: PurposeCategory;
  assertionStrategy: AssertionStrategy | null;
  resolvedInference?: ResolvedInferenceParams;
  benchmarkProvenance?: BenchmarkRunProvenance;
  judge?: {
    model: ServerQualifiedModelRef;
    policy: 'qualified-required' | 'advisory-allowed';
    qualificationSnapshot?: JudgeQualification;
    gradingTemperature: 0;
  };
  promptfoo: { packageVersion: string; resultSchemaVersion: 1 };
  createdAt: string;
}

interface EvaluationWorkItem {
  ordinal: number;
  cellId: string;
  cellKey: string;
  promptId: string;
  promptVersion: number;
  promptContentSha256: string;
  model: ServerQualifiedModelRef;
  testCaseId: string;
  testCaseSha256: string;
  repetition: number;
  assertionPlanSha256: string;
  plannedJudgeCalls: number;
}

interface EvaluationWorkPlan {
  schemaVersion: 1;
  evalId: string;
  executionInputSha256: string;
  planSha256: string;
  items: EvaluationWorkItem[];
  totals: { cells: number; candidateCalls: number; judgeCalls: number };
  createdAt: string;
}

interface CellResultCheckpoint {
  schemaVersion: 1;
  evalId: string;
  planSha256: string;
  cellId: string;
  cellKey: string;
  attemptId: string;
  committedAt: string;
  cell: EvalMatrixCell;
}

type EvaluationAttemptStatus =
  | 'pending' | 'running' | 'completed'
  | 'failed' | 'cancelled' | 'interrupted';

interface EvaluationAttempt {
  schemaVersion: 1;
  attemptId: string;
  evalId: string;
  ordinal: number;
  resumedFromAttemptId?: string;
  status: EvaluationAttemptStatus;
  owner: { instanceId: string; pid?: number; token: string };
  startedAt: string;
  heartbeatAt: string;
  leaseExpiresAt: string;
  updatedAt: string;
  completedAt?: string;
  counts: {
    planned: number;
    reused: number;
    committedByAttempt: number;
    terminalFailed: number;
    remaining: number;
  };
  terminalFailureId?: string;
}

interface EvaluationRunState {
  schemaVersion: 1;
  evalId: string;
  planSha256: string;
  currentAttemptId?: string;
  lastAttemptId?: string;
  nextAttemptOrdinal: number;
  recovery: EvaluationRecovery;
  updatedAt: string;
}

type RecoveryState =
  | 'not-needed' | 'eligible' | 'finalization-only'
  | 'blocked' | 'legacy-unrecoverable';

interface EvaluationRecovery {
  state: RecoveryState;
  reasonCode?: RecoveryReasonCode;
  details?: EvaluationRecoveryCheck[];
  reusedCells: number;
  remainingCells: number;
  lastAttemptId?: string;
  requiresModelCalls: boolean;
}
```

Add `attemptId?: string` and `cellKey?: string` to `EvalMatrixCell` for new finalized records. Keep them
optional so legacy results remain readable.

### Stable identity and hashing

Create one canonical JSON hashing helper using SHA-256 and recursively sorted object keys. Array order
is preserved because prompt order and work-plan order are meaningful.

Avoid circular hashes:

1. Normalize and hash `execution-inputs.json` while excluding `createdAt`.
2. Derive each `cellKey` from execution-input hash plus prompt ID/version/content hash, canonical model
   ID, test-case ID/hash, repetition, assertion-plan hash, and judge-plan hash.
3. Derive deterministic `cellId` as `cell-` plus a sufficiently long prefix of `cellKey`; reject a
   collision instead of silently suffixing it.
4. Derive `planSha256` from schema/engine versions, execution-input hash, and the ordered full cell keys.

Never use `JSON.stringify()` over unnormalized mutable objects as an implicit compatibility contract.
Unit tests must pin hash fixtures so a later refactor cannot change identities unnoticed.

## New services and responsibilities

### `server/services/AtomicFileService.ts` or focused additions to `FileService.ts`

Add `writeJsonAtomic(path, value)`:

1. create a unique temp file in the destination directory with exclusive creation;
2. write UTF-8 JSON;
3. flush the file descriptor and close it;
4. rename it over the destination without an unlink gap;
5. best-effort flush the directory where supported;
6. clean up only that known temp file on failure.

Do not claim durability from `writeFileSync` alone. Inject or wrap filesystem operations so tests can
fail write, fsync, close, and rename stages. Never delete the old destination before rename. If the
supported Windows/Node combination cannot replace an existing file atomically, stop and document the
platform-safe replacement strategy rather than adding an unlink-then-rename window.

Use atomic writes for execution inputs, work plan, run state, attempts, checkpoints, progress, config
lifecycle transitions, results, and summary. A broad migration of unrelated stores is out of scope.

Add a corruption-aware reader returning `missing | valid | corrupt` for recovery artifacts; retain the
existing `readJson()` behavior for legacy callers.

### `server/services/ServerQualifiedModelService.ts`

Provide one parser/resolver for candidate providers, judge providers, qualification, validation, and
resume preflight.

- Split on the first `::` and require non-empty server and model components.
- Preserve the exact canonical ID for display/provenance.
- Candidate and judge calls use `chatCompletionOnServer({ model: modelName, ... }, serverName)`.
- Malformed IDs fail before any provider call with `MODEL_ID_INVALID`.
- Catalog resolution reports `MODEL_ROUTE_UNAVAILABLE` with requested canonical ID and resolved parts.

Refactor `PromptfooAdapter.buildLmapiProvider()`, `buildJudgeProvider()`, and
`JudgeQualificationService.qualify()` to use it. Add qualification route provenance/settings hashes to
new `JudgeQualification` records as optional fields for legacy compatibility.

### `server/services/EvaluationPlanService.ts`

Own snapshot creation, exact work-plan creation, canonical hashes, schema validation, and compatibility
checks. It must be the only source of work-item counts used by the scheduler and resume feedback.

Resolve mutable source material once before status becomes `running`; persist snapshot and work plan
before the first attempt/provider call. If either write fails, leave the evaluation `failed` with zero
provider calls and a typed persistence failure.

### `server/services/EvaluationCheckpointService.ts`

Own checkpoint validation, atomic commit, scan, and deterministic result ordering.

- Validate filename, envelope IDs, plan hash, cell key, and cell identity.
- Reject duplicate logical identities even if filenames differ.
- Return all integrity failures in one scan when possible.
- Derive committed, terminal-failed, and remaining counts from validated checkpoints.
- Never quarantine, rewrite, or delete a corrupt checkpoint automatically.
- Serialize commit/count updates per evaluation inside the supported single-process deployment.

### `server/services/EvaluationAttemptService.ts`

Own attempt acquisition, heartbeat/lease, cancellation markers, terminal transitions, and startup
reconciliation.

Generate an `instanceId` when the application initializes, not at module import. Acquisition is guarded
by an evaluation-scoped in-memory mutex plus an atomic run-state transition. The supported contract is
one LMEval service per data root; do not imply this is a distributed lock.

Use a lease duration comfortably greater than the heartbeat interval. Heartbeats must continue while a
provider call is active, not only between cells. A current, unexpired foreign owner returns
`409 EVALUATION_ALREADY_RUNNING`. On startup, no controller from a previous process can exist; a
`running` attempt whose owner is not this process becomes `interrupted` after validation. Startup never
calls LMApi.

### Recovery orchestration (implemented inside `server/services/DurableExecutionService.ts`)

The shipped implementation folds legacy classification, preflight, resume orchestration, and
finalization-only recovery into `DurableExecutionService.resume()` rather than a standalone
`EvaluationRecoveryService.ts`. This is an accepted consolidation, not a gap: the responsibilities
below are all present, just co-located with the rest of the durable execution scheduler.

Preflight returns every check, not only the first failure. Stable reason codes (all enforced):

- `ACTIVE_OWNER`
- `ALREADY_COMPLETE`
- `LEGACY_NO_CHECKPOINTS`
- `EXECUTION_INPUT_MISMATCH`
- `PLAN_HASH_MISMATCH`
- `CHECKPOINT_CORRUPT`
- `CHECKPOINT_SCHEMA_UNSUPPORTED`
- `PROMPTFOO_SCHEMA_UNSUPPORTED`
- `MODEL_ROUTE_UNAVAILABLE`
- `MODEL_ARTIFACT_MISMATCH`
- `JUDGE_POLICY_MISMATCH`
- `JUDGE_QUALIFICATION_STALE`
- `CAMPAIGN_MANAGED_RUN`
- `NO_UNFINISHED_WORK`

Catalog unavailability should return a retryable preflight failure such as `MODEL_CATALOG_UNAVAILABLE`,
not mutate checkpoints or the attempt.

### `server/services/EvaluationFailureService.ts`

Persist metadata-only structured failures and append references to runtime events. Each failure records:

- failure/evaluation/attempt IDs and timestamp;
- stage (`preflight`, `model-resolution`, `candidate-provider`, `judge-provider`, `promptfoo`,
  `assertion`, `checkpoint`, `aggregation`, `indexing`, `cancellation`, or `recovery`);
- scope (`run`, `cell`) and optional exact cell ID;
- stable code, sanitized message, error class, retriable flag, and retry ordinal;
- canonical model, resolved server/model, and `candidate | judge` role;
- available HTTP status, LMApi code, timeout/cancellation/finish reason;
- response-content presence/length, reasoning presence/length, and parse outcome, never raw content;
- optional causal failure ID.

Serialize JSONL appends per evaluation. Reuse the observability redaction helper. Keep `error.json` as a
small backward-compatible terminal summary pointing to the durable failure ID.

## ExecutionService refactor

Split the current monolithic `run()` into explicit stages. As implemented, this lives in a new
`server/services/DurableExecutionService.ts` (with `ExecutionService` reduced to thin delegating
shims for `start`/`resume`/`cancel`/`reconcileOnStartup`/`dispose`):

```ts
prepare(evalId): Promise<{ config, inputs, plan, attempt }>
start(evalId): Promise<EvaluationAttempt>       // prepare() + fire-and-forget execute()
resume(evalId): Promise<ResumeEvaluationResponse>
execute(evalId, attemptId): Promise<void>        // worker pool over executeCell()
executeCell(evalId, config, inputs, plan, item, attemptId, controller): Promise<void>
finalize(evalId, attemptId, config, inputs, plan): Promise<EvaluationSummary>
cancel(evalId): CancellationResult | null
dispose(): Promise<void>
```

(`reconcileOnStartup()` lives on `EvaluationAttemptService`, since it operates purely on
attempt/run-state files and doesn't need the execution scheduler.)

### Initial start

1. Re-read a `pending` config and acquire the evaluation mutex.
2. Resolve test cases, prompt pins/content, purpose/template/assertion data, inference defaults,
   benchmark split/provenance, candidate routes, and judge policy.
3. Persist normalized execution inputs and exact work plan atomically.
4. Create attempt 1 and run state; transition config to `running` atomically.
5. Register controller, start heartbeat, and return control to the route with `202`.
6. Execute missing work through the worker pool.

The route should not return `202` until the immutable plan and attempt ownership are durable. Preserve
the existing draft-start conflict guard, but make durable attempt acquisition the authoritative guard.

### Worker pool

- Queue work items in persisted ordinal order.
- Skip every validated committed checkpoint.
- Start at most `EVAL_CONCURRENCY` workers.
- Pass the attempt AbortSignal through Promptfoo and into LMApi fetches. Extend `LmapiClient` methods to
  accept a parent signal and combine it with timeout cancellation; cancellation must not wait for the
  full 120-second timeout when the caller aborts.
- Each worker builds a one-cell suite from the immutable snapshot, calls Promptfoo, requires exactly one
  mapped row, atomically commits it, then emits durable progress/runtime events.
- Stop dequeuing immediately after cancellation, lease loss, integrity failure, or checkpoint failure.
- Await/settle already in-flight workers before writing the attempt terminal state.

Do not reuse the current `narrowForCellFilter()`/triple allow-list for resume. It remains only for the
new-evaluation retry flow until that flow is separately upgraded to repetition-aware selection.

### Finalization

Finalization is a zero-provider-call, idempotent function:

1. Acquire the evaluation mutex.
2. Revalidate plan, snapshot, and every checkpoint.
3. Require exactly one valid checkpoint for every work item.
4. Order `EvalMatrixCell[]` by work-plan ordinal.
5. Recompute pairwise compatibility data only if supported by the original snapshot (currently false).
6. Call `SummaryService.computeSummary()` using snapshotted inputs.
7. Atomically write `results.json`, then `summary.json`.
8. Validate both artifacts by reading them back.
9. Mark attempt and config terminal.
10. Update session run metadata and the Insights index once.
11. Emit terminal runtime/WebSocket events.

Move `recordEvaluation()` after aggregate validation. Make its write-through idempotent by evaluation ID.
An indexing failure is recorded but does not invalidate canonical results; feedback must distinguish
`resultsReady` from `indexReady`.

If all checkpoints exist but aggregates do not, recovery state is `finalization-only`. Resume performs
steps 1-11 without starting a worker or calling LMApi.

## Cancellation and shutdown

Change `POST /api/eval/evaluations/:id/cancel` to return a typed `202` result:

```json
{
  "state": "cancellation-requested",
  "evaluationId": "eval-...",
  "attemptId": "attempt-...",
  "controllerOwned": true,
  "durablyCommitted": 48,
  "remaining": 192
}
```

If no controller exists and ownership is stale, reconcile to `interrupted` and return
`state: "reconciled-interrupted"`, `controllerOwned: false`. Do not claim that a provider request was
aborted. If the evaluation is already terminal, return `409 EVALUATION_NOT_ACTIVE` with recovery state.

On graceful application disposal, stop accepting new attempts, signal active attempts, wait within the
host's grace window, and mark unfinished attempts interrupted. Update `buildApp().dispose()` and hosted
`getActiveWork()` to use durable attempt state plus live controllers. A hard process kill is handled by
startup reconciliation.

## API contract

### `POST /api/eval/evaluations/:id/resume`

Request body is empty in v1. The route:

- returns `202 Accepted` only after preflight passes and the new attempt is durable;
- returns `404 EVALUATION_NOT_FOUND` for unknown IDs;
- returns `409 EVALUATION_ALREADY_RUNNING` for a live owner;
- returns `409 RESUME_INCOMPATIBLE` with all failed checks for integrity/input/policy drift;
- returns `409 EVALUATION_NOT_RESUMABLE` for completed, legacy-unrecoverable, campaign-managed, or
  no-unfinished-work cases.

Response:

```json
{
  "evaluationId": "eval-...",
  "attemptId": "attempt-...",
  "resumedFromAttemptId": "attempt-...",
  "mode": "execute-remaining",
  "counts": { "total": 240, "reused": 48, "remaining": 192, "inFlightLimit": 8 },
  "preflight": { "compatible": true, "checks": [] },
  "browserPaths": { "run": "/eval/run/eval-...", "results": "/eval/results/eval-..." }
}
```

Use `mode: "finalization-only"` and `remaining: 0` where appropriate.

### Feedback

Extend `GET /:id/feedback` with optional attempt/recovery data while preserving existing fields:

```json
{
  "attempt": {
    "currentAttemptId": "attempt-...",
    "attemptCount": 2,
    "status": "running"
  },
  "recovery": {
    "state": "eligible",
    "reasonCode": null,
    "reusedCells": 48,
    "remainingCells": 192,
    "lastAttemptId": "attempt-...",
    "requiresModelCalls": true
  }
}
```

For running immutable evaluations, feedback must not call live validation/model discovery on every poll.
Return snapshotted validation plus separately labelled current route health where requested. A catalog
outage must not hide persisted progress.

### Route ordering and clients

Register fixed routes such as `/active` before `/:id`. Add typed client helpers in `src/api/eval.ts` and
the agent client/workflow script. Update `docs/openapi/lmeval-eval-api.v1.json` in the same phase as the
route, including reason codes and legacy examples.

## UI behavior

Update the existing `src/pages/DashboardPage.tsx`; do not create a second recovery page.

- Fetch durable feedback on mount, periodically while active, after WebSocket reconnect, and on Refresh.
- Treat WebSocket events as hints ordered by sequence; never roll checkpoint counts backward.
- Show `interrupted`, current/last attempt, durably committed/remaining counts, and a concise reason.
- Show Resume only when `recovery.state` is `eligible` or `finalization-only`.
- Require a confirmation that states reused cells, remaining model work, and possible replay of previously
  uncommitted in-flight calls.
- Distinguish Resume, Retry failed cells, and Full rerun in labels/help text.
- After resume returns `202`, remain on the same `/eval/run/:id` route and refresh feedback.
- For `LEGACY_NO_CHECKPOINTS`, disable Resume and offer Full rerun; preserve the old progress count as
  diagnostic text only.
- For checkpoint corruption or plan mismatch, disable Resume, list the reason code/correlation ID, and
  do not offer a destructive “repair” action.
- On WebSocket loss, say persisted status is still available; do not imply execution stopped.
- Only navigate to Results when final aggregate readiness is true, not merely when config is terminal.

**As implemented:** the confirmation step is an in-panel `role="alertdialog"` owned by
`RecoveryPanel` (focus moves into it on open, Escape/Cancel return focus to the Resume button) —
not `window.confirm()` — and `RecoveryPanel` maps each `RecoveryReasonCode` to a short
human-readable sentence alongside the raw code, rather than showing the raw code alone. The
"never roll checkpoint counts backward" rule is enforced in `useEvalSocket.ts`, which tracks the
maximum `completedCells` seen from `eval:progress` events and ignores any lower value from a
replayed or out-of-order delivery; the recovery panel's reused/remaining counts themselves come
only from REST `feedback` polls, which are always a fresh authoritative snapshot.

Likely component changes:

- `src/pages/DashboardPage.tsx` and CSS
- `src/components/dashboard/EvalSummaryBar.tsx`
- `src/components/dashboard/ConnectionLostBanner.tsx`
- `src/components/dashboard/ErrorPanel.tsx`
- new focused `RecoveryPanel.tsx` and tests

Keep the Wizard's current visual language and accessible button/dialog semantics.

## File-by-file change map

### Shared contracts

- `src/types/eval.ts`: statuses, snapshot/work-plan/checkpoint/attempt/recovery/failure/API types.
- `server/types/eval.ts`: continue re-export; do not fork server-only copies.
- `src/types/lmapi.ts`: only add route/artifact metadata if LMApi already returns it.

### Backend implementation

- `server/services/FileService.ts`: atomic JSON primitive and corruption-aware read, or delegate to a
  new focused atomic-file module.
- `server/services/ServerQualifiedModelService.ts` (new): canonical parser/resolver.
- `server/services/EvaluationPlanService.ts` (new): immutable snapshot, plan, hashes, compatibility.
- `server/services/EvaluationCheckpointService.ts` (new): checkpoint commit/scan/order; also
  differentiates `CHECKPOINT_SCHEMA_UNSUPPORTED` from generic `CHECKPOINT_CORRUPT`.
- `server/services/EvaluationAttemptService.ts` (new): owner, lease, heartbeat, lifecycle, and
  `reconcileOnStartup()`.
- `server/services/DurableExecutionService.ts` (new, supersedes the planned standalone
  `EvaluationRecoveryService.ts`): prepare/execute/finalize/cancel/resume, including reconciliation,
  preflight, and finalization-only recovery.
- `server/services/EvaluationFailureService.ts` (new): typed metadata-only failures.
- `server/services/ExecutionService.ts`: reduced to thin delegating shims over
  `DurableExecutionService` (`start`/`resume`/`cancel`/`reconcileOnStartup`/`dispose`).
- `server/services/PromptfooAdapter.ts`: build a suite from one snapshotted item; exact result mapping;
  common candidate/judge model routing.
- `server/services/LmapiClient.ts`: parent AbortSignal propagation and typed transport metadata/errors.
- `server/services/JudgeQualificationService.ts`: common server-pinned judge route and optional provenance
  fields; preserve asynchronous run behavior.
- `server/services/EvaluationFeedbackService.ts`: checkpoint-derived progress and recovery fields; legacy
  normalization; no rapid-poll catalog dependency.
- `server/services/EvaluationService.ts`: durable start boundary and immutable started config rules.
- `server/services/InsightsIndexService.ts`: idempotent post-finalization indexing.
- `server/services/ModelSelectionService.ts`: persist protocol-phase ownership and reject ordinary resume;
  do not implement campaign continuation in this feature.
- `server/routes/evaluations.ts`: resume endpoint, typed cancellation, active-delete guard, route errors.
- `server/index.ts`: startup reconciliation and non-noop disposal.
- `server/host/adapter.ts`: durable active-work reporting and graceful disposal behavior.
- `server/ws.ts`: new interruption/resume/finalization events only if not already supplied by observability.

### Frontend and agent surface

- `src/api/eval.ts`: typed resume/cancel/feedback helpers; remove direct raw fetches from Dashboard.
- `src/pages/DashboardPage.tsx` and dashboard components: feedback-first recovery UI.
- `scripts/test-agent-workflow.ts`: show attempt, durable counts, recovery eligibility, and browser path.
- `.agents/skills/lmeval-evaluation-workflow/`: update only after the contract is implemented and verified.

### Documentation

- `docs/openapi/lmeval-eval-api.v1.json`: schemas/routes/error examples.
- `README.md`: lifecycle, Resume vs Retry vs delete, endpoint table, operational caveats.
- `docs/SPECIFICATION.md`: authoritative persisted model, lifecycle, exact execution unit, legacy policy.
- `docs/TASK.md`: add/track this feature; mark items only with evidence.

## Implementation phases

Each phase should be a reviewable commit-sized change. Keep legacy evaluations readable throughout.

### Phase 0 - Dependency and baseline gate

- Determine which runtime-observability pieces are already implemented.
- Add the missing minimal shared telemetry contracts needed by this feature; do not duplicate types.
- Capture focused baseline test/build/lint results and note unrelated existing failures.
- Add `docs/TASK.md` entry as in progress, not complete.

Exit gate: current evaluations still start, complete, and render before schema-v1 execution is enabled.

### Phase 1 - Atomic persistence, schemas, and stable hashes

- Add atomic JSON and corruption-aware reads.
- Add shared types and canonical hashing.
- Add execution snapshot and exact work-plan generation without changing execution yet.
- Add fixture-based identity/hash tests and legacy classification tests.

Exit gate: a planned evaluation produces deterministic artifacts with zero provider calls, and repeated
planning of the same normalized inputs produces identical cell keys/plan hash.

### Phase 2 - Unified routing and cancellable transport

- Add the server-qualified model service.
- Refactor candidate, judge, and qualification providers to the same server-pinned route.
- Propagate parent abort signals through retry/backoff and fetch timeout handling.
- Add route parity, abort, timeout, and sanitized-error tests.

Exit gate: candidate, judge grading, and qualification tests assert the identical resolved server/model
pair; abort prevents further retries.

### Phase 3 - Checkpointed exact-item execution

- Add checkpoint and attempt services.
- Replace whole-matrix `evaluate()` with the outer worker pool and one-cell Promptfoo invocations.
- Persist only fully graded rows; derive progress from checkpoints.
- Retain Promptfoo assertions and current scoring semantics.
- Make finalization idempotent and move indexing after artifact validation.

Exit gate: a normal run produces the same logical results/summary shape as before, every final cell has
attempt provenance, and no Promptfoo invocation contains an unintended Cartesian combination.

### Phase 4 - Interruption reconciliation and resume API

- Add startup reconciliation, preflight, finalization-only path, and explicit resume.
- Add typed cancellation and graceful shutdown.
- Add legacy and campaign-managed policies.
- Extend feedback, active-work reporting, OpenAPI, and clients.

Exit gate: crash/restart integration tests prove committed cell IDs are never called again and two
simultaneous resumes cannot both acquire ownership.

### Phase 5 - Recovery UI and operator workflow

- Add feedback polling/sequence reconciliation and RecoveryPanel.
- Add Resume/Retry/Rerun explanations and legacy/integrity states.
- Update agent workflow status output.
- Add component and Playwright coverage in standalone and hosted base paths.

Exit gate: browser refresh, WebSocket disconnect, interruption, resume, and finalization-only flows are
accurate from durable state.

### Phase 6 - Documentation and live bounded verification

- Reconcile README, specification, task list, OpenAPI, and the LMEval evaluation skill.
- Run a bounded real LMApi evaluation only when local inference capacity is available.
- Stop the service after committed work, restart, resume, and audit provider calls/checkpoints.
- Clearly label the smoke as execution-mechanics evidence, not quality or promotion evidence.

Exit gate: all Definition of Done items have evidence and documentation matches the shipped behavior.

## Verification matrix

### Unit tests

- Canonical hash stability, meaningful-field sensitivity, timestamp/status exclusion, and collision guard.
- Cell identity includes prompt version/content, server-qualified model, test-case hash, repetition,
  assertion plan, judge plan, and execution-input hash.
- Atomic write success and injected failure at write/fsync/close/rename; no partial destination exposure.
- Corrupt/mismatched/duplicate checkpoint reporting without mutation.
- Checkpoint counts never go negative or exceed plan totals.
- Exact scheduler selection preserves repetition and skips only validated committed cells.
- One-cell Promptfoo result mapping rejects zero, multiple, or mismatched rows.
- Assertion miss vs provider failure vs orchestration failure classification.
- Candidate/judge/qualification canonical route parity.
- Parent cancellation interrupts active fetch and retry backoff.
- Redaction removes secrets, prompts, responses, request bodies, and unsafe URL data.
- Finalization produces deterministic ordering and is idempotent across attempts.
- Legacy configs/results remain readable and receive `LEGACY_NO_CHECKPOINTS` where appropriate.

### Service and route tests

- Initial start persists snapshot, plan, attempt, and owner before the first mocked provider call.
- Planning/checkpoint failure before provider dispatch produces a typed failure and zero calls.
- Kill after N committed cells, reconcile, resume, and assert those cell keys receive no more calls.
- Kill during N in-flight cells and prove only uncommitted in-flight items may replay.
- Cancel between cells and during provider work; settle workers and retain checkpoints.
- Interrupt after final checkpoint but before results/summary; finalization-only resume makes zero calls.
- Concurrent resume requests return one `202` and one `409`.
- Expired/missing owner becomes interrupted; a live owner remains running.
- Config lifecycle/timestamp changes do not fail compatibility; execution input changes do.
- Catalog outage reports retryable preflight state without hiding progress.
- Advisory-unqualified judge resumes advisory; qualified-required drift blocks resume.
- Campaign protocol phase is rejected; supplemental evaluation is allowed.
- Completed evaluation, no unfinished work, corrupt checkpoint, unsupported schema, and artifact mismatch
  each return their documented code.
- Cancellation response never claims an absent controller was aborted.
- Active DELETE is rejected and POST cancel preserves the directory.
- Results/summary read-back precedes one idempotent Insights index write.
- Feedback does not call model discovery during ordinary polling of an immutable active run.
- OpenAPI contract test covers the endpoint, statuses, schemas, and examples.

### Frontend tests

- Every lifecycle/recovery state renders appropriate copy and action availability.
- Resume confirmation reports reused, remaining, and possible in-flight replay counts.
- Successful resume keeps the same evaluation route and refreshes attempt data.
- Sequence handling prevents stale WebSocket data from reducing durable progress.
- Results navigation depends on artifact readiness.
- Legacy and corrupt runs do not expose an enabled Resume action.
- Resume, Retry, Full rerun, Cancel, and Delete terminology never overlaps.
- Keyboard/focus behavior and accessible names pass for the confirmation interaction.

### Playwright and process tests

Use deterministic fake providers for crash tests; do not depend on GPU timing.

1. Start a multi-cell run, wait for committed checkpoints, terminate the server process, restart, and
   observe `interrupted` with exact counts.
2. Resume and assert no provider log entry repeats a committed cell key.
3. Terminate during active workers and assert replay is bounded by the prior in-flight worker count.
4. Terminate between final checkpoint and aggregate write; resume finalizes without provider calls.
5. Disconnect WebSocket and refresh the browser; durable feedback stays accurate.
6. Run the lifecycle under standalone `/` and hosted `/lmeval/` paths.
7. Cancel with and without a current controller and verify honest UI/API state.
8. Attempt a campaign protocol-phase resume and verify the explicit managed-run rejection.

**As implemented / remaining follow-up:** items 2 (finalization-only resume), 3 (partial legacy vs.
blocked-checkpoint rendering), and 7 (honest cancel with/without a controller) are covered by
`tests/e2e/recovery.spec.ts` against the real dev server with `page.routeWebSocket()` forcing the
WS closed for the cancel scenario. Items 1, 3 (true crash bound), and 4 require killing and
restarting the actual OS process mid-run; that guarantee is instead proven at the service level in
`server/services/__tests__/EvaluationRecoveryServices.test.ts` (execute one cell, discard and
reconstruct `EvaluationAttemptService`, call `reconcileOnStartup()`, then `resume()` and confirm the
already-committed cell key is never re-dispatched). A genuine kill-the-server-process Playwright
test remains unimplemented — this repo has no existing process-lifecycle test harness to build one
on top of, and building that harness was treated as out of scope for this pass.

### Standard repository verification

Run at minimum:

```text
npm.cmd run test
npm.cmd run lint
npm.cmd run build
npm.cmd run build:hosted
npm.cmd run build:host
npm.cmd run test:e2e-ui -- <focused recovery spec>
git diff --check
```

Report pre-existing unrelated failures separately. A typecheck/unit-only result is not sufficient for
the UI or restart behavior.

## Migration and rollout

- New schema applies only to evaluations first started after deployment.
- Do not rewrite historical evaluation directories during startup or read.
- Completed legacy evaluations with valid results/summary remain unchanged.
- Legacy failed runs with valid result cells retain clone/retry behavior.
- Legacy stale runs with only aggregate progress become `legacy-unrecoverable`; their count is diagnostic
  only and a Full rerun is required.
- Gate schema-v1 execution behind an internal constant or configuration flag during Phases 1-3 if needed,
  but remove the flag or document its operational default before completion.
- Never auto-delete temp/corrupt canonical artifacts during migration. Cleaning uniquely named abandoned
  atomic-write temp files may be a separate bounded maintenance step after age/path validation.

Rollback is code-only: old readers ignore new optional type fields and extra artifacts. Do not roll back
by deleting checkpoints. If schema-v1 execution is disabled after deployment, leave affected runs
interrupted and explain that a compatible version is required to resume.

## Explicit deferrals

- Exactly-once inference across a hard process failure.
- Multiple LMEval processes sharing one data root or distributed locking.
- Automatic startup resume.
- Recovery of old callback counts without exact checkpoints.
- Campaign state-machine continuation after restart.
- Pairwise/select-best support.
- Model-weight identity when LMApi supplies no artifact digest.
- Automatic repair/quarantine/deletion of corrupt checkpoints.
- Changing statistical gates, benchmark review policy, judge rubric, or promotion rules.

## Definition of Done

- Before provider work, every new evaluation has atomically persisted immutable execution inputs, an
  exact work plan, and a durable owned attempt.
- Every resumable cell is a validated, atomically committed, fully graded checkpoint.
- After hard stop/restart, startup reconciliation marks a stale owner interrupted without model calls.
- Feedback reports exact durable reused/remaining counts and structured recovery eligibility.
- Explicit resume keeps the evaluation ID, creates a new attempt, and never calls providers for a
  committed cell key.
- Crash replay is bounded by the previously in-flight worker count.
- Finalization-only recovery performs zero provider calls and is idempotent.
- Candidate, judge grading, and judge qualification use the same canonical parser and server-pinned route.
- Cancellation, interruption, provider failure, assertion miss, checkpoint failure, and aggregation
  failure remain distinct in persisted diagnostics and UI copy.
- No prompt, user message, response, tool payload, credential, or request body appears in failure or
  runtime journals.
- Partial checkpoints never enter Insights, gates, campaign recommendations, leaderboards, baselines,
  exports, or promotion records.
- Legacy evaluations remain readable and are never assigned fabricated completed cell identities.
- Campaign protocol phases cannot be resumed outside the campaign orchestrator.
- Standalone and hosted modes run the same reconciliation through the shared composition root and use
  correct browser/WebSocket base paths.
- Unit, route, component, process-restart, Playwright, standalone, hosted, and host-adapter verification
  passes, with unrelated debt reported rather than concealed.

## Implementation handoff checklist

- [ ] Read the authoritative documents and inspect current worktree/index state.
- [ ] Record baseline verification and unrelated failures.
- [ ] Implement phases in order; do not start with UI.
- [ ] Keep Promptfoo as the grading engine.
- [ ] Use one exact logical item per Promptfoo call in v1.
- [ ] Derive recovery from checkpoints, never progress callbacks.
- [ ] Make all resume actions explicit and same-evaluation.
- [ ] Make preflight read-only with respect to model inference.
- [ ] Preserve advisory judge policy and promotion safeguards.
- [ ] Keep campaign protocol runs outside ordinary resume.
- [ ] Verify crash/restart behavior in both deployment modes.
- [ ] Update authoritative docs only to match verified implementation.
