# Evaluation Failure Recovery and Resume

**Date:** 2026-09-08  
**Status:** Implemented — see
[`plans/features/2026-09-08-evaluation-failure-recovery-and-resume.md`](../../plans/features/2026-09-08-evaluation-failure-recovery-and-resume.md)
for the as-built architecture and any known follow-ups. This document remains the original design
record of the motivation and reasoning; it is not kept in sync with implementation detail.  
**Scope:** Execution durability, failure diagnostics, stale-run reconciliation, and explicit resume  
**Depends on:** [`2026-09-07-evaluation-runtime-observability.md`](2026-09-07-evaluation-runtime-observability.md)

## Purpose

Make an interrupted evaluation resumable from its last durably graded cell instead of rerunning the
full matrix, while making failures precise enough to distinguish model/provider faults, judge-routing
faults, assertion failures, checkpoint failures, and loss of the process that owned the run.

This plan is documentation only. It does not authorize implementation or changes to existing run
data.

## What the recent failures taught us

### The stalled matrix was not merely missing a progress message

The classification evaluation `eval-mts7kvz5-8lodnt` reached an aggregate progress count of 48 out of
240 cells and then remained `running` while LMApi reported no active request. Its cancel request could
not find an in-memory controller. That demonstrates three separate state problems:

1. `config.json` can say `running` after the process or service instance that owned the run is gone.
2. `progress.json` records only a count. It does not identify which prompt/model/test/repetition work
   items completed.
3. Promptfoo's graded rows are currently converted and saved only after the complete `evaluate()` call
   returns. `cells.json` therefore still has every cell as pending and `results.json` may not exist,
   even though provider work was completed.

The value `48` is operational evidence, not recoverable evaluation evidence. Promptfoo may execute
cells concurrently, so treating the first 48 planned cells as complete would fabricate provenance.
The existing run cannot be resumed safely from cell 49.

### The current retry endpoint is a clone-and-rerun mechanism

The retry route can narrow a new evaluation to selected or failed result triples when a completed
`results.json` exists. With neither an explicit selection nor trustworthy failed results, it clones
the configuration and reruns the full matrix. It also filters by prompt/model/test-case triples, which
does not uniquely identify repetitions.

That behavior is useful for retrying known failures, but it is not process-crash recovery and should
not be presented as resume.

### Progress and durable completion are different facts

The installed Promptfoo version exposes an `afterEach` extension hook, but catches hook failures and
continues the evaluation. A hook can enrich live observability, but cannot be the only correctness
boundary for recovery. Likewise, the current `writeJson` helper writes directly to the destination;
a process failure can leave a partially written JSON file.

Resume must be based only on fully graded, atomically committed cell results—not a callback count, a
provider response, or a best-effort extension hook.

### Judge failures exposed inconsistent routing

Candidate execution splits a canonical `server::model` identifier and calls the selected LMApi server.
Judge qualification and judge scoring currently pass the full identifier through a different route.
The tested Qwen judge could answer when called through local Ollama and through LMApi's server-pinned
route, while qualification failed before its first scored call.

Failure records therefore need to capture the stage and resolved route, and every model role must use
one server-qualified model resolver. A generic message such as “no provider hosts model” is not enough
when the model is present and the defect is routing.

## Relationship to runtime observability

The runtime-observability plan remains the design for work plans, live events, active-call telemetry,
ETA, and stalled-run presentation. This plan adds the durable correctness layer beneath it:

- Runtime events answer “what appears to be happening now?”
- Cell checkpoints answer “what completed and can be reused?”
- Execution attempts answer “which process invocation produced or retried the work?”
- Recovery reconciliation answers “does a live owner still exist?”

The observability plan's rule that an orphaned run must not automatically replay remains in force.
This plan adds an explicit, operator-initiated resume after compatibility and ownership checks.

## Goals

- Persist each fully graded logical cell before considering it resumable.
- Resume only missing or explicitly retryable work items under the original evaluation ID.
- Bound duplicate provider work after a hard crash to the uncommitted in-flight batch.
- Preserve attempt boundaries and routing provenance in final results.
- Reconcile stale `running` state after service restart or controller loss.
- Give API and UI clients a structured explanation of failure, recovery eligibility, and remaining
  work.
- Keep incomplete or resumed-partial data out of promotion and Run History metrics until finalization
  succeeds.
- Use Promptfoo for evaluation and assertions; do not reintroduce a separate grading engine.

## Non-goals

- Exactly-once provider inference across process failure. LMApi/Ollama do not provide a durable
  idempotency contract, so an uncommitted in-flight call may run again.
- Automatically resuming work at startup.
- Recovering response or assertion data that was never persisted by an older run.
- Treating partial checkpoints as a statistically valid benchmark or promotion result.
- Distributed scheduling across multiple LMEval instances sharing one data directory.
- Changing benchmark thresholds, judge rubrics, or promotion rules.

## Core invariants

1. The evaluation configuration and original work plan are immutable after the first attempt starts.
2. Each logical work item has a stable identity including prompt version, canonical server-qualified
   model ID, test case ID, repetition index, and evaluation-plan hash.
3. A cell is reusable only after its provider response, Promptfoo grading result, assertions, timing,
   and provenance have been atomically committed.
4. Aggregate counters are derived from the durable work plan and checkpoints. They are not the source
   of truth.
5. A resume never silently changes prompts, cases, assertions, model routing, judge, judge
   qualification, inference settings, or engine compatibility.
6. Only one execution attempt may own an evaluation at a time.
7. Resume is explicit. Startup reconciliation may mark an orphan as interrupted, but must not call a
   model.
8. Insights, comparison, and promotion consume only a successfully finalized evaluation.

## Proposed persisted model

Each evaluation directory gains the following durable artifacts:

```text
evaluations/<eval-id>/
  config.json                    # immutable execution inputs plus lifecycle status
  work-plan.json                 # immutable ordered logical cells and plan hash
  run-state.json                 # current owner/lease, attempt, counts, and recovery state
  attempts/
    <attempt-id>.json            # immutable identity plus mutable attempt lifecycle
  cell-results/
    <cell-id>.json               # one atomically committed, fully graded result
  failures.jsonl                 # append-only structured failure records
  runtime-events.jsonl           # best-effort operational telemetry from observability plan
  results.json                   # finalized ordered aggregate, written only after all cells commit
  summary.json                   # finalized statistics and gates
```

`work-plan.json` is created once before provider calls. It contains, for every work item:

- stable `cellId` and `cellKey`;
- prompt ID and immutable version/content hash;
- canonical `server::model` ID and resolved server/model components;
- test case ID and immutable case hash;
- repetition index;
- assertion-plan hash;
- judge-plan hash when applicable;
- overall `planHash`, LMEval schema version, and Promptfoo compatibility version.

The first implementation may preserve the existing generated cell ID, provided it is persisted once
and reused. `cellKey` must be deterministically derived from the immutable fields and used to reject
mismatched checkpoints.

### Execution attempts

Resume creates a new attempt inside the same evaluation rather than cloning a second evaluation. A
final result may therefore combine cells committed by multiple attempts while retaining provenance.

An attempt record includes:

- `attemptId`, ordinal, and `resumedFromAttemptId`;
- status: `pending`, `running`, `completed`, `failed`, `cancelled`, or `interrupted`;
- owner instance ID, process ID where meaningful, heartbeat, and lease expiry;
- start, last-update, and terminal timestamps;
- planned, committed, failed, skipped-as-complete, and remaining counts;
- terminal failure reference when applicable.

Evaluation status adds `interrupted`. `run-state.json` points to the current attempt and exposes
whether recovery is available. A completed evaluation remains terminal and cannot be resumed.

### Atomic persistence

Add a FileService primitive that writes JSON to a uniquely named temporary file in the destination
directory, flushes and closes it, and atomically renames it over the destination. Cell-result files,
the work plan, run state, attempt state, configuration transitions, and final aggregates use this
primitive.

One immutable file per completed cell avoids concurrent append corruption and allows recovery to
validate cells independently. `failures.jsonl` and `runtime-events.jsonl` remain journals; journal
append failures must be surfaced separately and must not be confused with a committed cell.

## Execution design

### LMEval-owned bounded batches

ExecutionService becomes the scheduler for the immutable work plan:

1. Load and validate the work plan.
2. Scan `cell-results/` and validate each checkpoint against `planHash` and `cellKey`.
3. Select only uncommitted work items for the new attempt.
4. Partition them into deterministic batches no larger than the configured concurrency limit.
5. Evaluate each exact batch through Promptfoo with the same assertions and cache policy as today.
6. When a batch returns, map and validate every graded row.
7. Atomically commit each valid cell result, then derive and persist counts from disk.
8. Stop scheduling new batches when cancellation, lease loss, or a fatal checkpoint error occurs.
9. After all planned cells are committed, build ordered `results.json`, compute `summary.json`, and
   transition the evaluation to `completed`.

This retains Promptfoo as the execution and grading engine. The scheduling boundary changes from one
whole-matrix call to exact bounded calls. It limits hard-crash replay to cells in the current batch;
files committed before the crash are skipped on resume.

Promptfoo's `afterEach` hook may emit lower-latency telemetry, but its output is advisory until the
corresponding cell-result file is committed. The progress UI must distinguish `observedCompleted`
from `durablyCommitted` if both values are shown.

### Exact work selection

The adapter must accept exact work-item IDs rather than reconstructing a retry from
prompt/model/test-case triples. Repetitions remain distinct. It must return a one-to-one mapping from
Promptfoo rows to planned cell IDs and fail the batch if rows are missing, duplicated, or unmappable.

Batch failure policy:

- Commit valid, fully graded rows returned by the batch.
- Record each provider or grading failure against its exact cell.
- Retry only according to the configured per-call retry policy.
- After retry exhaustion, commit a terminal failed cell result if Promptfoo produced a complete
  graded failure row; otherwise leave the cell uncommitted and make the attempt resumable.
- A checkpoint-write failure is fatal to the attempt. Do not increment durable progress or continue
  scheduling work whose recovery state cannot be trusted.

## Ownership, cancellation, and stale-run recovery

### Ownership and heartbeat

When an attempt starts, it writes an owner token and heartbeat to `run-state.json`. The in-memory
controller is an optimization, not proof of ownership. Execution updates the heartbeat during batch
work and runtime-event activity.

The supported deployment contract remains one active LMEval service per data root. Within that
contract, attempt acquisition is serialized by an evaluation-scoped mutex and an atomic run-state
transition. A non-expired owner causes a `409 EVALUATION_ALREADY_RUNNING` response.

### Startup reconciliation

On standalone and hosted startup, the shared composition root performs the same read-only scan and
state reconciliation before accepting resume commands:

- `running` plus the current instance's active controller: leave running;
- `running` plus missing/expired ownership: mark the attempt and evaluation `interrupted`;
- invalid or corrupt checkpoint: mark recovery blocked with a structured integrity failure;
- terminal completed evaluation with all aggregates: leave unchanged;
- complete checkpoint set but missing final aggregates: expose `finalization-only` recovery, which
  recomputes summary/indexing without model calls.

Reconciliation writes an event and status transition but never invokes LMApi.

### Cancellation

Cancellation returns a structured result rather than `success: true, cancelled: false`:

```json
{
  "status": "cancellation-requested",
  "controllerOwned": true,
  "attemptId": "attempt-...",
  "durablyCommitted": 48,
  "remaining": 192
}
```

If no controller exists and ownership is stale, cancellation reconciles the attempt to `interrupted`
and reports that no active provider call was aborted. It does not claim successful cancellation of a
worker it could not reach. Cancellation leaves committed cells available for an explicit later
resume.

## Resume API contract

Add:

```http
POST /api/eval/evaluations/:id/resume
```

Successful response is `202 Accepted` and includes:

- evaluation ID and new attempt ID;
- source attempt ID;
- total, reused, remaining, and current-batch counts;
- compatibility/preflight result;
- feedback, progress, runtime-events, and browser paths.

Resume is allowed for `interrupted`, `failed`, or `cancelled` evaluations that have a valid work plan
and at least one unfinished work item. It is rejected when an owner is live, the evaluation is
complete, integrity checks fail, or execution inputs drift.

Existing retry remains a clone/new-evaluation operation for deliberate reruns of selected results.
API and UI copy must use these terms consistently:

- **Resume:** same evaluation and work plan; reuse committed cells; execute unfinished cells.
- **Retry:** new evaluation derived from selected cells or failures.
- **Rerun:** new evaluation of the full selected matrix.

Extend feedback and active-run responses with:

```json
{
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

Use reason codes such as `LEGACY_NO_CHECKPOINTS`, `ACTIVE_OWNER`, `PLAN_HASH_MISMATCH`,
`CHECKPOINT_CORRUPT`, `MODEL_ROUTE_UNAVAILABLE`, `JUDGE_NOT_QUALIFIED`, and `ALREADY_COMPLETE`.

## Resume compatibility preflight

Before creating an attempt, verify:

1. The stored config hashes to the work plan's expected execution inputs.
2. Prompt versions, test cases, purpose template/taxonomy, assertion strategy, and repetition count
   match their stored hashes.
3. Every pending candidate resolves to the same server and model name.
4. The judge resolves through the same server-qualified path, and its stored qualification remains
   valid for the calibration, rubric, judge settings, and model artifact.
5. Inference controls that affect output—temperature, token limit, structured-output mode, and
   thinking/reasoning policy—match the plan.
6. Checkpoint schema and Promptfoo result schema are compatible with the current reader.

Content files may have changed on disk after the run began; their current state must never be silently
substituted. The work plan either embeds immutable execution material or points to immutable captured
artifacts in the evaluation directory.

If compatibility fails, return `409 RESUME_INCOMPATIBLE` with every failed check and offer a full clone
or rerun. Do not delete checkpoints.

## Structured failure diagnostics

Replace the message-only `error.json` as the primary diagnostic with typed failure entries. Keep a
small terminal error summary for backward-compatible readers.

Each failure includes:

- failure ID, evaluation ID, attempt ID, and timestamp;
- stage: `preflight`, `model-resolution`, `provider`, `judge-provider`, `promptfoo`, `assertion`,
  `checkpoint`, `aggregation`, `indexing`, `cancellation`, or `recovery`;
- scope: run, batch, or exact cell ID;
- stable error code, sanitized message, error class, retriable flag, and retry ordinal;
- canonical model ID, resolved server/model components, and model role (`candidate` or `judge`);
- HTTP status and LMApi error code where available;
- timeout/cancellation/finish reason;
- response content presence and length, reasoning presence and length, and structured-output parse
  result—never raw secrets, prompts, or responses in the operational journal;
- causal failure ID for wrapped errors.

Runtime events reference the failure ID so the UI can show a concise event and link to the durable
diagnostic. Final result artifacts may continue to contain evaluation inputs and outputs under their
existing data policy; the failure journal remains metadata-only.

## Unified candidate and judge routing

Introduce one validated `ServerQualifiedModelRef` parser and resolver used by:

- candidate Promptfoo providers;
- judge Promptfoo providers;
- judge qualification;
- preflight and availability checks;
- persisted provenance and error formatting.

Reject an unqualified or malformed identifier before costly work. All actual calls use the LMApi
server-pinned route with the split model name and server name. Persist both the requested canonical ID
and the resolved route.

Judge preflight performs one bounded structured-output probe before a qualification or judge-scored
run. It verifies transport success, non-empty consumable content, parseability, finish reason, and the
configured reasoning policy. A model that emits only reasoning, exhausts its token budget before the
answer, or cannot honor the required response form fails with a specific reason code rather than a
generic availability error.

## Finalization and downstream consumers

Finalization reads the immutable work plan and committed cell files, never callback counters. It must:

1. verify exactly one valid checkpoint for every planned cell;
2. order results by the original work plan;
3. retain attempt ID on every result;
4. write aggregate results and summary atomically;
5. index Run History only after both aggregate artifacts are valid;
6. make finalization idempotent so it can be rerun without model calls.

Run History may display attempt count and an “interrupted and resumed” badge, but it must plot one
final evaluation point. Partial checkpoints, legacy counts, and unfinished attempts remain operational
evidence only and cannot influence gates, leaderboards, campaigns, or promotion.

## Legacy-run policy

Existing evaluations without the new work plan and cell-result checkpoints are classified during
reconciliation:

- completed runs with valid `results.json` retain current behavior;
- failed runs with valid exact result cells remain eligible for the existing clone/retry flow;
- orphaned runs with only aggregate progress receive recovery reason `LEGACY_NO_CHECKPOINTS`;
- their reported counts are preserved for diagnosis but are never treated as completed cells.

Consequently, `eval-mts7kvz5-8lodnt` can be marked interrupted and explained accurately, but its 48
reported completions cannot be reused safely. It requires a full rerun. The resumability introduced by
this plan applies to runs created with the new durable work-plan/checkpoint schema.

## Implementation sequence

### Phase 1 — Durable identities and writes

- Add atomic JSON persistence and corruption-safe reads.
- Define work-plan, checkpoint, attempt, failure, and recovery types.
- Persist immutable exact work items before execution.
- Add schema/version/hash validation and legacy classification.

### Phase 2 — Checkpointed execution

- Refactor execution into LMEval-owned exact bounded batches.
- Map Promptfoo rows one-to-one to planned cells.
- Commit cell results atomically and derive progress from checkpoints.
- Make final aggregation idempotent.

### Phase 3 — Ownership and recovery

- Add attempt ownership, heartbeat, stale-owner reconciliation, and `interrupted` status.
- Implement explicit resume and structured cancellation responses.
- Surface recovery state through feedback and active-run APIs.

### Phase 4 — Routing and failure diagnostics

- Unify candidate, judge, and qualification model resolution.
- Add judge route/structured-output preflight.
- Persist structured failure records and connect them to runtime events.

### Phase 5 — UI and operational adoption

- Show committed versus observed progress, attempt history, failure stage, and resume eligibility.
- Add explicit Resume, Retry selected, and Full rerun actions with distinct explanations.
- Index only successfully finalized evaluations in Run History.
- Reconcile legacy stale runs without deleting or rewriting their evidence.

## Verification plan

### Unit tests

- Stable cell identity includes repetition and rejects any plan-hash mismatch.
- Atomic write never exposes a partial destination file.
- Checkpoint scan derives committed/remaining counts and detects corruption or duplicate identity.
- Exact batch selection skips committed cells and preserves every repetition.
- Server-qualified parsing produces identical candidate, judge, and qualification routes.
- Failure serialization redacts response bodies and secrets while retaining diagnostic metadata.
- Finalization is deterministic and idempotent across multiple attempts.

### Integration tests

- Kill the server after one or more committed batches, restart it, reconcile to `interrupted`, resume,
  and prove that committed cell IDs are not called again.
- Kill the server during an active batch and prove that only uncommitted cells may be replayed.
- Interrupt between the final cell commit and summary write, then complete finalization with zero model
  calls.
- Simulate checkpoint write failure and prove execution stops without advancing durable progress.
- Attempt two simultaneous resumes and prove only one obtains ownership.
- Change a prompt, case, judge setting, model route, or plan hash and prove resume returns a complete
  incompatibility report.
- Exercise cancellation with and without an in-memory controller and verify honest terminal state.
- Route the same judge through direct LMApi preflight, qualification, and Promptfoo grading and verify
  consistent server/model provenance.

### Hosted and standalone tests

- Run the restart/resume lifecycle in standalone mode and under HomeBase's `/lmeval/` base path.
- Verify both modes execute startup reconciliation through the shared composition root.
- Verify browser paths and WebSocket/runtime events remain correctly base-path-prefixed.

### Acceptance criteria

- After a hard stop, the feedback API identifies the run as interrupted within startup reconciliation.
- The UI and API report exact durable completed and remaining cell counts.
- An explicit resume performs no provider calls for committed cell IDs.
- At most the previously uncommitted in-flight batch is replayed.
- Every final result identifies the attempt that committed it.
- Judge routing failures identify requested model, resolved server/model, stage, and transport outcome.
- No incomplete or recovery-blocked evaluation appears as valid Run History, gate, or promotion
  evidence.

## Documentation updates required during implementation

When implementation begins, update `docs/SPECIFICATION.md` for the evaluation/attempt/checkpoint data
model and lifecycle, `README.md` for Resume versus Retry API behavior, and `docs/TASK.md` only as work
is actually completed. Do not mark this proposal complete before automated restart tests and browser
verification pass in both run modes.
