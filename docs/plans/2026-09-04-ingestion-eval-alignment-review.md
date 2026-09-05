# Ingestion Eval Alignment Review

**Status:** Review notes

**Date:** 2026-09-04

**Reviews:** [`docs/plans/2026-09-03-professional-memory-evaluations.md`](2026-09-03-professional-memory-evaluations.md) · MemoryApi `docs/plans/2026-09-03-ingestion-prompt-refinement.md`

Cross-project review of the two ingestion-evaluation plans. Findings 1–4 were folded into both plans;
findings 1–3 now carry implementation-status corrections, while the "further suggestions" section
remains open for a decision.

## What blocks a transferable result

Four issues were verified in code at review time. MemoryApi revision
`c7ecb9e292947f88199c16548b88dc4fc8557a60` and LMEval A1 resolve the implementation gaps in the
first three; live parity verification and authoritative snapshot artifacts are still required before
promotion. The fourth remains evaluation-design work.

### 1 — The two projects call LMApi differently (parity)

LMEval posts structured `messages: [system, user]` to `/api/chat/completions/any`. MemoryApi's `LMApiClient` joins the messages into one `ROLE: content` string and posts it as `prompt` to `/api/generate/any`.

At review time, MemoryApi's client flattened the stable system instruction and untrusted `<memory>`
content before the model saw them, so an LMEval number described a call production did not make.

**Status correction (2026-09-04): resolved for the LMApi provider.** MemoryApi revision
`c7ecb9e292947f88199c16548b88dc4fc8557a60` posts the ordered system/user messages without
flattening to `/api/chat/completions/any`, matching LMEval. Its native Ollama provider remains
intentionally different. A live cross-process parity smoke test is still required before promotion.

> MemoryApi `src/services/modelClients.ts:227–241` · LMEval `server/services/LmapiClient.ts:103`

### 2 — LMEval sent no inference parameters (resolved)

At review time, `buildLmapiProvider` posted `model`, `messages`, `stream`, and `groupId` only, so
every cell ran at the provider default temperature.

**Status correction (2026-09-04, later pass):** MemoryApi actually runs `classifyText`, `tagText`,
and `summarizeText` at `temperature 0.3` with `maxTokens` 50 / 100 / 150 respectively; only the
unrelated `extractEntities` call uses `temperature 0.1`. A1 subsequently resolved the LMEval finding:
`buildLmapiProvider` now sends resolved `temperature`, `max_tokens`, and optional `seed`, and LMEval
persists the resolved inference values and transport provenance. LMApi added `seed` to its validated
chat-completions schema and forwards it to Ollama. The separate structured-message transport mismatch
in finding 1 remains the blocker to a transferable result.

> LMEval `server/services/PromptfooAdapter.ts:31–40` · MemoryApi `src/services/memoryTextProcessor.ts:29, 45, 76`

### 3 — MemoryApi could not run a different model per task (resolved)

At review time, `MemoryRAGSystem` constructed one `ModelClient` from one shared `config.LLM_MODEL`.

**Status correction (2026-09-04): resolved.** MemoryApi revision
`c7ecb9e292947f88199c16548b88dc4fc8557a60` provides task-specific model overrides with fallback to
`LLM_MODEL`, reuses clients when names match, and keeps different task clients isolated. Per-task
recommendations are now actionable, subject to MemoryApi's end-to-end latency and residency checks.

> MemoryApi `src/services/memoryRAGSystem.ts:47–48` · `src/services/configService.ts:73`

### 4 — The 2-point regression gate is finer than the data (resolution)

Both plans set the same rule: fail on any primary metric regressing more than two percentage points. But one case flipping moves each regression slice by far more than that:

| Slice | Cases | One case = | Proposed gate |
|---|---|---|---|
| Summarization | 9 | 11.1 pp | 2.0 pp |
| Classification | 16 | 6.25 pp | 2.0 pp |
| Tagging | 18 | 5.56 pp | 2.0 pp |

Every slice clears the threshold by 2.8× or more, so the gate can only ever fire on the smallest possible change — it reduces to "any single case flipped" and will reject good candidates on run-to-run noise.

The revision keeps an absolute floor but states the regression rule at the resolution the data supports: report the point estimate alongside one case's worth of movement, compute a bootstrap interval over cases, use a McNemar test for the paired comparison, and express the slice gate in cases — *at most one regression-slice case may flip* — rather than in points the slice cannot express. Where the interval is too wide to decide, the verdict is `inconclusive` with a stated case count needed, not a pass.

## Separating the prompt question from the model question

The original plans ran prompts and models through one matrix, which yields a winner attributable to neither variable. The revision splits them:

| Phase | Vary | Fix | Purpose |
|---|---|---|---|
| 1 | prompt | model (incumbent) | Keeps results comparable to what is deployed. Calibration split only. |
| 2 | model | prompt (promoted) | Rank the declared candidate slate across both splits. |
| 3 | — | — | Re-run phase 1 on the phase-2 winner. Detects non-transfer. |

A prompt tuned on one model does not automatically transfer; phase 3 is what catches that. On failure, take the runner-up rather than shipping an unconfirmed pairing.

### The selection rule, in order

| Step | Criterion | Effect |
|---|---|---|
| 1 · Gate | Absolute quality floor; zero invalid outputs | A fast model that breaks the output contract is not a candidate at any latency |
| 2 · Quality | Primary metric with 95% intervals | Overlapping intervals form a tie group, not a ranking |
| 3 · Budget | p95 latency, as a share of a whole-ingestion target | Orders within a tie group only |
| 4 · Stability | Run-to-run agreement, then token efficiency | Breaks remaining ties |

### Per-task winners are not free

Three tasks running three different models means either three resident models or a swap per memory. LMEval times single calls against a warm pool and structurally cannot see this cost, so the report always carries the best single model across all three tasks alongside the per-task winners, with the quality delta between them.

Under the `lmapi` provider the split may cost nothing — sticky assignment can place the three models on three pooled servers and let the ingestion calls run genuinely in parallel. Under single-host `ollama` it may cost a load cycle per memory. MemoryApi owns that measurement, and it decides.

## What each project gets from the other

Direction is asymmetric by design. MemoryApi owns truth and receives advice; LMEval owns measurement and receives data. Neither writes into the other's repository or calls it at runtime.

**MemoryApi → LMEval**

- A real taxonomy with adjudicated ground truth, instead of hand-written starter cases.
- An annotation guide that makes label disputes resolvable rather than arguable.
- Grounding annotations — required facts, forbidden claims, protected tokens — that turn a vague summarization rubric into a checkable one.
- The raw-versus-pipeline distinction, which keeps LMEval honest about what its numbers describe.
- A production consumer that turns eval features into decisions rather than dashboards.

**LMEval → MemoryApi**

- Task-appropriate metrics — macro-F1, per-class recall, micro/macro tag F1, exact-set accuracy — instead of one accuracy number.
- Slice-level diagnosis by boundary pair, input length, and injection attempt.
- Run-to-run stability, which a single-shot evaluator cannot see.
- A calibrated judge, qualified against human scores before its 4.2/5 gate means anything.
- Per-task model recommendations MemoryApi's own evaluators cannot produce.

Both plans described the interchange artifacts in prose from opposite ends, which drifts. The revision defines them once as JSON Schema in MemoryApi (`memory-eval-snapshot.v1`, `prompt-promotion-record.v1`), vendored and validated by LMEval on import, with a schema-version or hash mismatch as a hard failure rather than a best-effort parse.

## Further suggestions

Not written into the plans — these are calls worth making deliberately rather than absorbing silently into scope.

### Run the model sweep before the prompt work, not after

The cheapest experiment available is the current production prompt across the candidate model slate, unchanged. If a model change alone clears the gate for a task, prompt refinement for that task becomes optional — and if it does not, the sweep still tells you the ceiling you are writing against. This inverts phase order for one throwaway run and is the highest-value hour in the whole plan.

### Derive the category tie-breakers from a measured confusion matrix

Both plans name the same boundaries a priori, and MemoryApi's revised prompt encodes tie-breakers for them. Those are plausible guesses about where a model gets confused, not observations. Run the baseline first, read the confusion matrix, then write tie-breakers for the confusions that actually occur. Prompt text spent on a boundary the model already handles is context budget spent on nothing.

### Report tagging recall by group, with per-tag as diagnosis only

61 tags at a minimum of two positive cases each means per-tag recall takes exactly three values: 0, 0.5, or 1. That is a useful pointer to a broken tag and a useless promotion statistic. `allTags.json` already carries four described groups — Context & Purpose, Cognitive/Intent, Domain/Subject, Technical & Usage — with roughly 15 tags each. Group-level recall has real resolution and maps to how the vocabulary is actually organized. Report groups; keep per-tag as a drill-down.

### The review UI is already generating labeled data

MemoryApi's status lifecycle has `draft → stored | rejected`, and the review UI is where a human corrects an auto-assigned category or tag set before promoting a memory. Every one of those corrections is a labeled disagreement between model and human, produced for free during normal use — the most valuable case type there is, since it is drawn from the real input distribution rather than from someone imagining hard cases. Capture the before/after pair at review time and route it into the candidate dataset for sanitization and annotation.

### Show contract violations as their own strip, not as low scores

For all three tasks the dominant failure mode is format, not semantics: a label with a period after it, a tag list wrapped in brackets, a summary that opens with "Here is a summary of". These are binary and fixable by prompt wording, and averaging them into a quality score hides both facts. LMEval's results view should carry a violations strip — invalid label, unknown tag, duplicate, wrapper text, truncation — above the quality panel. A model at 0.91 macro-F1 with a 12% wrapper-text rate is one sentence of prompt away from being the winner, and a blended score will never say so.

### Plot quality against latency; retire the leaderboard for these tasks

A ranked list implies a total order that overlapping confidence intervals do not support. A scatter of primary metric against p95 latency, with tie groups shaded and the gate drawn as a floor line, shows the actual decision: which models are admissible, which are indistinguishable, and which of those is cheapest.

### Measure whether classification and tagging should be one call

Ingestion makes three model calls per memory. Classification and tagging read the same content and draw on overlapping judgments, and a single structured response could return both — potentially a third of ingestion latency, and one less place for a model swap. The cost is coupling: one malformed response loses both fields, and the two tasks stop being independently promotable, which is exactly what this evaluation architecture is built to support. Worth a measured comparison as a deliberate follow-on, not worth assuming in either direction now.

### Keep the regression split away from the refinement loop

LMEval's automated refinement loop is the natural engine for iterating on these prompts, and these suites are what make running it safe. But an optimizer with access to the regression split converts the promotion gate into a training objective and destroys the only unbiased estimate in the system. Calibration split only, and its output arrives in MemoryApi as a candidate for review — never as a cross-repository write. This is stated in the LMEval plan; it is worth enforcing in code rather than in prose.
