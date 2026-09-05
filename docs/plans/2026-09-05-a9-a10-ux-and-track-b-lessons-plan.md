# A9/A10 UX Design & Track B Handoff — Lessons Learned

## Context

A9 (two-phase model selection) and A10 (task-specific reporting) landed 2026-09-05 as **data/service/export
layer only, by explicit scope boundary** — see
[`2026-09-05-a9-a10-model-selection-reporting-plan.md`](2026-09-05-a9-a10-model-selection-reporting-plan.md)'s
"Scope boundary, deliberately held" note. That was the right call to ship measurement fidelity
(Track A, the critical path) without blocking on UI design. But it leaves LMEval in a state where its
two newest and most consequential features — "should we switch models" and "here's why" — are
reachable only via `curl` and a Markdown file. Nobody is going to run a 3-phase campaign that way.

This document does two things:

1. **Designs the UX** for A9 (campaigns, candidate slates, latency budgets) and A10 (task-specific
   report sections) inside LMEval's actual existing app shell — not a green-field mockup. Section 1.
2. **Extracts what this implementation pass teaches** about how LMEval's plan → build → verify loop
   works, so Track B's four remaining wizard-completion items inherit that discipline instead of
   rediscovering it. Section 2.

Section 3 answers directly: *what should happen before Track B starts*, and *what's the next PR*.

No code changes accompany this document. It is a design/sequencing plan for a future implementation
pass, following this repo's own convention of landing the decision record before the diff.

---

## 1 — UX design for A9 and A10

### 1.1 Where campaigns live: a new top-level section, not a wizard step

The wizard (`EvalLayout`, Steps 1–5: Prompts → Prepare → Run → Results → Summary) is built around
**one evaluation at a time** answering **one question at a time** (`comparisonMode: model | prompt |
matrix`). A model-selection campaign is structurally different: it's an *orchestrator* that creates and
sequences three evaluations per task, across up to three tasks, over minutes-to-hours of wall clock.
Trying to fold that into a wizard step would either mislabel it as "just another eval" (hiding the
3-phase structure the whole point of A9 is to make explicit) or bloat Step 2/3 with orchestration
concerns that don't apply to a normal run. **Recommendation: campaigns get their own top-level route
and their own list/detail pair, parallel to `/eval` and `/compare`, not nested inside either.**

- **`SessionHubPage` gains a third tab**: `Sessions` | `Campaigns` | `Quick Compare` (existing
  `/compare` route slots in as the third tab's target, unifying the top-level nav instead of leaving
  Compare as an orphaned header link — a small, free cleanup while we're adding a nav concept anyway).
- **`/campaigns`** — list view. Card-per-campaign, reusing `TemplateGalleryPage`'s card grid pattern
  (`.tg-card`, hover lift, `var(--card-bg)`/`var(--border)`). Each card shows: incumbent model, task
  badges (classification/tagging/summarization as small pills), status (`pending` spinner /
  `running` progress dots / `completed` check / `failed` error-red / `cancelled` muted), and — once
  complete — the headline recommendation per task ("classification → `granite4.1:8b` ✓clears gate").
- **`/campaigns/new`** — creation form (detailed in 1.2).
- **`/campaigns/:id`** — detail/monitoring view (detailed in 1.3).

This mirrors the existing split between `SessionHubPage` (list) and the wizard (detail/workflow) —
same mental model, new object type.

### 1.2 Campaign creation form

A single-page form (not a mini-wizard — the inputs don't have Step 2's branching complexity), styled
like `ConfigPage`'s left-column-of-cards layout:

1. **Incumbent model** — the models dropdown already used by `JudgeConfig`/model pickers elsewhere.
2. **Candidate slate** — a repeatable row list (add/remove), each row: model dropdown, LMApi server
   (auto-filled from the model's known server, since LMApi already reports this — only prompt for it
   if genuinely ambiguous), and three **optional, explicitly-labeled-as-free-text** fields (parameter
   size, quantization, context length) with a one-line caption: *"LMEval can't introspect these —
   they're advisory metadata for the cross-server/VRAM notes below, not scored."* This honesty
   matters: A9's backend already refuses to fake a `vramBudgetExceeded` number for the same reason
   (TASK.md A9 notes), and the form should telegraph the same limitation rather than implying these
   fields feed a real budget calculation.
3. **Tasks** — checkboxes for classification/tagging/summarization. Selecting summarization reveals a
   required **judge model** dropdown right there (not buried in a later step) plus an inline
   qualification-status badge — see 1.4, this is the same component `JudgeConfig` needs.
4. **Per task, once selected**: prompt-sweep candidates (multi-select from existing saved prompts —
   reuse whatever prompt-picker `PromptsPage` already has) and a test suite picker (reuse A5's
   "Use benchmark suite" card/badge component from `TestCaseEditor.tsx`, since campaigns should default
   to built-in benchmark suites, not ad-hoc inline cases).
5. **Latency budget** — read-only display of the currently configured per-task budgets (from
   `GET /api/eval/model-selection/latency-budgets`), with an "Edit budgets" link out to Settings (1.5)
   rather than an inline editor here. A budget is infrastructure-level config set once, not a
   per-campaign choice — editing it inline on every campaign form would invite it to drift
   campaign-to-campaign, which defeats its purpose as a stable target.
6. **Total VRAM budget (GB)** — optional number input, with a caption noting it's captured for
   context but **`vramBudgetExceeded` is never computed** (matches the backend's honest non-answer).

Submit posts to `POST /api/eval/model-selection`, gets a `202` + campaign id, and navigates straight to
`/campaigns/:id` — the same fire-and-forget-then-redirect pattern `ConfigPage`'s Run button already
uses for a normal evaluation.

### 1.3 Campaign detail / monitoring view

This is the highest-value screen and the one with the most reusable precedent already in the app:

- **Phase progress, per task** — a vertical stepper per task row: `Phase 1 (prompt sweep)` →
  `Phase 2 (model sweep)` → `Phase 3 (confirmation)` → `Recommendation`, each phase a chip that's
  gray/pending, spinning/running, or check/done, with a link to that phase's real `evalId` once it
  exists (`GET /campaigns/:id` already returns `phase1EvalIds`/`phase2EvalIds`/`phase3EvalIds`). This
  is structurally the same "poll a running job and render its live state" problem `DashboardPage`
  (Step 3) already solves — **reuse its polling hook/interval logic** rather than inventing a second
  one; the two screens differ only in what they poll (`GET /eval/evaluations/:id` vs.
  `GET /eval/model-selection/:id`) and what they render per tick.
- **Each phase link opens the real ResultsPage** (`/eval/results/:evalId`) in-place — a campaign is
  not a black box; every phase is an ordinary, independently-inspectable evaluation. This is a deep
  advantage over hiding the phases as internal implementation detail: a user who wants to sanity-check
  phase 2's confusion matrix mid-campaign already has the exact page for that with zero new code.
- **Cancel button** while `status === 'running'`, calling `POST /:id/cancel` — same placement/styling
  as any other in-flight action in the app (compare to the Run dashboard's cancel affordance).
- **Recommendation card, once a task completes** — this is where A10's formatting work pays off
  directly: render `ModelRecommendation` using **`VerdictHeader`'s established gate-first framing**
  ("`granite4.1:8b` clears the classification gate" as the headline, score as supporting detail — the
  same pattern TASK.md §5.9 already argued for and `VerdictHeader` already implements for a single
  eval). Below the headline:
  - **Tie groups** as a ranked list of chip-groups (`Rank 1: [model-a, model-b]`, `Rank 2: [model-c]`)
    — visually communicates "these are statistically indistinguishable" in a way a numbered leaderboard
    cannot, addressing TASK.md §5.5's point directly ("a ranked list implies a total order that
    overlapping confidence intervals do not support").
  - **Quality-vs-latency scatter**, reusing `BreakdownView`'s existing `ScatterChart` component
    verbatim (x = p95 latency, y = primary metric, point color = tie-group rank, gate floor drawn as a
    horizontal reference line) — this is exactly the "retire the leaderboard for gated tasks" scatter
    TASK.md §5.5 already specified as the target visualization, and A9's `ordering.p95LatencyMs` +
    `ordering.tieGroups` are precisely the data that scatter needs. This is the single biggest
    "we already built half of this" opportunity in the whole plan.
  - **Discarded-by-gate list** — small muted table, model + reason, collapsed by default (it's
    important provenance, not something that needs headline space).
  - **Confirmation result** — pass/fail chip, and if it fell back to the runner-up, a one-line note
    explaining why (`ModelRecommendation.confirmation.reason`), styled like `VerdictHeader`'s existing
    caveat chips.
  - **Advisory flag** — if `ModelRecommendation.advisory`, render the same visual treatment
    `VerdictHeader` already uses for a `gate.verdict === 'advisory'` single eval (don't invent a new
    "advisory" visual language for campaigns when one already exists and users will have learned it).
- **Cross-task summary** (once every selected task has a recommendation): `bestSingleModel` rendered
  as a callout — "if you can only run one model everywhere, `X` costs you macroF1 −0.03 on
  classification, −0.01 on tagging, matches on summarization" — directly answering the "one resident
  model vs. three" question TASK.md frames as A9's reason for existing. `crossServerFlag`, if true,
  as a warning chip ("recommended models span 2 LMApi servers — a swap has a network-topology cost
  LMEval can't measure").

### 1.4 Judge qualification UI — now blocking, not just owed

A8 shipped `POST/GET /api/eval/judges/:modelId/qualify` with **zero UI**, noted in TASK.md as owed but
not urgent at the time. A9 changes that calculus: **a campaign with a summarization task silently
produces an advisory-only, un-promotable recommendation whenever its judge isn't qualified** (per
`SummarizationTaskMetrics.gate.verdict` forcing `'advisory'`), and nothing in the UI proposed above
tells the user *why* until they read the small print on the recommendation card. This should not ship
without at minimum:

- A **qualification status badge** next to every judge-model selector — both `JudgeConfig` (normal
  wizard) and the campaign form's judge dropdown (1.2) should show the same component:
  `● Qualified (Spearman 0.85)` / `● Not qualified` / `○ Never tested` with a `Test now` button that
  calls `POST /:modelId/qualify` and polls until done (qualification takes ~3× the calibration set
  size in judge calls — a progress spinner with an estimated duration, mirroring the Execution
  Preview's existing "≈N min" language, matters here since this can take a couple of minutes).
- This is a **small, shared component** (`<JudgeQualificationBadge modelId={...} />`), not
  page-specific — it belongs wherever a judge model gets picked, present and future.

### 1.5 A lightweight Settings surface

The app currently has no global settings page — every piece of config lives inline in whatever page
needs it. A9 introduces the first genuinely *global, rarely-changed, cross-campaign* setting (latency
budgets), and TASK.md's Track C already has another one waiting (`REFINEMENT_MODEL`, currently an
env-var-only gate with no UI per Track C1). **Recommendation: introduce a minimal `/settings` page
now, scoped to exactly what exists today** — resist the urge to design a general preferences system
speculatively:

- **Latency budgets** — three number inputs (ms), one per task, backed by the already-built
  `GET`/`PUT /api/eval/model-selection/latency-budgets`. Empty state explains *why* this exists in one
  sentence ("MemoryApi's whole-ingestion target, split by task — LMEval can't measure ingestion
  end-to-end itself, so this number is supplied, not computed") so the setting doesn't read as
  arbitrary.
- **Judge qualifications** — a read-only table of every judge model that's been qualified (model,
  qualified date, Spearman, qualified y/n), each row linking to a re-qualify action. This turns the
  qualification badges from 1.4 into a manageable inventory instead of a fact you only learn about at
  the point of use.
- Nothing else goes here yet. `REFINEMENT_MODEL` stays an env var until Track C actually needs a UI
  toggle for it (per Track C1's own scoping) — adding it speculatively would be exactly the kind of
  premature abstraction this repo's own conventions warn against.

### 1.6 A10 in the existing Results page (non-campaign evals)

A10's report sections should surface for *any* evaluation that has the data, not just campaign phases:

- **New "Task Metrics" tab** on `ResultsPage`, positioned right after Scoreboard, gated on
  `summary.taskMetrics` being present (mirrors how the tab bar today implicitly assumes
  `comparisonMode`-appropriate content). Confusion matrix as a proper heatmap (reuse the Scoreboard's
  existing heatmap-color CSS variables — `--heatmap-low/mid/high` already exist and are unused outside
  the score matrix), per-class/per-tag table below it, rubric dimensions as a small bar chart for
  summarization.
- **Per-model breakdown** — when `perModelTaskMetrics` is present, this is naturally a set of
  per-model rows *within* the Task Metrics tab (one confusion matrix per model, collapsed by default,
  expand-to-compare), not a separate tab — it's the same content as the whole-run view, just sliced.
- **Slice tables** — a filter control at the top of Task Metrics ("Slice by: split / shape / category")
  that re-renders the pass-rate breakdown by the selected `caseTags` family. This is a natural extension
  of the Breakdown tab's existing per-model filtering, not a new interaction pattern.
- **Provenance/judge block** — belongs in `VerdictHeader`'s existing collapsible details area (it
  already shows inference/transport caveats; benchmark provenance and judge qualification are the same
  category of fact — "how much should I trust this number" — and should live in the same expandable
  spot, not scattered).
- **Model-selection section** — **do not duplicate this in the plain ResultsPage.** When an eval is a
  campaign phase, show a single banner at the top of `VerdictHeader` — "This evaluation is phase 2 of
  campaign `X` → [view campaign]" — linking to `/campaigns/:id` (1.3) rather than re-rendering the tie
  groups/ordering/recommendation inline a second time. One canonical place for that content avoids the
  two views drifting when only one gets updated later.

---

## 2 — Lessons learned from this pass, for Track B

Track B (`B1`–`B6`) is entirely frontend/UX work on the existing wizard — closer in kind to the design
work above than to Track A's measurement-fidelity engineering. A few things this pass surfaced are
directly transferable:

1. **A completed backend without a UI plan is a trap, not a milestone.** A9/A10's plan explicitly
   scoped out UI "for later," which was the right call to unblock Track A — but it means the feature
   isn't actually *usable* yet, and TASK.md's status table can make "✅ complete" read more finished
   than it is. **For Track B, the inverse risk applies**: B1–B6 are UI-only items sitting on top of an
   already-complete backend, so there's no equivalent excuse to defer design thinking — do the design
   pass (like this document) *before* starting the diff, not after, since there's no backend-first
   justification for sequencing it later this time.

2. **Reuse beats invention, and the reuse opportunities are often already half-built.** The single
   biggest finding in Section 1 is that `BreakdownView`'s scatter chart, `VerdictHeader`'s gate-first
   framing, `DashboardPage`'s polling loop, and `TestCaseEditor`'s benchmark-suite picker each already
   solve a problem A9/A10's UI needs solved again. Before writing a new component for any Track B item,
   grep for the nearest existing analog the way the research pass behind this document did — Track B's
   own items (B2's failure-detail drawer, B3's Summary page sections) likely have similar overlap with
   existing Results-page/Compare-page components worth checking before designing fresh.

3. **Settled decisions need a place to live, and a one-line rationale outlives the PR.** Every
   judgment call this pass made where the plan was silent or slightly wrong (the tie-grouping algorithm
   fix, adding `judgeModelId` to the campaign type, the `bestSingleModel` tie-break heuristic) got
   written down in TASK.md with its reasoning, not just implemented silently. Track B will hit the same
   kind of gap — the plan docs it inherits (`2026-08-23-homebase-integration.md`'s wizard layout,
   whatever B3's Summary page design ends up being) will not anticipate every UI edge case. Keep doing
   this; it's what let this document's research pass reconstruct *why* things look the way they do
   without guessing.

4. **The verification-claim discipline (Track E) should extend to UI, explicitly.** This pass was
   careful to say "unit-tested against synthetic fixtures, not live-verified" rather than implying more
   confidence than earned (see the new Track E entry for A9/A10). Track B's UI work has an analogous
   trap: a component can render correctly against a mocked `EvaluationSummary` fixture in a unit test
   while still being unusable or visually broken against a real, messy evaluation result (long model
   names overflowing a card, a confusion matrix with 60 tagging labels instead of 3 classification
   ones, a campaign that's been running for 40 minutes with no visible heartbeat). Track B items should
   carry the same two-tier claim this repo already uses elsewhere: "component logic tested" is not
   "confirmed to work in the browser" — TASK.md's Track E entries for Phase 7/11/12 already model this
   split for prior UI work; continue it rather than let UI-only work quietly get a pass.

5. **Fire-and-forget + poll is now a three-time pattern — worth naming, not necessarily worth
   abstracting yet.** Evaluation runs, judge qualification, and now campaigns all follow: `POST` →
   `202` + id → client polls a `GET /:id` → renders phase/status transitions. Three instances is enough
   repetition to name in this document, but per this repo's own stated bias against premature
   abstraction ("three similar lines is better than a premature abstraction" — CLAUDE.md-equivalent
   guidance in this session), it is **not** yet a strong enough case to extract a shared polling hook
   *unless* Track B's own work (e.g., B2's retry-cell flow, which is the same shape again) makes it a
   fourth instance — at which point extracting `usePolledResource(url, interval)` becomes the obvious,
   earned abstraction rather than a speculative one.

---

## 3 — What to consider before Track B, and what's next

### Before switching focus to Track B

- **A9/A10 currently have no UI.** Shipping Track B work (more wizard polish) while the two newest,
  highest-value measurement features remain `curl`-only is a prioritization risk: Track B's items are
  incremental polish on an already-usable wizard, while A9/A10's UI is the difference between "built"
  and "usable at all." Recommend treating **Section 1 of this plan as higher priority than Track B**,
  not an addendum to it.
- **Judge qualification UI (1.4) is no longer optional-and-owed; A9 makes it load-bearing.** Any
  campaign with a summarization task is silently advisory-only without it. This should land before or
  alongside the campaign UI, not after.
- **Track E's live-verification debt keeps growing** (A3/A6/A7/A8/A9/A10 all owe a real LMApi/Ollama
  round trip). None of it blocks UI work, but it should not be allowed to grow indefinitely — at some
  point (recommend: once the campaign UI exists and there's a real screen to drive a live campaign
  through) a dedicated verification pass should burn down Track E in one sitting rather than
  perpetually deferring it pass over pass.
- **A2's remaining item** (imported snapshot cases must carry the exact `<memory>` wrapper) is the one
  piece of Track A that isn't UI-shaped and isn't owed-verification — it's still open implementation
  work, small in scope, and worth closing opportunistically whenever someone's touching test-case
  import code (e.g., during B1's "Import from test suite" work), since it's the same code path.

### Suggested next PR

**Campaign UI first (Section 1.1–1.4), narrowly scoped**, in this order:

1. `<JudgeQualificationBadge>` shared component + wire it into `JudgeConfig` (small, immediately useful
   even before campaigns exist, de-risks the summarization-advisory surprise today).
2. `/settings` page with just latency budgets + the judge qualification table (1.5) — small, and the
   campaign form in step 4 depends on budgets existing to link to.
3. `/campaigns` list + `/campaigns/new` creation form (1.1–1.2).
4. `/campaigns/:id` detail/monitoring view (1.3) — the biggest single piece, but decomposable: phase
   stepper and cancel button first (reusing `DashboardPage`'s polling), recommendation card with the
   reused `BreakdownView` scatter second, cross-task summary last (it depends on every task finishing,
   so it's naturally the least urgent to have pixel-perfect on day one).

**Defer to a follow-up PR**: the plain-`ResultsPage` A10 surfacing (1.6) — it's valuable but lower
urgency than making campaigns usable at all, and it's independent enough to not block or be blocked by
the campaign UI work above. Track B's own items can proceed in parallel with either, since (per the
brainstorming note already in the A9/A10 plan) Track B and Track A/A9/A10 UI work don't block each
other structurally — only human attention is the shared, scarce resource being sequenced here.
