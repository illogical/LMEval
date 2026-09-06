# Agent-Drivable API Parity Gap Analysis

**Date:** 2026-09-06

**Status:** Planning only — no implementation accompanies this document

## 1. Goal and conclusion

LMEval should let an LLM agent assemble a valid evaluation, optionally leave it as a reviewable
draft, start it, monitor it, interpret the outcome, and hand the user browser links to the exact
configuration and results. The agent should be able to do this through a documented public API,
without reproducing browser-only state or validation logic.

The current backend already exposes most of the storage and run primitives, but it does **not** yet
have feature parity for that workflow. The blocking gaps are:

1. evaluations cannot be saved, edited, or opened as server-backed drafts before model calls start;
2. the create route silently discards the public per-run `inference` field;
3. important experiment-shape safeguards exist only in the React wizard;
4. agents must reconstruct progress and feedback from several endpoints and undocumented response
   states;
5. API documentation and the implemented route/client contracts have drifted; and
6. completed runs have stable browser pages, but saved configurations do not.

Because these are real parity gaps, the proposed LMEval evaluation-workflow skill must **not** be
created yet. Section 8 defines the gate for creating it later.

## 2. Current frontend-to-API capability map

| Frontend capability | Current API or transport | Parity assessment |
|---|---|---|
| Browse purpose templates and start from one | `GET /api/eval/purpose-templates`; agents can fetch the template, create its prompt, and copy its defaults into an evaluation | **Composable, not turnkey.** Template application itself is browser-local wizard state. |
| Create prompts and add prompt versions | `POST /api/eval/prompts`; `POST /api/eval/prompts/:id/versions` | **Parity.** |
| Load prompt content, versions, and diffs | Prompt content/version/diff endpoints | **Parity.** |
| Select server-pinned models | `GET /api/eval/models/by-server` supplies server groups; model IDs use `server::model` | **Backend capability exists, contract is drifted.** The frontend client calls a different response shape; see G5. |
| Select or create judge templates | Template CRUD and `POST /api/eval/templates/generate` | **Parity at primitive level.** Generated templates still require an explicit create call to persist. |
| Create, import, select, and edit test suites | Test-suite CRUD and `POST /api/eval/test-suites/parse` | **Parity.** Built-in suites are intentionally immutable. |
| Save/load evaluation presets | Preset CRUD | **Parity in implementation, documentation drifted.** Update is `PATCH`, not the documented `PUT`. |
| Configure a run in the wizard | Browser-only `EvalWizardState`, persisted under `lmeval:wizard:state` in `localStorage` | **No server parity.** There is no persisted draft resource or ID-addressable configuration page. |
| Validate whether a run is meaningful | Browser blockers/warnings plus limited route checks | **Partial.** Several rules are not shared with the backend; see G3. |
| Start an evaluation | `POST /api/eval/evaluations` creates and immediately dispatches `ExecutionService.run()` | **Parity only for create-and-run.** Draft-first review is impossible. |
| Watch live progress | WebSocket events; REST polling of `GET /evaluations/:id` and eventual results is a recovery path | **Technically available, agent-hostile.** No documented snapshot or progress contract. |
| Cancel or retry failures | `POST /evaluations/:id/cancel`; `POST /evaluations/:id/retry` with `cellIds` or `failedCellsOnly` | **Parity.** README descriptions are incomplete and deletion is conflated with cancellation. |
| Inspect results and individual failures | Config, results, resolved test cases, summary, history, and regression endpoints | **Parity at data level.** Agents must join multiple responses. |
| Generate summary analysis | `GET`/`POST /evaluations/:id/summary-analysis` | **Parity.** Generation still requires a configured refinement model. |
| Apply a suggestion and rerun | Compose prompt-version, optional session-version, and evaluation-create calls | **Parity at primitive level.** A dedicated transaction endpoint is not required for v1. |
| Save/compare baselines | Baseline list/save and regression-by-slug endpoints | **Parity.** The separate `baselineId` type field is stale; see G2. |
| Export HTML or Markdown | `GET /evaluations/:id/export?format=html|md` | **Parity.** |
| Open an evaluation in the browser | `/eval/run/:evalId`, `/eval/results/:evalId`, `/eval/summary/:evalId` | **Partial.** There is no `/eval/config/:evalId`. |

Quick Compare (`/compare`) is deliberately outside the parity gate. It is an ephemeral LMApi comparison,
not a persisted evaluation with a reusable configuration, scored result set, or promotion decision.

## 3. Confirmed gaps

### G1 — No draft lifecycle or configuration handoff URL (P0)

The wizard configuration route is `/eval/config` while run, results, and summary routes carry an
evaluation ID (`src/main.tsx:27-30`). Its state is persisted only in browser `localStorage`
(`src/contexts/wizardState.ts:66-70`). The first server-side evaluation resource is created only when
the Run button calls `createEvaluation()` (`src/pages/ConfigPage.tsx:172-186`). The route immediately
starts execution (`server/routes/evaluations.ts:170-226`).

Consequences:

- an agent cannot prepare a configuration and let the user review it before spending model calls;
- a draft cannot be resumed from another browser or machine;
- there is no API operation for correcting a configuration before it runs; and
- there is no stable browser link showing the full saved configuration.

Recommended contract, preserving existing callers:

- keep `POST /api/eval/evaluations` as the backward-compatible create-and-start shortcut;
- add `POST /api/eval/evaluations/drafts` to create a persisted `draft` evaluation;
- add `PATCH /api/eval/evaluations/:id` for draft-only edits;
- add `POST /api/eval/evaluations/:id/run` to validate and start a draft exactly once;
- add `draft` to `EvalStatus`; and
- add `/eval/config/:evalId`, loading the server resource into the existing wizard and saving edits
  through the draft endpoint.

Starting a non-draft evaluation should return `409`. Editing a non-draft evaluation should also
return `409`; completed evidence must remain immutable.

### G2 — Evaluation create contract loses declared fields (P0)

`EvaluationConfig` publicly declares `inference?: InferenceParams` and `baselineId?: string`
(`src/types/eval.ts:137-170`). The object constructed by `POST /evaluations` enumerates accepted fields
but copies neither (`server/routes/evaluations.ts:192-214`). `ExecutionService` can resolve a per-run
`config.inference`, so dropping it at the boundary prevents the advertised override from working.

Required resolution:

- accept, validate, persist, and return `inference` in draft and create-and-start requests;
- validate `temperature`, `maxTokens`, and optional `seed` with one shared schema;
- preserve `inference` when retrying or applying a suggestion and rerunning; and
- remove `baselineId` from the advertised create/update contract and current specification. Current
  regression comparison is selected by a saved baseline slug through
  `GET /evaluations/:id/regression?baselineSlug=...`; no live implementation consumes `baselineId`.
  Historical JSON containing the unused property may remain readable.

### G3 — Browser-only validation allows unsafe or meaningless agent runs (P0)

The Prepare page blocks zero-prompt and zero-model runs, requires at least two models for model
comparison, and requires two prompts for prompt comparison. It also warns about missing judge models,
empty test inputs, and pending-human-review benchmarks (`src/pages/ConfigPage.tsx:119-137`). The create
route validates only a subset: name/prompt/model presence, test-source exclusivity, and built-in suite
use for promotion checks (`server/routes/evaluations.ts:170-190`).

Move the rules into a shared server validation service used by draft creation, draft update, and run
start. Return machine-readable issues:

```json
{
  "valid": false,
  "errors": [
    { "code": "MODEL_COMPARISON_REQUIRES_TWO_MODELS", "field": "modelIds", "message": "..." }
  ],
  "warnings": [
    { "code": "BENCHMARK_PENDING_REVIEW", "field": "testSuiteId", "message": "..." }
  ]
}
```

Validation must cover:

- referenced prompt, model, template, purpose-template, suite, session, and session-version existence;
- comparison-mode prompt/model cardinality;
- exactly one test source (`testSuiteId`, non-empty `inlineTestCases`, or `userMessage`);
- positive bounded `runsPerCell` and valid inference values;
- promotion-check eligibility and benchmark review status;
- grounded-summary judge presence, judge qualification status, and self-judge advisory behavior; and
- unsupported/no-op settings such as `enablePairwise` while pairwise execution remains disabled.

The React wizard should render this shared result instead of maintaining a divergent rule set.

### G4 — No consolidated agent feedback surface (P1)

An agent can poll config status, then fetch results, resolved test cases, summary, regression, and
summary analysis separately (`server/routes/evaluations.ts:63-168, 319-367`). That is sufficient raw
data but not a stable orchestration contract. It also forces the caller to interpret `404` as “not
ready” for some artifacts.

Add `GET /api/eval/evaluations/:id/feedback` as a read-only snapshot:

```json
{
  "evalId": "eval_...",
  "status": "running",
  "progress": { "total": 144, "completed": 37, "failed": 2 },
  "validation": { "valid": true, "errors": [], "warnings": [] },
  "failures": [
    { "cellId": "cell_...", "promptId": "prm_...", "modelId": "server::model", "error": "..." }
  ],
  "summaryReady": false,
  "verdict": null,
  "appBasePath": "/",
  "browserPaths": {
    "config": "/eval/config/eval_...",
    "run": "/eval/run/eval_...",
    "results": "/eval/results/eval_...",
    "summary": "/eval/summary/eval_..."
  }
}
```

For completed runs, `verdict` should expose the task type, gate verdict, primary metric with confidence
interval, case count, and advisory/inconclusive reason. It must not flatten away full results; the
existing detailed endpoints remain canonical. `appBasePath` and all browser paths must be generated
from the configured mount: `/` and `/eval/...` in standalone mode, `/lmeval/` and `/lmeval/eval/...`
when hosted by HomeBase. Agents must not have to guess or hard-code the deployment mode.

WebSockets remain the best browser transport. Agents may use them, but REST polling of the feedback
snapshot is the required baseline because it is simpler to recover, resume, and automate.

### G5 — Model discovery endpoint and client disagree (P0)

The frontend `listModels()` promises `{ servers: [{ name, models }] }` but calls `/models`
(`src/api/eval.ts:174-175`). The server's `/models` route returns `{ models: string[] }`, while
`/models/by-server` returns the grouped shape (`server/routes/models.ts:9-30`). README currently says
`GET /api/eval/models` is grouped (`README.md:754-758`).

Required resolution:

- make `GET /api/eval/models/by-server` the documented canonical discovery route for evaluation
  configuration and server-pinned `server::model` identifiers;
- update the frontend client to call it;
- retain flat `GET /models` for compatibility and document its actual shape; and
- include both response schemas in the OpenAPI contract.

### G6 — Public API documentation has drifted (P0)

The README endpoint table is not a reliable agent contract (`README.md:693-773`). The implemented
preset update is `PATCH` (`server/routes/presets.ts:23`), while evaluation deletion and cancellation
are distinct operations (`server/routes/evaluations.ts:229-246`). Confirmed examples:

- preset update is documented as `PUT`, implemented as `PATCH`;
- evaluation deletion is described as cancellation, although a separate cancel endpoint exists and
  `DELETE` removes the evaluation directory;
- grouped-model semantics are assigned to the flat model endpoint;
- purpose-template, test-suite, parse, by-server model, cancel, resolved-test-case, history,
  regression, baseline-list, summary-analysis, judge, and model-selection details are incomplete or
  absent; and
- request/response/error schemas and readiness states are not specified.

Publish a versioned OpenAPI document for the agent-supported surface and serve it from a stable
read-only route such as `GET /api/eval/openapi.json`. Keep a concise human workflow in README, but
treat the checked OpenAPI artifact as the machine-readable source of truth. Contract tests must fail
when route methods, required fields, response shapes, or examples drift.

### G7 — Results are browser-addressable; complete configuration is not (P1)

The existing run/results/summary routes are stable evaluation-ID handoff targets
(`src/main.tsx:28-30`), and their pages load server artifacts. `ResultsPage` passes configuration into
individual analysis views but offers no complete configuration panel (`src/pages/ResultsPage.tsx:175-235`).
G1's `/eval/config/:evalId` should show:

- prompt IDs, pinned versions, and prompt content;
- comparison mode and selected `server::model` IDs;
- purpose template, assertion template, and test-source identity;
- inline/resolved test cases and their annotations;
- judge, pairwise, repetition, inference, benchmark, and session settings;
- validation warnings and provenance; and
- state-appropriate actions: edit/save while draft, or read-only links to run/results after start.

## 4. Compatibility and safety requirements

- Preserve `POST /evaluations` create-and-start behavior for existing frontend and script callers.
- Keep detailed result, summary, export, retry, baseline, regression, and summary-analysis response
  bodies backward compatible.
- Build all new routes into `buildApp()` so standalone and HomeBase-hosted modes behave identically.
- Derive frontend/API URLs from the configured base path; never hard-code standalone-only paths.
- Never start a draft implicitly because it was created, read, or patched.
- Never permit mutation of a run after it leaves `draft`.
- Do not auto-commit the nested `data/` repository. Agent documentation must treat git commit/revert
  and delete operations as separate, explicitly requested actions.
- Keep confidence-interval gates and unqualified/self-judge advisory rules unchanged.
- Keep built-in suites immutable and keep pending-human-review results non-promotable.

## 5. Recommended delivery sequence

1. **Contract correction:** central validation, inference persistence, model-discovery fix, and route
   tests. Correct the shared types/specification where `baselineId` and route shapes have drifted.
2. **Draft lifecycle:** persisted draft status, draft create/update/start routes, and immutable
   post-start behavior.
3. **Browser handoff:** `/eval/config/:evalId`, server hydration, validation display, and draft start.
4. **Agent feedback:** snapshot endpoint with verdict summary, failures, readiness, and relative links.
5. **API publication:** OpenAPI artifact/route, contract checks, and concise workflow documentation.
6. **Agent skill:** create only after the acceptance gate in Sections 7-8 passes.

## 6. Optional improvements, not parity blockers

- Support an idempotency key for create-and-start calls to prevent duplicate runs after an uncertain
  client retry.
- Add pagination to evaluation/result lists if real data volume makes full responses expensive.
- Add a convenience endpoint that instantiates a draft from a purpose template. Agents can already
  compose this safely once drafts and validation exist, so it is not required for parity.
- Add a transactional “apply suggestion and rerun” endpoint. Existing version/session/evaluation calls
  already provide the behavior, so first prove that partial-failure recovery is a real problem.
- Expose WebSocket event schemas in OpenAPI-adjacent documentation for agents that choose live events
  over polling.

Do not fold AI-generated test-case creation or automated prompt-refinement loops into this work. They
are separate product features and should be evaluated with their own safety and dogfooding gates.

## 7. Acceptance and verification plan

### Service and route tests

- Draft create persists every supported field, including `inference`, without starting execution.
- Draft patch changes only supplied mutable fields and reruns shared validation.
- Draft start transitions once, dispatches one run, and rejects subsequent starts.
- Legacy `POST /evaluations` still creates and starts one run.
- Draft patch/start rejects missing references, invalid cardinality, conflicting test sources, invalid
  inference, invalid promotion suites, and mutation after start with stable error codes.
- Retry and suggestion-driven rerun preserve inference and other evaluation settings.
- Flat and grouped model endpoints return their documented shapes.
- Feedback snapshots are correct for `draft`, `pending`, `running`, `completed`, `failed`, and
  `cancelled`, including failures, summary readiness, and gate/advisory/inconclusive verdicts.
- OpenAPI examples validate against their schemas, and route-method/response contract tests detect
  drift.

### Standalone and hosted integration

- Exercise draft create/update/start through the shared Express composition root.
- Confirm relative browser paths resolve correctly at `/` and under `/lmeval/`.
- Confirm REST polling can recover complete state after missing all WebSocket events.

### Browser verification

- Create a draft through the API, open `/eval/config/:evalId`, and verify every persisted field.
- Edit and save the draft in the browser, then read the identical configuration through the API.
- Start it from either API or browser and verify the configuration becomes read-only.
- Follow the returned run, results, and summary paths through a completed evaluation.
- Verify warnings for weak test coverage, pending human review, missing/unqualified judge, and
  self-judging match API validation output.

Report automated, browser, and real-model verification separately. A passing unit suite does not
prove LMApi/model execution or the browser handoff.

## 8. Gate and requirements for the future agent skill

Create `.agents/skills/lmeval-evaluation-workflow/` only after all P0 gaps are implemented, the draft
and feedback workflows pass integration/browser verification, and the OpenAPI contract is current.
Validate the skill with the repository's skill validator before registering it for use.

The skill should stay concise and link to the OpenAPI/workflow reference for wire details. Its
instructions must require the agent to:

1. inspect existing purpose templates, prompts, suites, models, judge qualifications, and relevant
   prior results before creating duplicates;
2. state whether the experiment varies prompts or models and hold the other axis fixed; use a full
   matrix only when the user explicitly needs both axes varied;
3. default to a reviewable draft and browser config link unless the user requests immediate execution;
4. use existing reviewed suites where appropriate and never tune against the regression split;
5. establish human-reviewed ground truth before seeing candidate output;
6. avoid prompt few-shot examples as test cases and match production wrappers, escaping, taxonomy,
   inference, and output contracts;
7. include meaningful clear cases, confusable boundaries, realistic noise, adversarial instructions,
   format-pressure cases, and deliberate class/label/content-type coverage;
8. use `caseTags` for slices and call out sparse labels or slices that cannot support a stable verdict;
9. treat CI-straddling outcomes as inconclusive and unqualified/self-judged summarization as advisory;
10. stop and report clearly when validation, LMApi availability, model execution, or judge
    qualification prevents a trustworthy run; and
11. avoid delete, git commit/revert, promotion, or writes outside LMEval unless separately authorized.

After setting up or modifying an evaluation, the agent must give the user a thorough explanation that
includes:

- the evaluation question and why the chosen comparison mode answers it;
- prompts and pinned versions, models/servers, suites or inline cases, templates/assertions, judge,
  inference settings, repetitions, split, and estimated call count;
- why the test cases are representative and difficult enough to reveal useful differences;
- important boundaries, adversarial cases, output-contract checks, and known coverage gaps;
- which conclusions the dataset can and cannot support;
- any advisory, review-status, qualification, cost, or runtime caveats; and
- direct browser links for configuration, live run, results, and summary as those states become
  available.

After a run, the explanation should distinguish raw failures from aggregate metrics, describe the
gate and confidence interval, identify the most informative failing slices/cells, and recommend the
next experiment rather than presenting a score as self-explanatory.
