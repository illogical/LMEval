# Baseline Model Evaluation — Classification, Tagging, Summarization

## Context

Goal: baseline classification/tagging/summarization accuracy across six local
Ollama models — `granite3.3:8b`, `granite4.1:8b`, `granite4.2:8b`,
`ministral-3:8b`, `nemotron-mini:4b`, `lfm2.5:8b` — using LMEval's existing
evaluation pipeline against LMApi. This is a **mechanics-first pass**: prove
the system can be configured, executed, and its results gathered end-to-end
(starting with just the two granite models), before trusting any per-model
accuracy verdict. This doc is both the working record and the "how this was
configured, and how to improve it" reference requested alongside the run.

Companion process notes live in two skill files updated during this work:
`.agents/skills/lmeval-evaluation-workflow/SKILL.md` (added an "Environment"
section — see below) and the new `.claude/skills/lmeval-runner/SKILL.md`
(a terser local cheat sheet for this workspace's URLs and server topology).

## Environment discovered this session

- LMEval and LMApi run **co-hosted under HomeBase** on one shared port:
  - LMEval API: `http://localhost:17110/lmeval/api/eval/...`
  - LMApi (Ollama gateway): `http://localhost:17110/lmapi/api/...`
  - Neither is documented in the checked-in skill/client defaults —
    `scripts/lib/LMEvalClient.ts` still defaults to standalone mode
    (`http://localhost:3200/api/eval`), and LMApi's own internal port is
    17100. This mismatch is a known gap, not yet root-caused; the skill now
    tells future agents to try the HomeBase path first.
- **Two Ollama servers** sit behind LMApi:
  - **Tiny-Tower** (local) — granite3.3:8b, granite4.1:8b, granite4.2:8b,
    ministral-3:8b, plus a range of larger models.
  - **M5 Max** (remote, 192.168.7.x) — additionally has `nemotron-mini:4b`
    and `lfm2.5:8b`, which Tiny-Tower does not.
  - Model IDs LMEval expects are server-qualified: `ServerName::model:tag`.
    All 6 target models were already pulled somewhere in the fleet — no
    downloads were needed for the model set itself.
- The **running server's data directory does not match this checkout's**
  `data/evals/` on disk — `GET /prompts` only returned one prompt
  (`draft-prompt-a`) despite several manifests existing on disk
  (`memoryapi-classification-ebeab68b4f74`, various `agent-smoke-*`
  fixtures). Worth investigating separately; for this run I treated the
  live API as authoritative and created fresh prompts through it rather
  than assuming on-disk manifests were reachable.

## What was configured, and why

For each activity, one MemoryApi-seeded prompt was created via
`POST /prompts` from that purpose template's `seedPromptContent` (the
current MemoryApi production prompt text), rather than reusing an
unreachable on-disk manifest:

| Activity | Prompt ID | Test suite | Inference override |
|---|---|---|---|
| Classification | `prm-mtqn1clk-51cizi` | `memory-classification-v1` (~70 cases) | temp 0.3, maxTokens 50 |
| Tagging | `prm-mtqn1cmh-qu2607` | `memory-tagging-v1` (~54 cases) | temp 0.3, maxTokens 100 |
| Summarization | `prm-mtqn1cne-szwdk8` | `memory-summarization-v1` (~54 cases) | temp 0.3, maxTokens 150 |

The `temp 0.3 / 50-100-150 maxTokens` overrides are **not** the purpose
template's own default (1000 tokens, tuned for exploratory work) — they
come from `docs/plans/2026-09-04-memoryapi-implementation-handoff.md`,
which documents these as MemoryApi's actual production inference settings
per task. A run meant to say anything about production model choice has to
match production's token ceiling, or a model's accuracy score partly
reflects "did it fit its answer in 1000 tokens" instead of "is it accurate
under the constraints it will actually run under."

Each evaluation was built through the **draft-first** flow the checked-in
agent skill documents (`validate` → `drafts` → `run` → poll `feedback` →
read `summary`), not the legacy create-and-start endpoint — this is what
the maintained workflow reference recommends and what produces a reviewable
`browserPaths.config` link before anything executes.

`comparisonMode: 'model'` was used throughout (one pinned prompt, N models)
since the question being asked is "which model is more accurate," not
"which prompt wording is better" — mixing both axes in one matrix would
have made it impossible to attribute a score difference to either variable.

## Pilot results (granite3.3:8b vs granite4.1:8b)

All three pilot evaluations completed with **zero execution failures**
(server calls all succeeded; failures below are assertion/accuracy misses,
not crashes) — confirming the pipeline itself works end-to-end.

**Classification** (48 cases/model):

| Model | Accuracy | Macro-F1 | Invalid-label rate | Gate |
|---|---:|---:|---:|---|
| granite3.3:8b | 68.8% | 0.695 | 6.3% | fail |
| granite4.1:8b | 85.4% | 0.847 | 0% | fail (inconclusive — CI straddles the 0.90 gate at n=48) |

granite4.1:8b is clearly stronger here. Neither passes the strict
production gate (macro-F1 ≥ 0.90, zero invalid labels, per-class recall ≥
0.80) — expected at this case count and with 8B-class models against a
gate tuned for larger models.

**Tagging** (54 cases/model):

| Model | Micro-F1 | Macro label-F1 | Exact-set match | Unknown-tag rate |
|---|---:|---:|---:|---:|
| granite3.3:8b | 0.368 | 0.224 | 1.9% | 36.6% |
| granite4.1:8b | 0.500 | 0.377 | 14.8% | 37.8% |

granite4.1:8b again ahead, but the standout finding is the **~37%
unknown-tag rate for both models** — over a third of emitted tags fall
outside the fixed 60-tag vocabulary the prompt explicitly restricts output
to. That's a bigger problem than raw F1 and worth its own follow-up (see
Suggestions below) independent of which model "wins."

**Summarization** — hit two real problems, both instructive:

1. First attempt returned all-zero rubric scores across the board. Root
   cause: I passed `judgeModelId` but not `templateId`. LMEval's
   `ExecutionService` only attaches `llm-rubric` judge assertions when
   `config.templateId` resolves to an `EvalTemplate`
   (`server/services/ExecutionService.ts:511`) — the purpose template's own
   `assertionStrategy.config.templateId` (`"summarization-quality"`) is
   *not* auto-applied. Deterministic checks (no-preamble, no-fence,
   protected-token preservation) ran fine regardless and are a useful
   signal on their own; `compressionInRangeRate` was only 33%, meaning both
   models frequently summarize outside the expected 35–69% compression
   band — worth a closer look independent of the judge story.
2. Re-run with `templateId: 'summarization-quality'` added and
   `Tiny-Tower::mistral-medium-3.5:128b` as judge. This model had just been
   removed from Tiny-Tower (VRAM there was reduced from 96GB to 64GB, and
   128B no longer fit) — the run kept crawling forward on an
   already-loaded-in-memory copy rather than failing outright, but far too
   slowly to be practical (a 128B dense judge doing up to 12 rubric calls
   per candidate response). Cancelled once identified.

**Judge model decision:** researched alternatives that fit 64–96GB and
don't require a slow dense 128B model. Selected **`qwen3.6:35b-a3b-q8_0`**
(already pulled on Tiny-Tower, no download) — a mixture-of-experts model
with ~3B active parameters per token, so it runs at roughly 8B-class speed
while reasoning at 35B-class quality, comfortably inside the 64GB budget.
`glm-4.7-flash:q8_0` (also already pulled) is a good second option to
cross-check judge agreement. `llama3.3:70b` (not yet pulled, ~43GB at
Q4_K_M) is the most literature-validated "judge" checkpoint if a second,
more authoritative opinion is wanted later — dense and slower, but still
comfortably within 64GB.

## Phase 2 — full 6-model runs (in progress)

Classification (288 cells) and tagging (324 cells) full runs, same prompts
and inference settings as the pilot, extended to all 6 models
(`granite3.3:8b`, `granite4.1:8b`, `granite4.2:8b`, `ministral-3:8b`,
`M5 Max::nemotron-mini:4b`, `M5 Max::lfm2.5:8b`), were started and were
still running as of this writing, with zero failures reported so far.
Progress noticeably stalled while the (since-cancelled) 128B summarization
judge run was competing for the same Tiny-Tower GPU — a real resource-
contention lesson: don't run a heavy judge pass concurrently with candidate
matrix runs on the same box. Summarization's full 6-model run has not yet
been started — it's queued behind confirming the new judge model produces
sane (non-zero) rubric scores on the 2-model pilot first.

*(This section will be updated with final numbers once Phase 2 and the
summarization re-run complete.)*

## Suggestions for improving the evaluation setup

- **Ground truth is pending-human-review.** All three built-in suites are
  explicitly flagged `reviewStatus: "pending-human-review"` in their
  provenance — they were authored as MemoryApi-shaped placeholder fixtures,
  not sampled from real production data or reviewed by a human. Every gate
  verdict in this run carries a `"Benchmark ground truth is pending human
  review"` advisory for exactly this reason. Real MemoryApi snapshot import
  (blocked upstream per the transport-parity handoff doc) would be the
  single highest-value fix to evaluation validity.
- **Case counts are too small for tight confidence intervals.** 48-54
  cases/model produced CIs wide enough to make several verdicts
  "inconclusive" rather than pass/fail (e.g. granite4.1:8b's classification
  CI of 0.75-0.94 straddles the 0.90 gate; the system itself estimates
  ~153 more cases would be needed to resolve it). Fine for a mechanics
  pilot, not enough to declare a winner with confidence.
- **`runsPerCell: 1` doesn't measure a model's own run-to-run variance.**
  Worth 3 runs/cell in a follow-up once the model shortlist narrows, so
  variance can be separated from genuine accuracy differences.
- **Tagging's ~37% unknown-tag rate deserves its own investigation**,
  independent of the model comparison — both granite models are frequently
  emitting tags outside the fixed 60-tag vocabulary despite the prompt
  explicitly restricting output to that list. Worth checking whether this
  is a prompt-adherence problem specific to smaller models, a vocabulary
  formatting issue, or an assertion-strategy parsing quirk before trusting
  the F1 numbers at face value.
- **Summarization's judge must be qualified before its gate is a hard
  pass/fail rather than advisory** — run a calibration pass against
  `data/evals/calibration/summarization-v0.json` for whichever judge model
  is chosen.
- **Don't run a heavy judge model concurrently with candidate matrix runs
  on the same GPU** — observed directly this session as a multi-minute
  stall in the classification/tagging full runs while the (since-cancelled)
  128B judge run was active on the same box.

## Methodology caveat: latency/duration numbers are not comparable as-is

Every cell result includes `durationMs`, `tokensPerSecond`, and `serverName`,
and `modelId` is itself server-qualified (`Tiny-Tower::...` vs
`M5 Max::...`), so machine attribution is already captured without any new
logging. But two confounds mean these numbers can't be read as "model X is
faster than model Y" without more care:

1. **Same-box concurrency.** `EVAL_CONCURRENCY` (default 8) runs multiple
   cells in parallel against the same physical GPU, and this session ran
   three evaluations concurrently against Tiny-Tower (the summarization
   judge pilot plus both full classification/tagging runs) — a multi-minute
   stall was observed in the full runs while the (since-cancelled) 128B
   judge run shared the same box. Any duration recorded during that window
   reflects contention, not model speed.
2. **Cross-machine comparison.** Tiny-Tower and M5 Max are different
   hardware; a duration difference between a Tiny-Tower model and an M5 Max
   model says nothing about the models themselves unless the machines are
   accounted for.

Handling going forward: treat `avgDurationMs`/`avgTokensPerSecond` as
informational only (they're already outside the accuracy gate) and never
rank models by them from these runs. Only flag extreme outliers (e.g. a
cell >3x its run's own median duration) as an operational note about
contention, not a performance claim. A genuine throughput comparison needs
its own dedicated run — `EVAL_CONCURRENCY=1`, one evaluation at a time,
ideally one server's models per run — rather than trying to extract timing
truth from a run optimized for accuracy-matrix wall-clock efficiency.

## On introducing a local SQL database

Recommendation: **not blocking, but worth prototyping right after this
baseline**, as a thin *index* layer over the existing per-evaluation JSON
files rather than a replacement for them.

- Keep `data/evals/evaluations/{id}/*.json` as the source of truth.
- Add a lightweight SQLite database (e.g. `data/evals/index.db`) with one
  row per (evaluation × model × activity), storing: `evalId`,
  `activity`/`purposeCategory`, `modelId`, `promptId` + `promptVersion` (and
  either the resolved prompt text or a hash + pointer to its `.md` version
  file), `resolvedInference` (temperature/maxTokens/seed), key metrics
  (macro-F1, micro-F1, median rubric score, etc.), `gateVerdict`, and
  `createdAt`.
- Turns "which model has won at tagging across all runs so far" into one
  SQL query instead of re-reading every `summary.json`, and gives a
  durable, queryable history across evaluations that today only exists as
  separate files scattered by eval ID.
- Low effort (single table, populated by a small write-through step at the
  end of `SummaryService.aggregate`), reversible, and doesn't compete with
  or duplicate Promptfoo/LMEval's existing execution engine — pure
  reporting/index layer.

## Next steps

1. Confirm `qwen3.6:35b-a3b-q8_0` produces sane, non-zero rubric scores on
   the 2-model summarization pilot.
2. Extend summarization to all 6 models once confirmed.
3. Let the full classification/tagging 6-model runs finish; add their
   per-model leaderboards to this doc.
4. Decide, per activity, whether any model is a clear enough winner to act
   on, or whether the case-count/CI caveats mean this stays directional
   only until real MemoryApi snapshot data lands.
