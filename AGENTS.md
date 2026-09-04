# AGENTS.md

Guidance for AI coding agents working in this repo. Read this before making changes.

## What this project is

LMEval is a local-first web app for systematic prompt engineering and model evaluation. It talks to [LMApi](https://github.com/illogical/LMApi) (a local model-routing layer, default `http://localhost:3111`) to run prompt A/B comparisons and N-prompt × M-model evaluation matrices, scored by deterministic checks (keyword/JSON-schema/tool-call matching) and optionally an LLM judge. Everything is stored as plain JSON/Markdown under `data/`, with an optional nested git repo there for prompt version history — see the README's "Git Integration Workflow" section before touching anything under `data/.git/` or `server/routes/git.ts` / `server/services/GitService.ts`.

Read [README.md](README.md) first — it has the full feature list, project structure, API endpoint table, and stack. Don't duplicate that content here; this file is about how to work in the repo, not what it does.

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

`docs/` accumulates per-feature design docs (`docs/features/<feature>/`) and phase plans (`docs/prompt-eval-system/`, `docs/plans/`). When implementing a feature that has a doc, read it first — several (e.g. `docs/plans/2026-08-23-homebase-integration.md`, `docs/features/eval-wizard/EVAL_WIZARD.md`) describe constraints (like the composition-root rule above) that aren't obvious from the code alone. `docs/prompt-eval-system/IMPLEMENTATION_PLAN.md` is the overall roadmap referenced from the README's Contributing section.

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
