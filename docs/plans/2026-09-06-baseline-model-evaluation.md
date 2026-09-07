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

## Phase 2 — full 6-model runs

Classification (288 cells) and tagging (324 cells) full runs, same prompts
and inference settings as the pilot, extended to all 6 models. Both were hit
by the concurrency cascade described above (182/288 and 209/324 cells
failed respectively) and were recovered via `POST /:id/retry` with
`{"failedCellsOnly": true}`, run one at a time once Tiny-Tower's
`activeRequests` confirmed idle — both retries completed 100% clean
(182/182, 209/209, zero failures). The numbers below combine each model's
complete data source: the original run for M5 Max models (100% intact
there) and the retry run for Tiny-Tower models (93-96% of each model's
cases; the 2-4 cells that happened to succeed in the original partial run
before it cascaded are not re-merged in, an accepted small gap).

**Before reading the table: two models produced systematically empty
responses, not systematically wrong ones.** `granite4.2:8b` (classification
and tagging) and `lfm2.5:8b` (classification) returned `response: ""` with
`finishReason: "length"` on every checked cell — the model consumed its
*entire* token budget (50/100, matching the production ceiling) without
emitting anything in the visible answer field, almost certainly hidden
reasoning/preamble tokens under a token budget too tight for these models'
default response style. This is exactly the failure mode
`2026-09-04-memoryapi-implementation-handoff.md` warned about: "make
truncation visible... rather than blending it into task quality." A 0%
accuracy score for these two is a **token-budget/format-fit finding, not an
accuracy finding** — they may perform very differently with more headroom
or a reasoning-suppression setting, and shouldn't be read as "worse at
classifying" than a model that actually attempted the task and got answers
wrong.

**Classification** (48 cases/model target; see per-row `n` for actual):

| Model | Accuracy | Macro-F1 | Invalid-label rate | n | Note |
|---|---:|---:|---:|---:|---|
| granite3.3:8b | 71.1% | 0.711 | 4.4% | 45 | |
| granite4.1:8b | 84.4% | 0.838 | 0% | 45 | strongest so far |
| granite4.2:8b | 0% | 0.000 | 100% | 46 | **empty responses, token-budget truncation — not a real accuracy result** |
| ministral-3:8b | 41.3%¹ | 0.531 | 54.3% | 46 | see ¹ below — mostly a formatting artifact, not accuracy |
| nemotron-mini:4b | 52.1% | 0.493 | 4.2% | 48 | |
| lfm2.5:8b | 0% | 0.000 | 100% | 48 | **empty responses, token-budget truncation — not a real accuracy result** |

**Tagging** (54 cases/model target):

| Model | Micro-F1 | Macro label-F1 | Exact-set match | Unknown-tag rate | n | Note |
|---|---:|---:|---:|---:|---:|---|
| granite3.3:8b | 0.277 | 0.130 | 0% | 66.3% | 52 | |
| granite4.1:8b | 0.473 | 0.356 | 11.5% | 27.0% | 52 | strongest so far |
| granite4.2:8b | 0.000 | 0.000 | 0% | 0% | 52 | **empty responses, token-budget truncation — not a real accuracy result** |
| ministral-3:8b | 0.411 | 0.321 | 18.9% | 19.6% | 53 | |
| nemotron-mini:4b | 0.513 | 0.442 | 22.2% | 25.0% | 54 | strongest overall on raw micro-F1 |
| lfm2.5:8b | 0.000 | 0.000 | 0% | 0% | 54 | **empty responses, token-budget truncation — not a real accuracy result** |

¹ **`ministral-3:8b`'s 54.3% invalid-label rate is mostly a parsing
artifact, not an accuracy problem.** It wraps its label in markdown bold
(`**Snippet**` instead of `Snippet`), and the exact-label assertion does a
literal string match with no markdown stripping. Checked directly: of its
27 "invalid" responses, 25 were markdown-wrapped, and stripping `**...**`
shows **18 of those 25 were the semantically correct label** — meaning
real accuracy is closer to **(19 clean-correct + 18 markdown-correct) / 46
≈ 80.4%**, not the reported 41.3%. This is exactly the "formatting drift"
failure category the tagging follow-up doc already named for tagging's
unknown-tag investigation — it shows up in classification too, and is a
prompt/parsing fix (either instruct against markdown formatting, or strip
`**`/backticks before the exact-label comparison), not a capability gap.
Recommend re-scoring or re-running this model with that fix before ranking
it against the others.

Directional read (excluding the two truncated models until re-tested with
more headroom, and reading `ministral-3:8b`'s corrected ~80% rather than
its reported 41.3% for classification): `granite4.1:8b` (84.4%) and
`ministral-3:8b` (~80.4% corrected) are the two strongest classifiers and
close enough that the markdown-stripping fix could plausibly flip the
ranking — re-run before deciding between them. On tagging, `nemotron-mini:4b`
and `granite4.1:8b` are close on raw micro-F1, with the unknown-tag-rate
caveat from earlier applying to both (and `ministral-3:8b`'s tagging output
wasn't checked for the same markdown-wrapping pattern — worth doing before
trusting its 0.411 micro-F1 either). None of the 6 models pass the strict
production gate at this case count — expected, per the case-count/CI
caveats above.

**Summarization full 6-model run was not attempted** — see below, it's
blocked on a real code bug, not a config choice.

### Summarization judge: a genuine routing bug, found and diagnosed

After the concurrency cascade was resolved and Tiny-Tower confirmed idle,
the 2-model summarization pilot re-ran cleanly (54/54 candidate calls
succeeded) — but **every judge (`llm-rubric`) assertion failed** with
`"No available servers or cloud providers host model
\"Tiny-Tower::qwen3.6:35b-a3b-q8_0\""`, producing a uniform floor score
(1.0/5 on every dimension, every case) that looks like real data but isn't
— it's every judge call failing identically, not the judge actually rating
every summary as terrible.

Diagnosed directly against LMApi, not just inferred from the error text:

- `POST /lmapi/api/chat/completions/server` with
  `{"model": "Tiny-Tower::qwen3.6:35b-a3b-q8_0", ...}` (server name embedded
  in the model string, colon-separated — the same format LMEval uses for
  `modelIds` everywhere else) → `400 {"error":"serverName is required"}`.
- The same call with `{"serverName": "Tiny-Tower", "model":
  "qwen3.6:35b-a3b-q8_0", ...}` (split into separate fields) → succeeds.

So the candidate-model call path (used for `granite3.3:8b`/`granite4.1:8b`
in this same run, which worked) evidently splits a server-qualified model
ID into `serverName` + `model` before calling `/server`, but the
judge-invocation path does not — it passes the colon-joined string through
as a single `model` field, which LMApi's `/server` endpoint rejects. This
is a reproducible bug in LMEval's judge-calling code
(`ExecutionService`/`PromptfooAdapter`'s judge provider construction), not
a configuration mistake on this run's part, and not something fixable
through the evaluation API — it needs a code change.

**Second, independent problem found in the same diagnostic call:**
`qwen3.6:35b-a3b-q8_0` is itself a reasoning/thinking model — the direct
LMApi test above returned `"content": ""` with a separate, populated
`"reasoning"` field, and `finish_reason: "length"` at only 20 output
tokens. This is the same failure shape as `granite4.2:8b`/`lfm2.5:8b`
above, but for the *judge*: even once the routing bug is fixed, this judge
model will likely need a materially larger token budget than whatever
LMEval's rubric-grading path currently allots, or it will return empty
verdicts the same way. Unlike the candidate-model token ceilings (which
must match production for a valid comparison), the judge's token budget is
pure evaluation tooling — there's no reason not to give it generous
headroom once the routing bug is fixed.

Not fixed in this session — flagging both precisely for whichever session
picks up code changes next, rather than attempting a fix while another
session is actively working in this codebase.

## Follow-up work (tracked elsewhere — not duplicated here)

A separate session picked up this doc's findings and turned them into
scoped engineering follow-ups and a dashboard/schema design while Phase 2
was still running. Rather than maintain two parallel todo lists, the
detailed suggestions below are kept as the original findings; the actions
taken on them live in:

- `docs/plans/2026-09-06-baseline-evaluation-followups.md` — scoped
  follow-ups for the tagging unknown-tag investigation, judge
  qualification, GPU-contention documentation (now also in
  `.claude/skills/lmeval-runner/SKILL.md`), and closing out Phase 2 under
  `docs/TASK.md` Track G's G8 requirement.
- `docs/plans/2026-09-06-evaluation-dashboard-and-sqlite-schema.md` — the
  full dashboard-views-plus-SQLite-schema design for the "local SQL
  database" idea below (design only as of this writing, no code yet).

One finding from the follow-ups doc worth surfacing here directly: the
tagging gate's zero-tolerance treatment of unknown tags may be scoring the
wrong thing. MemoryApi silently filters and drops any tag outside its known
vocabulary before storing it — an extra emitted tag costs nothing in
production, while a **missing** expected tag (lower recall) does. The
~37% unknown-tag rate observed in this baseline may be making both pilot
models look worse than they'd actually behave once deployed. The follow-up
doc proposes a `penalizeExtraTags` toggle on the tagging assertion strategy
to separate "did the gate fail because of missing tags" from "did it fail
because of harmless extra ones" — worth resolving before trusting the
tagging F1 numbers in this doc at face value.

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

**Update:** contention isn't only a slowness/latency-metric problem — it
can cause outright, cascading failures, and the failure mode is worse than
"the newest run pays the price." Running the summarization pilot (2 models)
concurrently with the two full 6-model classification/tagging runs (all
three sharing Tiny-Tower) eventually took down **all three**:
summarization: 54/54 candidate-call timeouts; classification-full: 182/288
failed (all four Tiny-Tower models, ~equally, M5 Max models mostly fine);
tagging-full: 209/324 failed, same pattern, appearing only in the final
aggregated result after sitting at "323/324, zero failures" for several
minutes of polling.

**Root cause, confirmed by observation, not just inferred:** a client-side
120-second HTTP timeout does not cancel the underlying Ollama generation —
the server keeps computing regardless of whether the caller gave up. LMApi
retries a timed-out call up to 3 times with backoff, so each failure adds
*more* queued work on top of a server that was already too far behind to
answer the first attempt in time. This compounds: once concurrent load
exceeds what the box can actually serve, timeouts and retries feed each
other into a growing backlog rather than backing off. Direct evidence: after
both evaluations reported `status: completed`, `GET /lmapi/api/servers`
still showed **4 active requests on Tiny-Tower for another ~90 seconds** —
ghost work from already-abandoned client calls that Ollama was still
grinding through.

**Recovery procedure used:** poll `GET /lmapi/api/servers`'s
`activeRequests` for the target server until it actually reaches 0 (not
just until the evaluation reports `completed` — that reflects the
client-side view, not whether the server has stopped working), then use
`POST /evaluations/{id}/retry` with `{"failedCellsOnly": true}` to
re-run only the failed cells as a new, scoped evaluation — and retry
evaluations **one at a time**, not concurrently, this time.

**Standing rule going forward:** never run more than one evaluation against
the same LMApi-backed server at once. `EVAL_CONCURRENCY`'s default (8)
assumes far more server-side concurrency headroom than this Tiny-Tower box
(64GB VRAM, several models loaded) actually has — confirm
`GET /lmapi/api/servers`'s `activeRequests` is 0 for a server before
starting a new evaluation against it, not just before retrying a failed
one.

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

1. **Resolve the token-budget truncation** for `granite4.2:8b` and
   `lfm2.5:8b` before scoring them further — either a larger `maxTokens`
   experiment (off production-parity, exploratory only) or checking for a
   reasoning-suppression / non-thinking mode for these models, then
   re-run classification and tagging for just these two.
2. **Fix or work around `ministral-3:8b`'s markdown-wrapping** (prompt
   instruction against markdown, or strip `**`/backticks before the
   exact-label comparison) and re-run before trusting its ranking against
   `granite4.1:8b`.
3. **Fix the judge-routing bug** (judge-invocation path doesn't split a
   server-qualified `modelId` into `serverName`/`model` before calling
   `/lmapi/api/chat/completions/server`, unlike the candidate-model path) —
   this blocks any summarization judge score, not just this session's pilot.
   Once fixed, give the judge a materially larger token budget than the
   candidate ceilings, since `qwen3.6:35b-a3b-q8_0` is itself a
   reasoning/thinking model that needs headroom beyond its final verdict
   tokens (confirmed directly: 20 tokens produced empty `content` with a
   separate populated `reasoning` field).
4. Extend summarization to all 6 models once the judge routing/token-budget
   issue is fixed and the two candidate-side truncation/formatting issues
   above are resolved (no point scoring rubric quality on responses that
   are empty or markdown-mangled).
5. Decide, per activity, whether any model is a clear enough winner to act
   on, or whether the case-count/CI caveats mean this stays directional
   only until real MemoryApi snapshot data lands.

## Addendum (2026-09-07): two models excluded from the candidate list

`granite4.2:8b` and `lfm2.5:8b` are excluded from further evaluation —
observed directly in LMApi's own logs (not an LMEval scoring artifact) to
not be returning proper responses. Any of this doc's numbers for those two
models above should be read as unreliable/inconclusive on that basis, not
as a genuine accuracy result. Do not include either model in a new
evaluation matrix until this is independently re-verified against LMApi.
Current candidate status and the full handoff for outstanding work:
[`docs/plans/2026-09-07-model-candidate-status-and-handoff.md`](2026-09-07-model-candidate-status-and-handoff.md).
