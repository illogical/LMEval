# Baseline Evaluation Follow-Ups (Non-Dashboard)

## Context

`docs/plans/2026-09-06-baseline-model-evaluation.md`'s "Suggestions for
improving the evaluation setup" and "Next steps" sections raised several
items unrelated to the SQL/dashboard question, which is instead covered in
`docs/plans/2026-09-06-evaluation-dashboard-and-sqlite-schema.md`. This doc
turns the remaining items into scoped follow-ups so they aren't left as
prose in a dated pilot-run record, and ties each one to the existing
mechanism in `docs/TASK.md`/`docs/SPECIFICATION.md` it actually belongs to
rather than inventing new scope.

Two items from the baseline doc are **not** repeated here because they're
already substantively addressed:
- **Case-count/CI-width caveats** and **`runsPerCell: 1` variance risk** —
  both are exactly what Track A7 (`docs/TASK.md`) already built:
  `runsPerCell: 3` defaults, bootstrap CIs, and an `inconclusive` verdict
  (rather than a false pass) when the CI straddles a gate. No new scope.
- **Ground truth is `pending-human-review`** — already tracked as A5's open
  item (human review-ledger approval) in `docs/TASK.md`.

## 1. Tagging's ~37% unknown-tag-rate investigation

Both pilot models (granite3.3:8b, granite4.1:8b) emitted tags outside the
fixed 60-tag vocabulary on roughly a third of cases, despite the prompt
explicitly restricting output to that list. `docs/TASK.md` §5.4 already
proposes a general "contract-violations strip" for exactly this failure
class ("format, not semantics" being the dominant failure mode across all
three tasks) — this finding is the concrete empirical trigger for that idea,
not a new one, and is now also planned as a standing dashboard panel (see
the dashboard doc's "Diagnostic/quality-issue panel").

Before trusting tagging F1 numbers at face value, isolate which of three
causes is responsible:
1. **Prompt-adherence** — the model disregards the vocabulary constraint
   outright (would show up as semantically plausible but off-list tags).
2. **Formatting drift** — casing, pluralization, or synonym drift against the
   fixed list (would show up as near-miss strings, e.g. `"projects"` vs. the
   vocabulary's `"Project"`).
3. **Parsing quirk** — `AssertionStrategyService`'s comma-split-and-trim
   parsing (per `docs/TASK.md` A6: "raw output parsed by comma-split + trim
   only, no repair") mis-splitting a valid multi-word tag.

Concretely: pull the actual off-vocabulary tag strings from a completed
tagging run's `results.json` and bucket them against these three categories
by hand before deciding whether this is a model problem, a prompt problem,
or an assertion-parsing problem.

### 1a. Whether an unknown tag should gate at all

Today's tagging gate treats any unknown tag as an automatic gate failure —
`docs/TASK.md` A6: "Gate: micro-F1 ≥ 0.85, macro label-F1 ≥ 0.70, exact-set
≥ 0.60, **zero invalid (unknown) tags**." That zero-tolerance rule is
worth reconsidering against how MemoryApi actually consumes tagging output:
MemoryApi filters and ignores any emitted tag that isn't in its known
vocabulary before storing it — an extra tag is silently dropped downstream,
not a production defect. What actually costs MemoryApi something is a
**missing** expected tag (an under-generation, i.e. low recall), not an
**extra** one (over-generation against the vocabulary). Scoring the two
symmetrically — one unknown tag among ten failing the gate exactly as hard
as missing five expected tags — doesn't match production impact, and the
baseline run's ~37% unknown-tag rate may be making both pilot models look
worse than they'd actually behave in MemoryApi.

There's also a second-order reason not to just zero out `unknownTagRate`:
the *specific* extra tags a model reaches for are a free signal about
vocabulary gaps — a model repeatedly reaching for something like `"Recipe"`
or `"Travel"` that isn't in the 60-tag list is a hint MemoryApi's vocabulary
is missing a category people's memories actually need, not (only) a model
failure. Silently discarding that signal (either by hard-gating on it today,
or by ignoring it entirely if the gate were simply removed) throws away
information worth mining later.

Proposed follow-up, scoped as a config change rather than new
infrastructure — add a toggle to the `label-overlap` assertion strategy
config (`AssertionStrategy` in `src/types/eval.ts`,
`server/services/AssertionStrategyService.ts`), e.g.
`penalizeExtraTags?: boolean` (default `true`, preserving today's behavior
for any task where extras genuinely matter):
- `penalizeExtraTags: false` — `unknownTagRate` is computed and reported as
  today (so it's still visible everywhere it currently is: `summary.json`,
  the diagnostic panel in `docs/plans/2026-09-06-evaluation-dashboard-and-sqlite-schema.md`),
  but excluded from the tagging gate's pass/fail decision. The gate becomes
  **recall-weighted**: did the model surface enough of the expected tags,
  regardless of what else it also suggested.
- `penalizeExtraTags: true` (current, default) — unchanged, unknown tags
  still zero-gate.
- Set `penalizeExtraTags: false` on MemoryApi's tagging purpose template
  specifically, since that's the one task where a downstream consumer is
  known to already filter extras — this is a MemoryApi-shaped production
  fact, not a general claim that extra tags never matter for any future
  tagging use case, so the default stays `true` for anything else.
- Track extra-tag frequency as its own named metric per tag (not just an
  aggregate rate) in `eval_run_metrics` (the dashboard doc's EAV table) so
  "which off-vocabulary tags keep coming up, and how often" becomes a
  queryable trend over time — the mechanism for turning "the model wants a
  tag we don't have" into an actual vocabulary-expansion candidate list,
  reviewed by a human before ever touching MemoryApi's real vocabulary (this
  doesn't cross the MemoryApi/LMEval boundary itself — it's LMEval surfacing
  a signal, per `[[memoryapi-lmeval-relationship]]`, for a human to act on in
  MemoryApi's own repo).

## 2. Judge qualification for `qwen3.6:35b-a3b-q8_0`

The baseline doc selected `qwen3.6:35b-a3b-q8_0` as the summarization judge
(a mixture-of-experts model chosen to fit a 64GB VRAM budget after
`mistral-medium-3.5:128b` was removed from Tiny-Tower) and ran it
operationally, but never through the qualification mechanism
`docs/TASK.md` Track A8 already built:
`server/services/JudgeQualificationService.ts`'s `qualify()`, which checks
Spearman ≥ 0.6 vs. human overall, Faithfulness-within-1-point ≥ 80%, mean
inflation within 0.5, and per-dimension self-consistency MAD ≤ 0.5 against
`data/evals/calibration/summarization-v0.json`.

Until this runs, `SummarizationTaskMetrics.gate.verdict` stays forced to
`advisory` regardless of how the rubric scores look
(`docs/SPECIFICATION.md` §3, A8's forcing rule) — meaning the summarization
gate cannot report a real pass/fail today no matter how many models are
compared.

Action: `POST /api/eval/judges/qwen3.6:35b-a3b-q8_0/qualify`, confirm it
clears all four thresholds, and only then treat a summarization gate verdict
from this judge as promotable rather than advisory-only.

Secondary judges already identified in the baseline doc, kept for reference:
- `glm-4.7-flash:q8_0` — good cross-check for judge agreement, already
  pulled on Tiny-Tower.
- `llama3.3:70b` — the most literature-validated checkpoint if a second,
  more authoritative opinion is wanted later; not yet pulled (~43GB at
  Q4_K_M), still comfortably inside the 64GB budget.

## 3. GPU-contention operational guidance

Observed directly in the baseline run: a multi-minute stall in the full
classification/tagging matrix runs while a (since-cancelled) 128B
summarization judge pass competed for the same Tiny-Tower GPU. This is not a
code defect — `EVAL_CONCURRENCY` and the evaluation engine behaved as
designed — it's an operational rule that wasn't written down anywhere an
agent would see it before starting a run.

Action: add this rule directly to
`.claude/skills/lmeval-runner/SKILL.md` (the workspace's local cheat sheet
for server topology and ports), since that's the file an agent reads before
touching LMEval's API in this workspace — not left buried in a dated plan
doc where it won't be seen next time. Suggested addition to that skill file:

> **Don't run a heavy judge pass concurrently with a candidate matrix run on
> the same physical box.** A dense/large judge model competing for the same
> GPU as an in-progress classification/tagging/summarization matrix run will
> silently stall the matrix run (observed: multi-minute stalls), not fail it
> — so the symptom looks like slowness, not an error. Check what's already
> running on Tiny-Tower/M5 Max before starting a judge-qualification or
> judge-comparison pass.

## 4. Finishing Phase 2

The baseline doc's Phase 2 (full 6-model classification/tagging runs, plus a
summarization re-run once the qwen3.6 judge is confirmed sane) was still
in progress as of that doc's last update. This is not new scope — it's the
concrete instance of `docs/TASK.md` Track G's **G8 — Live three-task
evidence** requirement ("execute bounded production-shaped classification,
tagging, and summarization smokes... record IDs, pinned prompts,
models/judge, call counts, paths, failures, verdicts, and advisory
reasons"). Track this as one thread, not two documents independently
tracking the same pending work: closing out Phase 2's six-model runs (with
the qualified judge from item 2 above) is how G8 gets closed for these three
tasks, rather than a separate baseline-doc todo list running in parallel.

## Summary of actions and where they're tracked

| Item | Action | Tracked in |
|---|---|---|
| Tagging unknown-tag rate | Bucket off-vocabulary tags into prompt-adherence / formatting / parsing causes | New — this doc; empirical trigger for `docs/TASK.md` §5.4 |
| Unknown-tag gate severity | Add `penalizeExtraTags` toggle to `label-overlap` config; default off for MemoryApi's tagging template since production already filters extras; track per-tag extra frequency as a vocabulary-gap signal | New — this doc (§1a) |
| Judge qualification | Run `qualify()` for `qwen3.6:35b-a3b-q8_0` against the existing calibration set | Uses existing A8 mechanism; no new code |
| GPU contention | Add explicit rule to `.claude/skills/lmeval-runner/SKILL.md` | Documentation-only, this doc |
| Finish Phase 2 | Complete the 6-model runs across all three activities | `docs/TASK.md` Track G, G8 |
| Case-count/CI width, `runsPerCell` | No new action — already built | `docs/TASK.md` Track A7 |
| Ground-truth review status | No new action — already tracked | `docs/TASK.md` Track A5 |
