# AGENTS.md

Guidance for AI coding agents working in this repo. Read this before making changes.

## Read these first — every time, before implementing

Three documents carry the project's intent. Read them before writing code; don't ask the user to
point at them again, and don't infer the goals from the code alone.

| Document | What it answers | When it wins |
|---|---|---|
| [README.md](README.md) | What LMEval is, how to run it, what every evaluation concept means, what a good test case looks like, the API endpoint table, project structure | User-facing behavior, terminology, onboarding |
| [docs/SPECIFICATION.md](docs/SPECIFICATION.md) | The authoritative current + target state: data model, execution engine, wizard UX, non-goals | **Architecture disputes.** It explicitly overrides older planning docs |
| [docs/TASK.md](docs/TASK.md) | The single unified task list — what is done, what is in flight, what is deliberately not started | **What to work on.** It supersedes `docs/prompt-eval-system/TASK.md` and `docs/features/eval-wizard/TASK.md`, which are historical only |

Doc precedence when they disagree: `docs/SPECIFICATION.md` > `docs/TASK.md` > `docs/plans/<dated>.md` >
anything under `docs/prompt-eval-system/` or `docs/features/`. Older docs are historical inputs, not
competing specs — don't "fix" the spec to match an old plan.

Two more, when the work touches evaluation quality rather than plumbing:

- [`docs/plans/2026-09-03-professional-memory-evaluations.md`](docs/plans/2026-09-03-professional-memory-evaluations.md)
  — the scoring, gate, statistics, judge-qualification and model-selection design. If you are touching
  metrics, thresholds, or anything that produces a verdict, this is the reasoning behind it.
- [`docs/plans/2026-09-03-promptfoo-adoption-and-purpose-templates.md`](docs/plans/2026-09-03-promptfoo-adoption-and-purpose-templates.md)
  — why Promptfoo is the engine and how `EvaluationConfig` maps onto it.

## What this project is

LMEval is a local-first web app for systematic prompt engineering and model evaluation. It talks to [LMApi](https://github.com/illogical/LMApi) (a local model-routing layer, default `http://localhost:3111`) to run prompt A/B comparisons and N-prompt × M-model evaluation matrices, scored by deterministic assertions and optionally an LLM judge. Everything is stored as plain JSON/Markdown under `data/`, with an optional nested git repo there for prompt version history — see the README's "Git Integration Workflow" section before touching anything under `data/.git/` or `server/routes/git.ts` / `server/services/GitService.ts`.

It answers exactly two questions, and they are **not** the same experiment: *which prompt wording is
best* (vary the prompt, fix the model) and *which model is best for this task* (fix the promoted
prompt, vary the model). `EvaluationConfig.comparisonMode` encodes the distinction — don't add
features that blur it.

The first real consumer is MemoryApi, whose three ingestion tasks — classification (8 categories),
tagging (61 tags), summarization — are the three built-in purpose templates. The relationship is
deliberately asymmetric: MemoryApi owns ground truth and receives advisory promotion records; LMEval
owns measurement and receives datasets. **Never add code that writes into MemoryApi's repo or calls it
at runtime.**

## Execution engine: Promptfoo, not hand-rolled

Evaluations run through the `promptfoo` npm package **in-process** (`evaluate(testSuite, { progressCallback })`),
not its CLI. `server/services/ExecutionService.ts` and `PromptfooAdapter` translate an `EvaluationConfig`
into a Promptfoo `TestSuite` and map results back into `EvalMatrixCell[]`. When you need a new check,
reach for a Promptfoo assertion type (or a bundled `javascript` assertion) — do not resurrect the
former hand-rolled `MetricsService` checks or `JudgeService` rubric construction, which this replaced.
`EvalMatrixCell.assertionResults` mirrors Promptfoo's `GradingResult` shape; the legacy
`deterministicMetrics` field survives only for pre-migration data.

Scoring above the assertion layer lives in `SummaryService` (`taskMetrics`, a discriminated union per
task type), `StatisticsService` (bootstrap CIs, McNemar, the case-count gate), and
`JudgeQualificationService`. Two rules there are non-negotiable, because a false pass is worse than no
answer: **gates are expressed against the confidence interval, never the point estimate** (a CI
straddling the threshold is `inconclusive`, not a pass), and **a summarization result from an
unqualified or self-judging judge is `advisory`**, never promotable.

## Two run modes — don't break either

The same `server/` code runs two ways:

- **Standalone**: `server/index.ts` is the entry point (`npx tsx server/index.ts`), listens on its own port (`PORT`, default 3200), owns its own `express()` app and WebSocket server.
- **Hosted under [HomeBase](https://github.com/illogical/HomeBase)**: `server/host/` exports a `HostedApplication` adapter that HomeBase dynamically imports and mounts under `/lmeval/` inside HomeBase's own `http.Server`. Built via `npm run build:host` into `dist/host/index.js`.

`buildApp()` in `server/index.ts` is the **composition root** shared by both — it returns a bare `Router`, has no side effects beyond registering routes/seeding, and never calls `.listen()` or touches WebSockets. If you add a new route or startup check, put it in `buildApp()`, not in the `isMainModule` guard below it, or it won't run under HomeBase. See `docs/plans/2026-08-23-homebase-integration.md` for the full integration design and `server/host/contracts.ts` for the adapter contract.

Frontend asset paths differ between modes too: `npm run build` (root-relative) vs `npm run build:hosted` (`/lmeval/`-prefixed, via `VITE_BASE_PATH`). Both write to `dist/`, so don't assume `dist/` reflects whichever mode you're testing.

## Architecture conventions

- **Backend**: Express 5, routes in `server/routes/*.ts` are thin — they call into `server/services/*.ts`, which own the actual logic (file I/O via `FileService`, LMApi calls via `LmapiClient`, eval orchestration via `ExecutionService`, etc.). Keep that split when adding endpoints.
- **Storage**: no database — everything is JSON/Markdown files under `data/`, written via `FileService`. `data/evals/prompts/` is additionally gitignored from the *outer* repo (it lives inside `data/`'s own nested git repo instead, per the Git Integration workflow).
- **Frontend**: Vite + React 19 + TypeScript, feature-organized under `src/components/<feature>/`, with `src/pages/` as route-level containers and `src/contexts/EvalWizardContext.tsx` holding the multi-step wizard's `useReducer` state (persisted to `localStorage`).
- **Realtime**: `server/ws.ts` broadcasts eval progress (`cell:started`, `cell:completed`, `eval:progress`, `eval:completed`) over a base-path-namespaced `ws` server; the frontend consumes it via `WebSocketContext` + `useEvalSocket`.
- **Types**: shared interfaces live in `src/types/*.ts`; `server/types/` re-exports from there rather than redefining — keep frontend/backend types in sync through that re-export, don't fork them.

## Working with docs/

Open work lives in one place: [`docs/TASK.md`](docs/TASK.md). Everything else under `docs/` is either
authoritative reference ([`docs/SPECIFICATION.md`](docs/SPECIFICATION.md)) or a historical record.

- `docs/plans/<YYYY-MM-DD>-*.md` — dated design docs for a specific piece of work. The most recent
  ones describe the current direction; read the plan before implementing a feature it covers.
- `docs/features/<feature>/` and `docs/prompt-eval-system/` — earlier per-feature and phase plans.
  Still useful for constraints that aren't obvious from the code (e.g.
  `docs/plans/2026-08-23-homebase-integration.md`'s composition-root rule, or
  `docs/features/eval-wizard/EVAL_WIZARD.md`'s wizard architecture), but their checklists and task
  lists are superseded — do not pick work from them.
- When you finish a piece of work, update `docs/TASK.md`, and update `docs/SPECIFICATION.md` if the
  change moved the architecture or data model. Don't leave the spec describing something the code no
  longer does.

## Running things

- `npm run dev` — frontend (Vite, :5173) + backend (Express, :3200) concurrently. Requires LMApi running locally (see Prerequisites in README) for anything that actually calls a model.
- `npm run lint` / `npm run test` — ESLint (flat config, typescript-eslint + react-hooks + react-refresh) and Vitest unit tests (`src/test/`, jsdom).
- `npm run test:api` / `test:sessions` / `test:execution` — integration scripts against a running server (and LMApi, for `test:execution`). Not run in plain `npm test`.
- `npm run test:e2e-ui` — Playwright against `tests/e2e/`; it auto-starts `npm run dev` as its webServer (see `playwright.config.ts`), single worker, not parallel.
- Before claiming a UI change works, actually run the dev server and click through it (or run the relevant Playwright spec) — don't rely on lint/typecheck/unit tests alone for feature correctness.

## Things to be careful about

- **Never auto-commit to `data/`'s nested git repo.** The README is explicit: "LMEval never commits automatically. Every commit is triggered by an explicit API call." Don't add code paths that call `GitService`'s commit logic outside of the `/api/eval/git/commit` endpoint.
- **Commit message format for `data/` commits** is enforced: `(feat|fix|chore)(prompt): <description>` — see README's Git Integration Workflow for which prefix fits which change.
- Don't confuse the **outer repo** (this LMEval source checkout, normal `git`) with the **inner repo** (`data/.git/`, prompt/eval history). The outer `.gitignore` excludes `data/.git/` and `data/evals/prompts/` so they never collide.
- When changing anything under `server/`, check whether the change needs to work identically in both standalone and hosted mode (see above) — most bugs in this area come from code that assumes `server/index.ts`'s standalone entry point is the only caller.
