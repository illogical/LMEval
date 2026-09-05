# MemoryApi Transport-Parity Implementation Handoff to LMEval

**Date:** 2026-09-04

**Target repository:** LMEval

**Source repository:** MemoryApi

**Status:** Received and reconciled in LMEval documentation. The described MemoryApi changes are
committed at revision `c7ecb9e292947f88199c16548b88dc4fc8557a60`; live cross-process parity
verification is still required before treating an LMEval result as promotion evidence.

## Purpose

MemoryApi has implemented the transport-parity foundation requested by LMEval. LMEval no longer needs to assume how production ingestion constructs chat messages, wraps memory content, resolves task inference settings, selects task models, or reports transport provenance.

This handoff records the implemented contract and separates work LMEval can continue now from work that remains blocked on future MemoryApi-owned artifacts.

## Contracts LMEval can now treat as concrete

### Structured LMApi transport

For classification, tagging, and summarization, MemoryApi now sends an ordered two-message array:

```json
[
  { "role": "system", "content": "<rendered task instruction>" },
  { "role": "user", "content": "<memory>\n<escaped source content>\n</memory>" }
]
```

`LMApiClient` posts this array without flattening or reordering to:

```text
POST /api/chat/completions/any
```

The request fields are top-level `model`, `messages`, `stream: false`, `temperature`, and `max_tokens`. MemoryApi reads `choices[0].message.content` and `choices[0].finish_reason`.

MemoryApi declares this transport as:

```json
{
  "endpoint": "/api/chat/completions/any",
  "messageShape": "chat-messages"
}
```

This matches LMEval's current LMApi chat path and `chat-messages` vocabulary. LMEval Track A2's previously documented MemoryApi-side mismatch is therefore resolved once these changes are committed and identified by revision.

Ollama remains intentionally different in MemoryApi: `/api/generate` with `messageShape: "flattened-prompt"`. Do not infer cross-provider parity from the LMApi work.

### Exact production memory wrapper

MemoryApi has one shared wrapper function used by production prompt rendering:

```text
<memory>
${escapedContent}
</memory>
```

The opening tag is followed by exactly one LF and the closing tag is preceded by exactly one LF. Source content otherwise remains byte-for-byte unchanged, including existing line endings, markup, code, ampersands, and opening `<memory>` strings.

Every case-insensitive closing delimiter matching `</memory` plus optional whitespace before `>` is replaced with the literal:

```text
&lt;/memory&gt;
```

Examples that must be escaped include `</memory>`, `</MEMORY>`, and `</memory   >`.

LMEval should consume already-rendered user messages from a future MemoryApi snapshot. If LMEval needs to construct a temporary local parity fixture before snapshot export exists, it must reproduce this exact rule and label the fixture as temporary rather than MemoryApi-owned benchmark data.

### Task inference configuration

MemoryApi's single runtime source of truth is `config.TASK_MODELS`:

| Task | Model resolution | Temperature | Max tokens |
|---|---|---:|---:|
| Classification | `LLM_MODEL_CLASSIFICATION ?? LLM_MODEL` | 0.3 | 50 |
| Tagging | `LLM_MODEL_TAGGING ?? LLM_MODEL` | 0.3 | 100 |
| Summary | `LLM_MODEL_SUMMARY ?? LLM_MODEL` | 0.3 | 150 |

These are current production-parity values. The parent prompt-refinement plan's proposed `0 / 0 / 0.1` temperatures have not been evaluated or promoted and are not production values.

LMEval's built-in purpose templates may retain their 1000-token ceiling for exploratory tuning, but a run labeled production-parity must override it with 50, 100, or 150 for the corresponding task. The resolved values, rather than template defaults, must appear in result provenance.

### Per-task model selection is actionable

MemoryApi can now configure a separate model for each ingestion task. Clients are reused when task model names match and remain isolated when model names differ, avoiding mutation races during parallel ingestion. Retries for a task retain the same client and inference configuration.

This removes the former capability assumption behind LMEval's per-task `ModelRecommendation`. LMEval should continue to report both:

- the best eligible model per task; and
- the best single-model alternative across all three tasks.

MemoryApi still owns end-to-end ingestion latency and residency measurements before adopting a recommendation.

### Model availability semantics

MemoryApi preserves `GET /api/models` as LMApi catalogue discovery, but does not use that catalogue alone as proof that a task model can run. Runtime validation uses `GET /api/models/by-server`, deduplicating models advertised by online, non-disabled servers, with a bounded five-second request timeout.

An explicit task override absent from this routable set causes degraded inference initialization; it is not silently replaced. Status distinguishes provider connectivity from task-runtime readiness.

LMEval should use the same online, non-disabled interpretation when presenting selectable models or validating an imported recommendation. A catalogue entry by itself is insufficient evidence of availability.

### Prompt identities available today

MemoryApi's transport-refactored renderers currently emit:

| Task | `promptId` | `promptVersion` | Taxonomy hash |
|---|---|---|---|
| Classification | `classification` | `transport-v1` | SHA-256 of the rendered category taxonomy input |
| Tagging | `tagging` | `transport-v1` | SHA-256 of the rendered tag taxonomy input |
| Summary | `memory-summary` | `transport-v1` | none |

These versions identify the transport refactor, not a quality-promoted prompt revision. LMEval must not treat `transport-v1` as evidence that the planned category definitions, tag guidance, examples, or retrieval-oriented summary wording have been evaluated or adopted.

MemoryApi's current classification and tagging evaluators now use the same shared message conversion as production, resolve parameters from `TASK_MODELS`, and record prompt version, taxonomy hash, per-case `finishReason`, and aggregate finish-reason counts.

## LMEval work that can proceed without further MemoryApi assumptions

1. **Track A2 implementation closure — complete.** LMEval documentation now records verified
   MemoryApi revision `c7ecb9e292947f88199c16548b88dc4fc8557a60` and no longer claims that its
   LMApi provider flattens messages.
2. **Add a strict production-parity run profile.** Resolve 0.3 with task ceilings 50/100/150 and persist those resolved values. Do not replace the existing generous exploratory defaults unless that is a separate product decision.
3. **Make truncation visible.** Preserve and report `finish_reason`, especially `length`, as a contract/truncation signal rather than blending it into task quality.
4. **Implement typed assertion strategies and task scoring (Tracks A3, A4, and A6).** Exact-label classification, set-based tagging, grounding fields, repeated-run stability, confidence intervals, and slice metrics no longer depend on the old transport assumption.
5. **Use routable model discovery.** Confirm model selection and preflight behavior are based on online, non-disabled LMApi servers rather than the all-server catalogue.
6. **Retain the two-phase experiment protocol.** Prompt and model selection remain separate decisions even though MemoryApi can now apply per-task winners.
7. **Add parity contract fixtures.** Cover exact `[system, user]` order, wrapper newlines, mixed-case and whitespace-bearing closing delimiters, top-level inference parameter names, and finish-reason capture. These fixtures verify LMEval behavior; they are not substitutes for MemoryApi's future benchmark export.

## Work still blocked on MemoryApi-owned deliverables

LMEval must not invent or silently approximate the following:

- `memory-eval-snapshot.v1` JSON Schema;
- `prompt-promotion-record.v1` JSON Schema;
- reviewed v1 classification, tagging, and summarization datasets;
- the annotation and adjudication guide;
- versioned snapshot export with source revision and input hashes;
- raw-versus-pipeline diagnostic envelopes;
- quality-refined production prompts or promoted temperature changes;
- MemoryApi end-to-end latency and model-residency results.

Therefore Track A5's real built-in benchmark import and Track A10's schema/hash import guard remain blocked. LMEval may implement generic storage and validation plumbing around clearly marked fixtures, but it should not assign MemoryApi provenance or promotion authority to hand-authored substitutes.

## Cross-project acceptance check

Before using an LMEval result as MemoryApi promotion evidence:

1. Record the MemoryApi source revision containing this implementation.
2. Confirm the LMEval request uses `/api/chat/completions/any` with exactly the rendered two-message array.
3. Confirm resolved temperature and token ceiling match the task's `TASK_MODELS` values.
4. Confirm prompt id, prompt version, and taxonomy hash match the MemoryApi-rendered inputs.
5. Confirm the selected model is routable through an online, enabled LMApi server.
6. Treat any `finish_reason: "length"` result as truncation evidence.
7. Reproduce the headline result with MemoryApi's evaluator under `MEMORY_DATA_ENV=test`.
8. Keep model recommendation adoption blocked until MemoryApi records end-to-end ingestion latency.

## Verification already performed in MemoryApi

- Focused transport, prompt-rendering, task-runtime, and processor suites: 29 tests passing.
- Full Jest suite: 118 passing with two unrelated, pre-existing failures.
- TypeScript build and host typecheck: only the existing Express route-parameter and Qdrant client typing failures.
- No live cross-process LMApi model run was performed as part of this handoff; runtime parity still needs an integration smoke test against the actual LMApi/Ollama deployment.

## Reconciliation status and next LMEval sequence

1. **Complete:** Track A2's stale current-state text now names the verified MemoryApi revision.
2. Add the strict production-parity run profile and finish-reason reporting.
3. Continue A3 and A4, then A6, using temporary fixtures that are explicitly non-authoritative.
4. Perform one live cross-project smoke test with a memory containing `</MEMORY   >` and verify the captured request and response provenance.
5. Wait for MemoryApi's schemas, reviewed datasets, and snapshot exporter before completing A5 or A10.
