---
title: Core Task Measurement Excellence - Plan
type: feat
date: 2026-09-04
topic: core-task-measurement-excellence
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

**Objective:** LMEval's three built-in task types (classification, tagging, summarization) score what actually matters — exact label correctness, tag-set precision/recall, judged summary quality against deterministic guards — instead of today's loose keyword/threshold proxies, so a real MemoryApi prompt or model change can be measured with enough confidence to act on.

**Product authority:** `docs/TASK.md` §4 Track A (items A3, A6) and `docs/SPECIFICATION.md` §3–4; this plan turns the already-specified A3 + A6 checklists into a requirements-ready increment, without redesigning items not yet reached.

**Open blockers:** none. A1 (inference parameters/provenance) is complete; this slice does not depend on A2's remaining snapshot-import work.

## Product Contract

### Summary

Wire up typed assertion strategies (A3) and task-appropriate scoring (A6) so classification, tagging, and summarization each produce metrics that would actually change a promotion decision — not a blended composite score that hides format failures or grades classification by keyword-in-prose matching.

### Requirements

**Assertion correctness**
- R1. Classification is graded by an `exact-label` assertion against the declared category list, replacing today's `expectedKeywords` prose-matching (which currently accepts explanatory text containing the label as a pass).
- R2. `AssertionStrategy.config` is validated at the service boundary against its declared `type`'s shape; an invalid `custom` config returns `400` rather than silently no-op-ing (today's actual behavior — `custom` has zero implementation).
- R3. Legacy config keys normalize in both directions on read/write: `categories`→`labels`, `tagVocabulary`→`vocabulary`, `threshold`→`minimumCaseF1`, `llm-rubric`+`dimensions`→`grounded-summary`+`templateId`.

**Task-appropriate scoring**
- R4. Classification produces: accuracy, macro-F1, per-class precision/recall/F1, invalid-label rate, format-compliance rate, confusion matrix, run-to-run agreement. Gate: macro-F1 ≥ 0.90, per-class recall ≥ 0.80, zero invalid labels, 100% format compliance.
- R5. Tagging parses raw output without silently repairing it, then produces: per-case TP/FP/FN, precision/recall/F1, Jaccard, exact-set match rate, unknown-tag rate, duplicate-tag rate, format-compliance rate. Gate: micro-F1 ≥ 0.85, macro label-F1 ≥ 0.70, exact-set ≥ 0.60, zero invalid labels.
- R6. Summarization runs deterministic checks (no preamble/heading/fence, compression ratio in range, protected tokens preserved, no literal forbidden claims) before model grading; the rubric becomes Faithfulness 0.40 / Salient Coverage 0.30 / Retrieval Utility 0.20 / Concision 0.10, three independent judge passes at t=0 aggregated by median, and a model may never judge its own output. Gate: median weighted ≥ 4.2, median Faithfulness ≥ 4.5, no critical unsupported claim.
- R7. `EvaluationSummary.taskMetrics` becomes a discriminated union keyed by task type. Classification and tagging never manufacture a rubric-style composite score — only summarization has one, because only summarization measures something inherently subjective.

**Reporting**
- R8. The Results verdict header and per-task panels surface gate pass/fail first, ranked score second — "granite4.1:8b is the only candidate that clears the classification gate" is the primary read, not "granite4.1:8b scored 4.2."

### Key Decisions

- **Scope this increment to the three existing built-in task types only; do not generalize the assertion/metric plumbing into a reusable plugin system yet.** (session-settled: user-directed — user wants the core task types genuinely excellent first and will revisit generalization once a concrete new use case is in front of them.) Governs R1–R7.
- **Defer designing an agent-drivable API contract.** (session-settled: user-directed — the idea is recent and better informed once the wizard UX is proven out against MemoryApi's own prompts.) No governed R; recorded so planning does not invent API surface as part of this slice.

### Scope Boundaries

**Deferred for later** (captured here so they aren't lost, not committed as this plan's scope):
- Generalized "custom" assertion + metric-spec plugin architecture, so a genuinely new task type needs no core-service code changes — explored in this session's dialogue but intentionally not designed yet.
- Deeper tool-calling effectiveness evaluation (a purpose template already exists; strengthening its assertions/metrics is future work).
- Evaluating MemoryApi's multi-source retrieval merge/fusion step (combining results from separate databases into one LLM/MCP-consumable context) — a distinct, more complex evaluation shape than single-call classification/tagging/summarization.
- Agent-drivable API contract (an LLM configuring and running evaluations on the user's behalf) — a first concrete step toward this, discussed in this session: a Claude Code agent skill that reads a completed evaluation's results via a small new read-only API endpoint (evaluation summary + failing cells) and proposes prompt-wording refinements in chat, diff-only, no auto-apply. Scoped as its own future plan, not this one; an automated refinement-loop harness (candidate: an agent SDK, possibly a separate project) is explicitly longer-term and out of scope for the skill itself.
- A5 (built-in benchmark suite import, blocked on MemoryApi's dataset export), A7 (statistics/confidence intervals), A8 (judge qualification), A9 (two-phase model selection), A10 (interchange schema contract), A11 beyond the R8 gate-first framing above — all remain queued in `docs/TASK.md` Track A and are candidates for a separate, deeper brainstorm once this slice ships. The user explicitly wants that as its own future conversation, not folded into this one.

**Outside this plan:** A2's remaining snapshot-consumption and live cross-project parity verification (tracked separately in `docs/TASK.md`, not blocked by or blocking this slice).

### Dependencies / Assumptions

- Builds directly on the completed A1 work (`resolvedInference`, `transportProvenance`, `finishReason`/truncation-rate plumbing already in `ExecutionService`/`SummaryService`).
- Assumes the three built-in purpose template JSON files (`data/evals/purpose-templates/`) are the ones being hardened — no new templates introduced by this slice.

### Success Criteria

- Running the current production classification/tagging/summarization prompts against a candidate prompt or model produces per-task metrics (not a blended score) that would change which one gets promoted.
- The Results page states gate pass/fail before showing a ranked list.
- The user can point this at MemoryApi's real prompts and get a measurable, trustworthy signal on whether an edit or model swap actually helped — the stated immediate goal behind this whole track.

### Outstanding Questions

**Deferred to Planning:**
- Exact UI placement/shape of the confusion matrix and per-class panels (A11 depends on R4/R5 landing first).
- Implementation detail of the 3-pass judge median aggregation (single Promptfoo run with repeated grading vs. 3 separate `llm-rubric` assertions averaged).
