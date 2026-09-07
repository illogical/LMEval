# Handoff: Model Candidate Status + Outstanding Work from the Insights Dashboard

## Purpose of this doc

This is a handoff for a fresh session. It has two jobs: (1) record the
current, human-verified model candidate status so nobody re-evaluates a
model that's already known to be broken, and (2) list every concrete item
left outstanding from the cross-run Insights dashboard work
(`docs/plans/2026-09-06-evaluation-dashboard-and-sqlite-schema.md`, Track H
in `docs/TASK.md`) and the baseline follow-ups
(`docs/plans/2026-09-06-baseline-evaluation-followups.md`), so a new session
doesn't have to re-derive any of it from prior conversation history.

Read order for a fresh session: this doc first (for current priorities),
then follow the specific plan-doc links below for the full reasoning behind
each item.

---

## 1. Model candidate status (2026-09-07)

### Excluded — do not include in any new evaluation matrix

| Model | Reason | Source |
|---|---|---|
| `granite4.2:8b` | Not returning proper responses, observed directly in **LMApi's own logs** — not an LMEval scoring artifact (i.e. this isn't "scored low," it's "the transport/model layer itself is misbehaving") | User, 2026-09-07 |
| `lfm2.5:8b` | Same — not returning proper responses per LMApi logs | User, 2026-09-07 |

Both were part of the original 6-model baseline set in
`docs/plans/2026-09-06-baseline-model-evaluation.md`. Any scores recorded
for these two in that doc (and in the SQLite index backfilled from it — see
§2 below) should be treated as **unreliable, not as a genuine accuracy
result**. Do not re-run either without first independently confirming with
LMApi that the underlying transport/model issue is resolved — re-running
against the same broken path will just reproduce the same bad data.

This exclusion is now recorded in `.claude/skills/lmeval-runner/SKILL.md`
(under "Model exclusions") so a future agent session sees it before
configuring a new run, not just in this dated doc.

### Tagging / classification — user-verified candidate shortlist

Based on direct review (not just the automated gate numbers), the user's
current shortlist for tagging and classification work is:

- `granite3.3:8b`
- `granite4.1:8b`
- `ministral-3:8b`
- `nemotron-mini:4b`

Treat this as the active candidate set for both classification and tagging
follow-up runs going forward, in place of the original 6-model list. This
narrows Phase 2 (§3 below) from 6 models to these 4 for classification and
tagging specifically.

### Summarization — open, no shortlist yet

The user has not reviewed summarization output as closely and is **open to
suggestions** for which models to run against once the judge is qualified
(§4 below). Do not assume the tagging/classification shortlist above
transfers directly — summarization is graded on much more subjective
criteria (faithfulness, coverage, concision) than an exact-label or
tag-overlap task, so a model that reproduces labels well is not evidence it
summarizes well.

**Starting point for a fresh session to propose against**: the same 4
tagging/classification survivors above are a reasonable default set to
include (they're already confirmed to respond properly, which
`granite4.2:8b`/`lfm2.5:8b` are not), but this is not a settled decision —
surface it to the user as an open question, and don't run a large
summarization matrix before they've weighed in. `qwen3.6:35b-a3b-q8_0` is
the current *judge* candidate for summarization (see §4) — a judge should
generally not also be one of the models under evaluation for that same run
(the self-judge guard in `docs/SPECIFICATION.md` §3 will flag/gate this
automatically if it happens, per A6/A8, but it's cleaner to just not
propose it as a candidate for its own judged run in the first place).

---

## 2. Insights dashboard (Track H) — outstanding items

The cross-run SQLite index + `/insights` dashboard is **built, tested, and
verified working end-to-end** as of 2026-09-07 — see `docs/TASK.md` Track H
for the full completion record. Two items were explicitly called out as
not built, rather than silently left incomplete:

### 2a. `promptTextHash` — done (2026-09-07)

`InsightsIndexService.recordEvaluation()` now resolves `promptId` +
`promptVersion` (already computed for the row) through
`PromptService.getVersionContent()` and sha256-hashes it inline, rather than
threading a new field through `ExecutionService.aggregate()`'s options as
originally sketched — the promptId/version were already in scope at the
point the row is written, so no new plumbing was needed. `null` only when
the prompt/version can't be resolved (e.g. deleted since the run). Tests in
`server/services/__tests__/InsightsIndexService.test.ts`.

### 2b. Playwright walkthrough of `InsightsPage.tsx` is owed

Same standing convention as every other frontend surface in this repo's
Track E ("Verification debt") — `tsc`/lint/vitest passing is not the same
claim as a live browser walkthrough. Nobody has clicked through `/insights`
in an actual browser yet. Concretely: verify the activity tabs, leaderboard
table sorting/gray-out-on-pending-review-status, the CI-band trend chart
rendering, the gate-verdict-history grid's hover tooltips, the diagnostic
metric picker, and the operational panel's server-labeled series — against
a real populated index (run `npm run insights:backfill` first if the local
`data/evals/index.db` is empty).

### 2c. Not actually a gap, but worth knowing

The dashboard only has real trend data once there are 2+ indexed runs per
model per activity — with the tagging/classification shortlist now narrowed
to 4 models (§1 above) and `granite4.2:8b`/`lfm2.5:8b` excluded, re-running
Phase 2 (§3) against the corrected model list will also be what makes the
CI-band and gate-verdict-stability views actually useful for the first
time, rather than showing single-point leaderboards.

---

## 3. Finishing the baseline evaluation (Phase 2) — now with a corrected model list

`docs/plans/2026-09-06-baseline-model-evaluation.md`'s Phase 2 (full
multi-model classification/tagging runs, plus a summarization run once the
judge is qualified) was left in-progress. This is the concrete instance of
`docs/TASK.md` Track G's **G8 — Live three-task evidence** — track
completion there, not as a separate parallel item.

**Before restarting Phase 2**, apply §1's corrected model list:
- Classification + tagging: run against `granite3.3:8b`, `granite4.1:8b`,
  `ministral-3:8b`, `nemotron-mini:4b` only — **not** the original 6-model
  set, since 2 of those 6 are now known-excluded.
- Summarization: hold until the user has weighed in on a candidate list
  (§1's open question) and the judge is qualified (§4 immediately below).

---

## 4. Judge qualification for `qwen3.6:35b-a3b-q8_0` — still not run

From `docs/plans/2026-09-06-baseline-evaluation-followups.md` §2, unchanged
and still blocking a real (non-`advisory`) summarization gate verdict:

`qwen3.6:35b-a3b-q8_0` was selected as the summarization judge and run
operationally, but has never been passed through
`server/services/JudgeQualificationService.ts`'s `qualify()` against
`data/evals/calibration/summarization-v0.json`. Until this runs,
`SummarizationTaskMetrics.gate.verdict` stays forced to `advisory`
regardless of score (A8's forcing rule, `docs/SPECIFICATION.md` §3).

**Action**: `POST /api/eval/judges/qwen3.6:35b-a3b-q8_0/qualify`, confirm it
clears all four thresholds (Spearman ≥ 0.6, Faithfulness-within-1 ≥ 80%,
mean inflation within 0.5, self-consistency MAD ≤ 0.5). Secondary judge
options (`glm-4.7-flash:q8_0`, `llama3.3:70b`) are recorded in the same
followups doc if `qwen3.6:35b-a3b-q8_0` doesn't qualify.

---

## 5. Tagging's unknown-tag-rate investigation

From `docs/plans/2026-09-06-baseline-evaluation-followups.md` §1/§1a: both
pilot models showed a ~37% unknown-tag rate against the fixed 60-tag
vocabulary. Two threads — one now closed:

1. **Root cause** — bucket actual off-vocabulary tag strings from a
   completed tagging run's `results.json` into prompt-adherence /
   formatting-drift / assertion-parsing-quirk, per §1's investigation plan.
   **Still open.**
2. **Whether it should gate at all** — **done (2026-09-07)**. The
   `penalizeExtraTags?: boolean` toggle now exists on `label-overlap`'s
   config (`src/types/eval.ts`, `AssertionStrategyService.ts`,
   `SummaryService.computeTaggingMetrics()`, `PromptfooAdapter.ts`), default
   `true`, set `false` on MemoryApi's built-in tagging purpose template
   (`data/evals/purpose-templates/tagging.json`). `unknownTagRate` is still
   always computed/reported; with the toggle off it no longer zero-gates and
   the CI-backed gate metric switches to per-case recall instead of Jaccard.
   `macroLabelF1`/`exactSetMatchRate` are intentionally unaffected by the
   toggle. See `docs/TASK.md` §5.11 for the full writeup. **Still open**:
   tracking which specific extra tags recur as a named per-tag
   `eval_run_metrics` signal, per §1a — needs the raw off-vocabulary token
   list threaded out of `computeTaggingMetrics()`, which wasn't part of this
   pass.

---

## 6. Closed, no action needed

For completeness, so a fresh session doesn't re-open these:

- **GPU contention** (judge pass + candidate matrix run competing for the
  same GPU) — documented as a standing rule in
  `.claude/skills/lmeval-runner/SKILL.md`. Nothing further to build.
- **Case-count/CI-width caveats, `runsPerCell` defaults** — already fully
  handled by Track A7 (`runsPerCell: 3` default, bootstrap CIs,
  `inconclusive` verdicts). No new scope.
- **Ground-truth review status** — already tracked as Track A5's open item
  (human review-ledger approval); surfaced in the Insights leaderboard via
  `groundTruthReviewStatus` regardless of whether A5 closes.

---

## Suggested order for a fresh session

**Done since this doc was written (2026-09-07)**: `promptTextHash` (§2a) and
the `penalizeExtraTags` toggle (§5.2) — both were the small, additive,
no-risk changes originally slotted as step 4 below; picked up first since
they required no live model run to implement or verify (typecheck + full
`vitest run`, 311/311 passing).

Remaining order:

1. Apply the corrected model list (§1) and restart Phase 2 classification +
   tagging runs for the 4 surviving models — this is the fastest way to get
   real multi-run data into the now-working Insights dashboard, and now also
   the first real signal for whether the `penalizeExtraTags: false` change
   actually moves the tagging gate verdict the way §5.2 intends.
2. Qualify `qwen3.6:35b-a3b-q8_0` (§4) — unblocks a real summarization gate
   verdict, and unblocks asking the user for a summarization candidate list
   with actual pass/fail data to react to rather than guesses.
3. Tagging unknown-tag-rate root-cause investigation (§5.1) — cheap, and
   directly affects whether the tagging numbers from step 1 can be trusted.
4. Playwright walkthrough of `/insights` (§2b) — do this once step 1 has
   produced enough real multi-run data for the walkthrough to actually
   exercise the trend/CI-band/gate-history views meaningfully, not just the
   empty state.
