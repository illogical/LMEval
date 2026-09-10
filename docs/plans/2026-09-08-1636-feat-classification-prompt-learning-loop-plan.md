---
title: Classification Prompt Learning Loop - Implementation Plan
type: feat
date: 2026-09-08
topic: classification-prompt-learning-loop
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

**Objective:** An agent can turn a completed classification evaluation into one evidence-backed prompt hypothesis, run a controlled incumbent-versus-candidate experiment on a named local model, and receive an honest outcome that says whether the change helped.

**Means:** Add deterministic classification failure analysis, a bounded agent-authored refinement-experiment workflow, and persisted tiered outcomes to the existing agent API and evaluation workflow skill.

**Product authority:** `docs/SPECIFICATION.md`, `docs/TASK.md` Track C, and the measurement and promotion rules in `docs/plans/2026-09-03-professional-memory-evaluations.md`.

**Open blockers:** Implement or otherwise satisfy the execution durability work in `docs/plans/2026-09-08-evaluation-failure-recovery-and-resume.md`, then pass `docs/TASK.md` G7 and the classification portion of G8 before live acceptance. These are prerequisites, not part of this feature's three priorities.

## Product Contract

### Summary

Build a classification-first learning loop for agents. LMEval will convert existing per-cell evidence into recurring failure patterns, accept one agent-authored prompt rewrite tied to those patterns, run one calibration-only comparison against an explicitly selected `server::model`, and persist a conservative result without touching MemoryApi or weakening benchmark truth.

### Problem Frame

LMEval already stores raw results, test cases, classification confusion matrices, assertion failures, prompt versions, and pollable evaluation feedback. Its current AI summary path sees aggregate rankings and gate failures but not the detailed evidence needed to explain repeated classification mistakes. A calling agent can assemble the primitives manually, but there is no stable failure-analysis contract, no bounded operation that preserves the source experiment while testing one rewrite, and no durable record connecting a hypothesis to its measured outcome.

The immediate goal is learning, not promotion. The built-in benchmark is still pending human review, and small calibration sets often cannot prove a statistically significant improvement. The workflow must therefore preserve advisory status and distinguish a promising point improvement from a supported improvement.

### Requirements

**Priority 1 — Classification failure-pattern analysis**

- R1. A completed classification evaluation exposes a deterministic analysis for one explicitly named model, derived from its pinned prompt, resolved test cases, raw cells, assertion results, finish reasons, task metrics, and benchmark provenance.
- R2. The analysis groups failures into valid-label confusions, empty output, valid-label-with-wrapper text, case or punctuation drift, unknown output, truncation, and run-to-run instability; it also aggregates failures by existing `caseTags` slices.
- R3. Every pattern has a stable ID, kind, affected-case and run counts, rate, expected and observed labels where applicable, representative cell IDs, and sorted impact. Diagnostics must not repair or rescore raw output.
- R4. Analysis eligibility requires a completed evaluation, the classification purpose and `exact-label` strategy, ready results/summary/test cases, and a target model present in the run. Execution failures remain separate from quality failures.
- R5. Analysis uses calibration cases only. If the source run included regression cases, their content and outcomes are excluded from the agent-facing optimization artifact.

**Priority 2 — One bounded agent-authored experiment**

- R6. A refinement experiment accepts the source evaluation ID, exact target `server::model`, one hypothesis, cited pattern IDs, and one complete candidate prompt authored by the caller. LMEval does not require or call `REFINEMENT_MODEL` for this workflow.
- R7. The operation creates a new derived prompt record so the incumbent prompt and its pinned version remain unchanged, then creates a prompt-comparison evaluation containing exactly the pinned incumbent and the new candidate on the selected model.
- R8. The experiment reuses the source purpose template, taxonomy, calibration suite, transport shape, and resolved inference settings. It uses at least three runs per cell for classification, even when an older source run used fewer repetitions.
- R9. Calling the start operation authorizes exactly one experiment run. Before calling it, the agent skill must show the target model, prompt pair, case count, repetitions, total provider-call estimate, source warnings, and the fact that no regression cases will be exposed.
- R10. The server validates the complete experiment before creating model work. It rejects stale or missing prompt pins, unknown pattern IDs, a target model absent from the source evidence, non-classification sources, incomplete sources, unavailable routes, and any request that would vary models or include regression cases.
- R11. Creation or execution failure leaves an inspectable experiment and any created candidate prompt intact with a structured failure state; it never deletes evidence, mutates the incumbent, silently retries as a second experiment, or writes to MemoryApi.

**Priority 3 — Tiered outcome and durable learning record**

- R12. Each experiment persists its source evidence identity, hypothesis, cited patterns, incumbent and candidate prompt pins, prompt diff, target model, evaluation ID, validation warnings, lifecycle, and terminal outcome.
- R13. Outcome comparison is paired by test case and repetition and reports both prompts' accuracy, macro-F1, confidence intervals, per-class metrics, confusion matrices, format/invalid-label rates, and McNemar discordant counts and p-value.
- R14. The terminal classification is one of `improved`, `promising`, `unchanged`, or `regressed`: `improved` requires a positive accuracy change with McNemar `p < 0.05` and no guardrail regression; `promising` requires a positive accuracy change without statistical support and no guardrail regression; `regressed` means accuracy decreased or a guardrail regressed; otherwise the result is `unchanged`.
- R15. Guardrail regression means the candidate introduces any new invalid-label or format violation, worsens any class's correct-case count by more than one calibration case, or has a worse gate verdict than the incumbent. The response names every triggered guardrail.
- R16. Pending-human-review provenance makes every outcome advisory. An advisory `improved` or `promising` result may justify another experiment but cannot be described as promotable.
- R17. The agent workflow skill ends by explaining the dominant changed patterns, the outcome tier and uncertainty, any class-level trade-off, and the smallest next experiment. It never recommends editing ground truth from this workflow.

### Key Decisions

- **Prove the loop on classification before extending it to tagging.** (session-settled: user-directed — chosen over a shared classification/tagging first iteration to keep the first vertical slice focused.) Governs R1-R17.
- **The calling agent authors the rewrite.** (session-settled: user-directed — chosen over a server-side refinement-model dependency so the API supplies evidence and measurement while the active agent performs the reasoning.) Governs R6 and R17.
- **One hypothesis and one candidate per experiment.** (session-settled: user-directed — chosen over multiple simultaneous variants so outcome attribution stays clear and provider cost remains bounded.) Governs R6-R10.
- **One explicit operation creates and starts the run.** (session-settled: user-directed — chosen over suggestion-only or draft-only behavior to close the learning loop in one bounded action.) Governs R7-R11.
- **Use tiered evidence rather than point-score winners.** (session-settled: user-directed — chosen over strict proof-only and naive score ranking so small useful gains remain visible without overstating confidence.) Governs R13-R16.
- **Flexible truth tiers remain future work.** (session-settled: user-directed — Expected, Acceptable, and Avoid semantics are recorded but do not alter current scoring or this iteration's diagnostic recommendations.)

### Scope Boundaries

**Deferred for later:**

- Extend the proven contracts to tagging with missing/extra/unknown/duplicate tag patterns, group-level recall, and per-tag recurrence.
- Brainstorm classification and tagging ground truth with `Expected` or `Must`, `Acceptable`, and `Avoid` outcomes, including how partial credit and extra penalties affect metrics, confidence intervals, imports, and benchmark review.
- Suggest test-case, expected-answer, taxonomy, weight, threshold, or evaluation-criteria edits. This iteration may expose evidence a human notices, but the agent workflow remains prompt-only.
- Automated multi-iteration refinement, automatic promotion, automatic git commits/reverts, and overnight loops.
- Summarization feedback and judge-derived finding analysis.

**Outside this plan:** UI redesign, MemoryApi changes or runtime calls, regression-split optimization, model-selection campaigns, and the execution recovery implementation tracked by the prerequisite plan.

### Dependencies and Assumptions

- The initial target will be supplied explicitly as `Tiny-Tower::granite4.1:8b`; no API default or automatic winner selection is introduced.
- Advisory calibration experiments may run before benchmark review approval, but the warning is preserved in every analysis, experiment, and outcome response.
- Existing Promptfoo assertions remain the scoring engine. The new analysis interprets existing result data and the comparison reuses task-specific metric functions.
- Existing summary-analysis UI behavior and `REFINEMENT_MODEL` configuration remain backward compatible and independent.

### Immediate Evaluation Recommendation While This Plan Is Reviewed

Do not rerun the stalled five-model classification matrix. Its current hosted feedback still reports `running` at 48/240 with no ready results or summary, so those 48 progress events are not recoverable quality evidence. Repeating the same broad matrix would spend another 240 calls at one repetition per cell while adding little to the classification-first prompt-learning goal.

Run one focused Granite 4.1 classification baseline instead, after reviewing and explicitly approving the draft:

```json
{
  "name": "Granite 4.1 classification prompt-learning baseline",
  "promptIds": ["prm-mtqn1clk-51cizi"],
  "promptVersions": [
    { "promptId": "prm-mtqn1clk-51cizi", "version": 1 }
  ],
  "modelIds": ["Tiny-Tower::granite4.1:8b"],
  "comparisonMode": "matrix",
  "purposeTemplateId": "classification",
  "testSuiteId": "memory-classification-v1",
  "benchmarkMode": "calibration",
  "runsPerCell": 3,
  "inference": {
    "temperature": 0.3,
    "maxTokens": 50
  },
  "enablePairwise": false
}
```

This is 1 prompt x 1 model x 48 calibration cases x 3 repetitions = **144 candidate calls** and **0 judge calls**. The benchmark is still `pending-human-review`, so the run is useful for failure discovery and stability measurement but remains advisory and non-promotional.

This recommendation is based on the current hosted state checked on 2026-09-08:

- `eval-mts7kvz5-8lodnt`, the latest five-model classification run, remains stale at 48/240 with no results or summary.
- `eval-mtsuvoer-273j32`, the latest five-model tagging calibration run, completed 270/270. Do not rerun tagging now; it already provides fresh one-repetition directional evidence, and classification is the chosen first refinement slice.
- The most recent usable Granite 4.1 classification metrics in `eval-mtqvhs4a-t24dq6` were 0.844 accuracy, 0.838 macro-F1, zero invalid labels, and 100% format compliance. Note recall was 0.50 and History recall was 0.67, making semantic boundary errors—not output formatting—the best immediate evidence target.
- LMApi was healthy and idle at the snapshot (`activeRequests: 0`, `queueLength: 0`), and `Tiny-Tower::granite4.1:8b` was present in grouped model discovery. Recheck both immediately before validation and start because availability is time-sensitive.

Use the normal draft-first sequence: rediscover the prompt pin/model/suite, validate this exact input, create a draft, review the returned configuration link and 144-call estimate, then start once. Poll feedback to a terminal state and require 144/144 completed cells plus ready results and summary before treating it as the failure-analysis source. If it stalls or returns an incomplete matrix, preserve it as execution evidence and wait for the recovery work rather than launching repeated replacements.

After it completes, use its repeated outputs to choose one dominant failure pattern and author the first candidate prompt. Do not run a second broad model sweep or expose the regression split while this plan is under review.

### Acceptance Examples

- AE1 (covers R1-R5): Given a completed multi-model classification calibration run and `Tiny-Tower::granite4.1:8b`, analysis returns only that model's calibration failures, ranks repeated `Event -> History` confusion above isolated mistakes, and links representative result cells without changing their scores.
- AE2 (covers R2-R3): A response such as `The category is Event.` is classified as wrapper text around a known label; it remains an exact-label failure and is not repaired to `Event`.
- AE3 (covers R6-R11): Given one cited pattern and one complete rewrite, the operation creates a distinct candidate prompt, pins the original and candidate, estimates `2 x calibration cases x repetitions` calls, starts one prompt comparison, and returns an experiment and evaluation ID for polling.
- AE4 (covers R10): A request naming a model not present in the source evaluation, a tagging evaluation, or a running/incomplete source returns validation issues before creating a prompt or evaluation.
- AE5 (covers R13-R16): A positive candidate delta without significant McNemar evidence returns `promising`, includes uncertainty and class guardrails, and remains advisory while benchmark review is pending.
- AE6 (covers R14-R15): A candidate with higher aggregate accuracy but a new invalid-label output or a two-case drop in one class returns `regressed` and names the guardrail.

### Success Criteria

- An agent needs no manual filesystem reads to identify the dominant classification failure pattern for one model.
- One authorized API action can test one agent-authored rewrite without mutating the incumbent prompt or exposing regression cases.
- The returned outcome connects the measured change to the original hypothesis and never turns incomplete, unreviewed, or statistically weak evidence into a promotion claim.
- The repository workflow skill contains enough steps and safety gates for a fresh agent session to execute the loop from discovery through interpretation.

## Implementation Plan

### 1. Add shared contracts and deterministic analysis

- Add `ClassificationFailurePattern`, `ClassificationFailureAnalysis`, `RefinementHypothesis`, `RefinementExperiment`, `RefinementExperimentOutcome`, and validation/lifecycle types to the shared evaluation types and re-export them server-side.
- Implement a classification analysis service that loads the source config, results, summary, and resolved test cases; filters by target model and calibration split; categorizes exact raw outputs; aggregates stable patterns and slices; and returns deterministic ordering.
- Add `GET /api/eval/evaluations/:id/failure-analysis?modelId=<server::model>` and publish the response and error contracts in OpenAPI and both typed clients.
- Keep raw responses in the existing results endpoint. The analysis returns bounded representative cell IDs and label/output excerpts, not a second unbounded result dump.

### 2. Add the refinement-experiment lifecycle

- Add `POST /api/eval/evaluations/:id/refinement-experiments` with `{ targetModelId, hypothesis: { summary, rationale, patternIds }, candidatePrompt: { name, content } }`.
- Validate all source and pattern preconditions before writes. Then create a distinct derived prompt, create a persisted experiment, create a two-prompt/one-model calibration evaluation with exact pins, record the evaluation ID before execution, and start it asynchronously.
- Persist experiments under the configured LMEval data root, with statuses `pending`, `running`, `completed`, and `failed`. Add `GET /api/eval/refinement-experiments/:id` and `GET /api/eval/refinement-experiments/:id/feedback` for recovery and polling.
- Reuse evaluation feedback links and structured validation issues. Do not add a second execution engine or a hidden retry loop.

### 3. Compute and persist the outcome

- Group completed result cells by prompt, reuse classification metric computation, and add paired case/repetition comparison for the incumbent and candidate.
- Implement the R14/R15 outcome classifier as a pure function with explicit reasons and advisory propagation from benchmark provenance.
- Finalize the experiment only after the evaluation has complete results and summary artifacts. An incomplete or failed evaluation records execution state but has no quality outcome.
- Store the resolved prompt diff and pattern movement so a later agent can see which cited failures improved, persisted, or worsened without reconstructing the run.

### 4. Update the agent workflow and documentation

- Extend `.agents/skills/lmeval-evaluation-workflow/` with a classification-refinement path: discover exact IDs, fetch failure analysis, form one hypothesis, show the call estimate and warnings, obtain explicit authority, start one experiment, poll feedback, and interpret the tiered outcome.
- State that the workflow is calibration-only, prompt-only, classification-first, and advisory while the benchmark is pending review. Prohibit automatic criteria edits, regression exposure, promotion, git actions, or MemoryApi writes.
- Update README endpoint documentation, the served OpenAPI document, and `docs/SPECIFICATION.md` so the implemented behavior and agent-facing terminology remain authoritative.

## Public API and Type Changes

- `GET /api/eval/evaluations/:id/failure-analysis?modelId=...` returns `ClassificationFailureAnalysis`.
- `POST /api/eval/evaluations/:id/refinement-experiments` creates a derived prompt and starts one bounded comparison, returning `202` with experiment/evaluation IDs, call estimate, warnings, and feedback paths.
- `GET /api/eval/refinement-experiments/:id` returns the durable record; `/feedback` returns compact lifecycle, progress, failure, readiness, advisory, and outcome state.
- No existing response field is removed or reinterpreted. Existing evaluation, summary-analysis, prompt, session, and campaign endpoints remain compatible.

## Verification Contract

### Automated tests

- Unit-test every failure category, stable pattern grouping/order, calibration filtering, target-model filtering, bounded examples, and the no-repair invariant.
- Unit-test experiment validation before writes, distinct candidate prompt creation, exact incumbent/candidate pins, inherited production shape, forced minimum repetitions, call estimate, and one-run-only behavior.
- Unit-test all outcome tiers, McNemar alignment, guardrail precedence, advisory propagation, and refusal to score incomplete results.
- Route/integration-test analysis, create/start, polling, restart readback, validation failures, OpenAPI conformance, and both standalone and hosted base paths.
- Run the full unit suite, lint, standalone build, hosted frontend build, host adapter build, agent-workflow smoke, and `git diff --check`; record unrelated pre-existing failures separately.

### Live acceptance

- First resolve the stale-run/recovery prerequisite and complete the relevant G7/G8 checks.
- Use a completed classification calibration evaluation as the source and explicitly target `Tiny-Tower::granite4.1:8b`.
- Inspect returned patterns against raw cells, author one focused rewrite, approve the exact call estimate, and run one incumbent-versus-candidate experiment through the agent API.
- Record the source evaluation, experiment, derived prompt, and comparison evaluation IDs; exact prompt pins; inference; calls; warnings; failures; paired metrics; pattern movement; outcome tier; and advisory reason.
- Do not describe the result as promotable until the benchmark review ledger is approved and an independent promotion check uses the untouched regression split.

## Definition of Done

- R1-R17 and AE1-AE6 are covered by implementation and tests.
- The new API is documented, served from OpenAPI, and callable through the repository's typed client and workflow skill.
- A real Granite 4.1 classification experiment completes through the new path after prerequisites are satisfied, or any environmental blocker is recorded without fabricating a quality outcome.
- `docs/TASK.md` and `docs/SPECIFICATION.md` describe the shipped state only after verification evidence exists.
