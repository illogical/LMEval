# Campaign and Evaluation Wizard Integration UX Revisit

> **Status:** Refined for implementation (2026-09-07). This is a follow-up to
> [`2026-09-07-judge-qualification-and-campaign-ui.md`](2026-09-07-judge-qualification-and-campaign-ui.md),
> not a claim that its browser implementation is incomplete or unsafe. The gap analysis this document
> originally deferred has been completed against the current codebase (see "Gap analysis: resolved"
> below) and its conclusions are folded into the phased plan, so implementation can start directly from
> this document without a separate discovery pass.

## Why revisit this

The model-selection campaign implementation correctly preserves a reproducible, three-phase
selection protocol, but its browser experience is a separate, dense administrative form rather than
an LMEval evaluation flow. The screenshots expose immediate presentation defects (notably clipped
`fieldset` legends, native-looking controls, large undifferentiated panels, weak empty states, and
poor visual hierarchy). The larger problem is conceptual: users begin with an evaluation question,
while the current UI asks them to construct a persistence object called a campaign.

The existing Evaluation Wizard is the better precedent. It begins with the question being asked,
uses purpose-driven defaults, scopes choices progressively, persists draft state, and moves through
Prepare, Run, Results, and Summary. This revisit should reuse that interaction language without
turning the Wizard into a second campaign orchestrator.

## Product model and non-negotiable boundary

An ordinary evaluation and a model-selection campaign answer different questions:

| Surface | What it answers | Varies | Holds fixed |
|---|---|---|---|
| Prompt comparison | Did this prompt edit help? | Prompt | Model |
| Model comparison | Which model is best for this fixed prompt? | Model | Prompt |
| Full matrix | What happens across these combinations? | Both | Nothing beyond the declared matrix |
| Guided model selection (campaign) | Which prompt/model recommendation is defensible for this task? | Prompt, then model, then confirmation | The protocol, pins, suites, inference, and gates |

**Decision:** Do not add `campaign` as a fourth `comparisonMode`. A campaign is a higher-level
workflow that creates and interprets several ordinary evaluations. `comparisonMode` continues to
describe each individual phase evaluation.

Campaigns are also not a shortcut for a quick model test. A quick answer belongs in a normal Model
Comparison evaluation (or Quick Compare for an unscored A/B check). A campaign is the deliberate,
potentially expensive path used when LMEval needs to refine a prompt, compare a declared candidate
slate, and confirm a recommendation with preserved evidence.

## Recommended UX direction

Keep the existing Wizard intact as the primary evaluation editor. Add a small, optional **Campaign
context** handoff rather than embedding every campaign control into its five steps.

1. **Start with the user’s intent.** The Template Gallery and Session Hub should present three
   plainly different starts: a normal evaluation, a quick compare, and **Guided model selection**.
   The latter can keep the persisted/API name `ModelSelectionCampaign`, but its user-facing copy
   should lead with the outcome: “refine a prompt, compare candidates, and confirm a model choice.”

2. **Use campaign context, not campaign mode, in the Wizard.** In Prepare, show a compact optional
   card after the normal evaluation configuration:
   - **Standalone evaluation** (default): existing behavior, no campaign record or association.
   - **Create a guided-selection draft from this setup:** pass the selected purpose, pinned prompt,
     suite, inference, and selected models into a campaign-draft handoff. The campaign flow asks only
     for information an ordinary evaluation does not own, such as the incumbent and candidate slate.
   - **Associate this evaluation with an existing campaign:** select a campaign and give the run a
     visible relationship in campaign history.

3. **Keep evidence roles explicit.** A Wizard evaluation associated with a campaign is
   `supplemental` evidence by default. It can be viewed from that campaign, but it cannot be silently
   treated as a prompt sweep, model sweep, or confirmation phase, and it cannot affect a
   recommendation. Only campaign-orchestrated, pinned phase evaluations have a selection role.
   This preserves the current guarantees around sequential execution, exact prompt pins, calibration
   versus promotion splits, warning acknowledgement, incomplete-phase failure, and fallback
   confirmation.

4. **Reuse the Wizard’s visual and interaction patterns.** Campaign configuration should progressively
   disclose task/purpose, inputs, candidate models, evidence requirements, and review/start rather
   than render every fieldset at once. Reuse the mode cards, grouped searchable multi-model selector,
   prompt-version controls, suite/provenance cues, validation summaries, execution preview, status
   framing, and Results/Summary vocabulary wherever their data contracts fit. Do not duplicate the
   Wizard’s configuration state or fork its components solely for campaigns.

5. **Keep the campaign list as history, not a competing entry flow.** `/campaigns` remains the place
   to resume a draft, monitor active sequential work, inspect a recommendation, or clone a past
   configuration. It should not be the only place a user can discover the higher-level workflow.

## Gap analysis: resolved

The matrix below was produced by reading the current implementation rather than by inspection at plan
time, so it supersedes the "TBD" framing in earlier drafts of this document. File paths are current as
of 2026-09-07.

| Surface | Wizard implementation | Campaign implementation today | Reuse verdict |
|---|---|---|---|
| Step shell / progressive disclosure | `EvalLayout.tsx` + `EvalWizardProvider`, `EvalStepIndicator`, routes nested under `/eval/*` | `CampaignBuilderPage` renders every fieldset at once on `/campaigns/new`, no step indicator, no shared provider | **Adopt.** Give the campaign builder its own step sequence using the same `EvalLayout`-style shell/provider pattern, not the Wizard's own route tree or `EvalWizardProvider` instance (state shapes differ; see below). |
| Model selection (incumbent, candidates) | `components/model/ModelSelector.tsx` — grouped by server, searchable, keyboard-navigable | Native `<select>` per candidate row (`CampaignsPage.tsx`) | **Adopt as-is.** `ModelSelector` already takes `servers`/`selectedModels`/`onSelectionChange`; campaign builder should call it directly for the incumbent field and once per candidate row. No component fork needed. |
| Prompt-version pinning | `components/prompt/PromptVersionSelector.tsx` | Nested native `<select>` elements for ordered prompt pins per task | **Adopt.** Same data shape (`promptId` + `version`); campaign's `promptPinsByTask` already matches what `PromptVersionSelector` expects to emit. |
| Test suite / provenance | `components/config/TestCaseEditor.tsx` | Native `<select>` for suite per task | **Adopt for selection only.** Campaign needs suite *selection with provenance/review-status display*, not inline test-case editing — reuse the suite-picker portion of `TestCaseEditor` (or extract that sub-piece) rather than the whole editor. |
| Judge qualification | `components/config/JudgeQualificationStatus.tsx`, wired into `JudgeConfig` | Already imported and wired in `CampaignBuilderPage` (same component) | **Already shared — no work required.** This is the one place the two surfaces already agree; treat it as the reuse template for the rest. |
| Validation summary / call estimates | `components/config/ExecutionPreview.tsx` | Ad hoc issue/warning list at top of the campaign form | **Adopt the presentation pattern, not the component verbatim.** `ExecutionPreview` renders one evaluation's validation; campaign review needs per-phase call-estimate ranges and acknowledgement checkboxes keyed by stable codes, which `ExecutionPreview` doesn't model. Build a campaign-specific review panel that reuses `ExecutionPreview`'s visual language (grouping, warning/error styling, disabled-Start-until-resolved pattern) rather than trying to parameterize the same component for two different data shapes.
| Draft persistence | Server-backed evaluation drafts under `/eval/config` | Campaign builder already has server-backed `POST /model-selection/drafts`, `PATCH /:id`, and `POST /:id/run`, plus `?clone=:id` | **Do not unify.** Preserve these genuinely different lifecycles (mutable evaluation draft vs. immutable-once-started campaign draft with required acknowledgements); the integration should reuse the existing campaign draft contract. |
| Run/monitor/results | `DashboardPage.tsx` (single evaluation), `ResultsPage.tsx`, `SummaryPage.tsx` | Campaign detail page polls campaign feedback and renders phase rows + a custom scatter chart | **Keep separate, share vocabulary only.** Campaign monitoring is inherently sequential/multi-phase in a way no single Wizard page models; reuse `VerdictHeader`-style gate-first framing and Results-page link conventions, not the pages themselves. |
| Association / supplemental evidence | N/A | N/A — `EvaluationConfig` has no `campaignId` or role field today | **New work**, not a reuse question. See "Data, API, and route plan" below; this is additive schema, not a refactor of either surface. |

**Recommendation (resolved): option 1 from the earlier draft.** Retain separate campaign state, types,
and routes; adopt the Wizard's component library and interaction language where the data shapes already
match (`ModelSelector`, `PromptVersionSelector`, judge qualification, suite provenance display,
validation/warning presentation); keep campaign-only components for sequential phase monitoring,
cancellation, fallback-confirmation history, and cross-task recommendation, because those have no honest
Wizard analogue. Do not attempt to fold campaign configuration into a Wizard step — the campaign form's
own remaining gap is presentation (one dense page, native controls), not a wrong home.

## Data, API, and route plan

The initial integration should be additive and backwards compatible. Confirmed against
`src/types/eval.ts`: none of `campaignId`, a campaign role/evidence flag, or a draft-handoff endpoint
exist today, so all of the following are pure additions with no existing contract to preserve.

- Add `campaignId?: string` and `campaignRole?: 'supplemental'` to `EvaluationConfig`. Existing
  evaluations remain unassociated (`campaignId` absent). A campaign exposes its linked ordinary
  evaluations separately from its authoritative phase evaluations (`phase1EvalIds`/`phase2EvalIds`/
  `phase3EvalIds`/`phase3AttemptEvalIds`, all already present on `ModelSelectionCampaign`).
- Extend `CampaignFeedback` with a `supplementalEvaluations: SupplementalEvaluationLink[]` field
  (evaluation ID, browser path, lifecycle status, created time). Do not fold them into phase progress,
  call estimates, recommendation ordering, or gate calculations — the recommendation engine reads only
  `phase1EvalIds`/`phase2EvalIds`/`phase3EvalIds`, never `supplementalEvaluations`.
- Add `POST /api/eval/model-selection/drafts/from-evaluation` accepting an `evalId` plus the
  campaign-only fields the Wizard cannot supply (incumbent, candidate slate). It reads the source
  `EvaluationConfig`'s purpose, pinned prompt version, suite, and inference settings, and calls the
  existing validate/draft path — it does not bypass `CampaignValidationService`. Response is a
  `draft` `ModelSelectionCampaign` id to redirect to at `/campaigns/:id`.
- Add `PATCH /api/eval/:evalId` support (or reuse existing evaluation update route if one exists) for
  setting `campaignId`/`campaignRole` when a user chooses "associate with an existing campaign" in the
  Wizard's Campaign context card. This must be revocable while the evaluation is still a draft and
  becomes a fixed historical fact once the evaluation has run.
- Preserve `/campaigns`, `/campaigns/new`, and `/campaigns/:id`. Add `/campaigns/new?seedFrom=:evalId`
  as the query-param entry point for the Wizard handoff (matches the existing `?clone=:id` convention
  already used by `CampaignBuilderPage`). Deep links from the Wizard carry base-path-aware navigation
  (reuse the existing Vite-base-URL derivation used elsewhere in the frontend API client) and return
  the user to the source evaluation or campaign review after save.
- Do not alter completed or started campaign inputs. A Wizard association may be added only where it
  cannot mutate phase pins, candidate selection, status, recommendations, or existing evidence;
  otherwise the UI must offer cloning into a new campaign draft (the clone path already exists via
  `?clone=:id` and needs no new mechanism, only a UI entry point from the association flow).

## Phased implementation plan

`docs/TASK.md` already carries the B7 entry (lines 477-487) pointing at this document, so no TASK.md
edit is needed to start; TASK.md gets checked off in phase 4 once behavior is verified. The gap matrix
above replaces the discovery step that would otherwise start this work, so implementation can begin at
phase 1 directly.

### 1. Rebuild campaign presentation around the shared language (do this before wiring the Wizard)

Rebuilding the campaign form's presentation is independent of the Wizard-handoff work and removes the
concrete visual defects first, so it goes first.

- Give `CampaignBuilderPage` a step shell modeled on `EvalLayout`/`EvalStepIndicator` (own provider,
  not a shared instance with the Wizard — see gap analysis) with stages: task/purpose selection →
  candidate slate → per-task prompt pins/suite → judge → review/start.
- Swap native `<select>` incumbent/candidate rows for `ModelSelector`; swap native prompt-pin
  `<select>`s for `PromptVersionSelector`; reuse the suite-picker portion of `TestCaseEditor` for
  per-task suite selection with provenance/review-status display.
- Build a campaign review panel styled after `ExecutionPreview` (grouping, warning/error treatment,
  disabled-Start-until-resolved) but modeling campaign-specific data: per-phase call-estimate ranges,
  exact prompt pins, suite provenance, judge state, and acknowledgement checkboxes keyed by stable
  warning codes.
- Add server-backed draft persistence (`POST /model-selection/drafts`, `PATCH /model-selection/:id`,
  `POST /model-selection/:id/run`) per the first plan's draft lifecycle, replacing the current
  form-state-only builder.
- Reproduce the supplied campaign screenshots' states (clipped legends, native controls, weak empty
  states) in a browser at desktop and narrow widths before and after, and record each fix as a
  concrete acceptance example rather than a general "improved hierarchy" claim.
- Keep campaign-only monitoring and recommendation evidence (sequential phase rows, cancellation,
  fallback-confirmation history, cross-task recommendation, quality/latency chart) on campaign detail,
  but restyle with the Wizard's gate-first vocabulary, progress language, error treatment, and
  Results-page link conventions.

### 2. Establish the light Wizard integration

- Add `campaignId`/`campaignRole` to `EvaluationConfig`, `supplementalEvaluations` to
  `CampaignFeedback`, and the `POST /model-selection/drafts/from-evaluation` handoff endpoint (see
  "Data, API, and route plan").
- Add Guided model selection discovery to the Session Hub/Template Gallery (a third, plainly-labeled
  entry point alongside normal evaluation and Quick Compare).
- Add the optional Campaign context card to the Wizard's `ConfigPage.tsx` Prepare step: standalone
  (default) / create a guided-selection draft (calls the new handoff, navigates to
  `/campaigns/:id?seedFrom=...`) / associate with an existing campaign (sets
  `campaignRole: 'supplemental'`). Explain the evidence-role difference in the card copy before
  save/start, not after a result is produced.
- Surface campaign context in the normal evaluation's config, run, results, and summary navigation
  (a small linked badge is enough), and surface supplemental runs distinctly (separate list, not
  interleaved with phase rows) in campaign detail/history.

### 3. Reconcile and validate

- Update `docs/SPECIFICATION.md`, README workflows, OpenAPI, and check off the `docs/TASK.md` B7 entry
  only after the chosen behavior is implemented and verified.
- Keep the existing API-first evaluation evidence rules: a completed campaign with failed/incomplete
  phase work remains execution evidence, not a recommendation; benchmark review and judge
  qualification still govern promotion readiness; `supplementalEvaluations` never affect gates or
  recommendation ordering — verify this with a test that asserts the recommendation engine's inputs
  are unaffected by the presence of supplemental links.

## Test and acceptance plan

- Unit/service tests: association normalization and authorization, backward compatibility for old
  evaluations/campaigns, supplemental evidence excluded from selection, campaign-draft seeding,
  immutable campaign protection, and base-path-aware handoff links.
- Component tests: default standalone selection, create/select campaign states, missing
  campaign-only requirements, context copy, distinct supplemental/phase labels, and reused selector
  accessibility.
- Playwright: Template Gallery or Session Hub → Wizard → standalone run; Wizard → guided-selection
  draft → review/start; Wizard → select a campaign → supplemental run; campaign detail links back to
  each run; cancellation, interrupted campaign, warning acknowledgement, responsive layout, and
  keyboard navigation.
- Browser verification in standalone and hosted mounts. No UI pass is sufficient on its own: live
  model work remains a separate execution-health and promotion-evidence gate.

## TASK.md status

Already present as **B7** under Track B — Wizard completion (`docs/TASK.md` lines 477-487), added when
this document was first drafted. No further TASK.md edit is needed until phase 3 checks it off.

## Explicit non-goals for this revisit

- Re-running or changing a completed campaign’s phase evaluations.
- Letting an unpinned, user-created ordinary evaluation affect a campaign winner.
- Relaxing CI-backed gates, benchmark-review requirements, judge qualification, or sequential GPU
  execution.
- Replacing the normal Evaluation Wizard, Quick Compare, or `/campaigns` history with one universal
  form.
- Making a recommendation or promotion claim from a UI walkthrough, smoke, or incomplete campaign.
