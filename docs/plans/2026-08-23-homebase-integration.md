# LMEval HomeBase Integration — Phase 5 Handoff Plan

## Context

HomeBase (`C:\LocalDev\Projects\HomeBase\`) is a portal that hosts several
independently-maintained applications inside one Node process, sharing one
Express app and one `http.Server`. Each hosted application ships a compiled
"adapter" that implements HomeBase's `HostedApplication` contract
(`HomeBase/src/contracts/hostedApplication.ts`) while remaining fully
runnable on its own, standalone, exactly as it works today.

Three sibling applications have already done this migration and are the
reference pattern for this one:

- **LMApi** — `LMApi/docs/plans/2026-08-16-homebase-integration.md` and
  `LMApi/src/host/{contracts.ts,config.ts,adapter.ts,index.ts,__tests__/adapter.test.ts}`.
  Express + Socket.IO + SQLite. Compiles to **CommonJS**, so its host entry
  point uses `export =` (see that file's docblock for exactly why — do not
  copy this part for LMEval, see §7 below).
- **MemoryApi** — `MemoryApi/docs/plans/homebase-integration-plan.md`.
  Express + file/DB-backed services, genuinely ESM (`"type": "module"`),
  uses a plain `export default` host entry point and an `esbuild`-bundled
  host build to route around an extensionless-import problem plain `tsc`
  produced. **This is the closer template for LMEval** — read that plan in
  full before starting; several of its fixes apply here almost unchanged.
- **DevPlanner** — `DevPlanner/docs/plans/2026-08-16-homebase-integration.md`
  and `DevPlanner/docs/features/homebase-integration-handoff.md` — a second
  worked example of the same `export =` CJS-interop pitfall MemoryApi's plan
  documents.

Read `HomeBase/docs/SPECIFICATION.md` (particularly §2 Runtime/Deployment,
§4 HTTP and browser contracts, §5 Hosted application contract, §6 Lifecycle)
and `HomeBase/src/contracts/hostedApplication.ts` before making any change —
they are the actual contract; this document explains how LMEval maps onto
it, not a replacement for reading them.

This plan **only** covers LMEval-side and (at the end) the small additive
HomeBase-side registration. It does not implement anything by itself —
implement it in a separate, fresh session per HomeBase's own workflow
(`HomeBase/docs/TASKS.md`'s "How to use this task index").

## What LMEval is

A standalone web app for prompt engineering and model evaluation against
LMApi: side-by-side prompt comparison, a versioned prompt library, an N
prompts × M models evaluation matrix with deterministic + LLM-judge scoring,
real-time progress over WebSocket, and Git-backed prompt/eval version
history. React 19 + Vite frontend, Hono backend, file-based (no database)
storage under `data/`.

## The one architectural decision that makes this migration different from the other three

**LMEval's backend framework is Hono, not Express.** LMApi, MemoryApi, and
DevPlanner all already used Express and reused their existing `Router`
directly against the contract's `router?: import("express").Router` field.
LMEval has **no Express dependency at all** today (`package.json` confirmed
— `hono`, `@hono/node-server`, no `express`).

**Decision: port the 8 route modules from Hono to Express**, rather than
attempting to run a Hono app inside/under Express via some adapter shim.
Reasoning:

- The contract requires an actual Express `Router` — a shim that makes a
  Hono app *behave like* one is more fragile and more code than porting the
  routes, for a backend this size.
- Every route handler in `server/routes/*.ts` is small, framework-agnostic
  CRUD/proxy logic (confirmed by reading all 8 files) — no Hono-specific
  middleware or streaming feature is load-bearing here.
- Matches every other hosted app and `SPECIFICATION.md` §2.1's Express 5
  runtime baseline, so future contributors don't need to hold two different
  web-framework mental models for the same host process.

Do the Hono→Express port **first**, as its own commit/step, before touching
base-path or hosted-adapter concerns — it's easiest to verify in isolation
(standalone mode, same `/api/eval/*` routes, same behavior) before layering
the HomeBase-specific changes on top.

## Also different: LMEval is on bun, but doesn't need to be

`bun.lock` exists and several `package.json` scripts invoke `bun` directly
(`dev`, `dev:server`, `test:api`, `test:sessions`, `test:execution`,
`test:e2e-api`), but **no bun-only API is used anywhere in the source**:
confirmed no `bun:sqlite`, `bun:test`, `Bun.serve`, `Bun.file`, or `bunfig.toml`
across `server/` and `src/`. The server already runs via
`@hono/node-server`'s Node-compatible `serve()`. `@types/bun` is a
devDependency but nothing in the type-checked source needs it once bun
itself is gone.

**Migration is mechanical:**

1. Delete `bun.lock`.
2. Remove `@types/bun` from `devDependencies`.
3. `package-lock.json` already exists and is presumably current — run
   `npm install` to confirm it's in sync after removing bun's dependency.
4. Change scripts that invoke `bun <file>.ts` to whatever TS-runner LMApi
   and MemoryApi use for their own `dev`/script commands (check their
   `package.json`s — likely `tsx`) rather than introducing a third tool into
   this set of sibling apps. Add that package as a devDependency if not
   already present.
5. Confirm `npm run build`, `npm test`, `npm run lint` all still pass after
   the swap, before doing anything else.

## Required changes, in implementation order

### 1. Hono → Express port

Files: `server/index.ts`, all of `server/routes/*.ts` (`templates.ts`,
`prompts.ts`, `testSuites.ts`, `models.ts`, `sessions.ts`, `evaluations.ts`,
`git.ts`, `presets.ts`), the `app.onError` handler, `/api/eval/health`.

- Replace `new Hono()` / `app.route(...)` with `express.Router()` /
  `router.use(...)`.
- Port each Hono route handler's `(c) => c.json(...)` shape to Express's
  `(req, res) => res.json(...)`. Watch for Hono idioms that don't map 1:1:
  `c.req.param()`, `c.req.query()`, `c.req.json()` (async body parsing —
  Express needs `express.json()` middleware mounted first), `c.json(body, status)`
  vs Express's `res.status(status).json(body)`.
- Replace `hono/cors`'s `cors()` with the `cors` npm package (check what
  LMApi/MemoryApi use, if either mounts CORS at all inside the hosted
  adapter — HomeBase's shared origin may make per-app CORS unnecessary in
  hosted mode; keep it for standalone mode either way).
- Keep route paths identical (`/api/eval/templates`, etc.) — base-path
  prefixing is a separate concern, handled in step 4.
- Verify with the existing Vitest suite plus manual smoke testing in
  standalone mode before moving on.

### 2. Composition-root split (remove module-scope side effects)

`server/index.ts` currently does all of this at module scope: builds the
Hono app, seeds built-in templates (`TemplateService.seedBuiltIns()`),
checks Git init state (`GitService.isInitialized()`), and calls `serve(...)`
— which starts listening. None of this is allowed to happen on import for a
hosted adapter (`SPECIFICATION.md` §5's import-safety list: no listening, no
I/O, no timers, at import time).

Split into:

- A `buildApp(basePath: string): { app: express.Application; dispose: () => Promise<void> }`
  (or equivalent) function that mounts the ported Express router, registers
  the error handler, and returns the built app plus whatever cleanup is
  needed. This function does the seeding/git-check work (still I/O, but now
  deferred until called, not at import time).
- A standalone guard (same pattern MemoryApi used:
  `import.meta.url === pathToFileURL(process.argv[1]).href`, since LMEval is
  ESM) that calls `buildApp('/')`, then `app.listen(config.port, ...)`, then
  `setupWebSocket(httpServer)` — preserving today's exact standalone
  behavior and URLs.
- The hosted adapter's `initialize()` (step 6 below) calls `buildApp(basePath)`
  instead, and never calls `.listen()` itself — HomeBase owns the one shared
  `http.Server`.

### 3. Path injection for data directories

Files: `server/services/FileService.ts`, `GitService.ts`, `PresetService.ts`,
`ReportService.ts`, `JudgeService.ts`. Each currently computes a
module-scope `const` from `process.cwd()` (e.g.
`export const DATA_DIR = join(process.cwd(), 'data', 'evals');`).

Follow MemoryApi's `reconfigure()` pattern
(`MemoryApi/src/services/configService.ts`, described in its plan): replace
each module-scope path constant with a mutable value set by an exported
configure function, called once by the hosted adapter's `initialize()`
**before** anything that reads these paths is imported/used, with
`options.dataPath` (not `process.cwd()`) as the base. Standalone mode's
guard (step 2) calls the same configure function with `process.cwd()` so its
behavior is unchanged.

Watch for the same class of bug MemoryApi's plan found: if any of these
modules compute a *derived* value once at load time from the constant
(rather than reading the constant fresh on each call), a later reconfigure
won't take effect. Audit each of the five files for this before assuming a
simple `let` swap is sufficient.

### 4. Base-path mounting

- Adapter's `initialize()` mounts the Express router built in step 1/2 such
  that HomeBase's `app.use(options.basePath, router)` (done on HomeBase's
  side, per `ApplicationHost.ts`) results in routes reachable at
  `/lmeval/api/eval/...` — this should require no route-path changes if the
  adapter returns the router as-is; HomeBase handles the outer mount.
- Frontend: `src/api/eval.ts`'s `const BASE = '/api/eval'` and any other
  hardcoded root-relative path (check `src/contexts/WebSocketContext.tsx`
  for the WS URL, and any `fetch('/lmapi/...')` calls in `src/api/lmapi.ts`
  — the latter proxies to LMApi and needs its own base-path awareness only
  if LMApi's proxy path also becomes hosted-relative; confirm at
  implementation time whether that proxy should instead call LMApi's own
  `/lmapi/...` hosted route directly via `options.hostOrigin`/loopback,
  analogous to how MemoryApi's plan pointed `LLM_HOST` at LMApi over
  loopback (§4 of that plan) rather than through Vite's dev-only proxy).
- Recommended fix (MemoryApi's pattern): drop the leading `/` so paths are
  page-relative (`api/eval/...` instead of `/api/eval/...`) — since both
  HomeBase's `basePath` and LMEval's standalone root are trailing-slash,
  this needs no runtime origin detection. Verify react-router-dom v7's
  `basename` prop doesn't require the leading-slash form; if it does, use
  `options.basePath` directly as `basename` instead (HomeBase always
  supplies `/${slug}/`).
- Vite's dev-server proxy config (`/api/eval`, `/ws/eval`) stays as-is for
  standalone dev; it isn't used in hosted mode since HomeBase serves the
  built frontend, not the Vite dev server.

### 5. WebSocket namespacing

`server/ws.ts` hardcodes `new WebSocketServer({ server, path: '/ws/eval' })`
via the raw `ws` package. On HomeBase's shared server, an unnamespaced path
would intercept upgrade requests for *every* hosted app on the same origin,
not just LMEval's — a real collision, not a cosmetic one.

- Change `setupWebSocket` to accept `basePath` and use
  `` path: `${basePath}ws/eval` `` (`options.basePath` is always
  `/${slug}/`, e.g. `/lmeval/`, so this yields `/lmeval/ws/eval`).
- Wire this through the contract's `attachRealtime(server: http.Server): Promise<Disposer | void>`
  hook (`hostedApplication.ts`) instead of `setupWebSocket` owning its own
  server reference at module scope. Return a `Disposer` that calls
  `wss.close()`.
- Standalone mode's guard passes `'/'` as the base path, yielding `/ws/eval`
  — unchanged from today.
- Update the frontend WebSocket client (`src/contexts/WebSocketContext.tsx`)
  to compute the same namespaced path from the current page's base path.

### 6. Hosted adapter entry point

New files, mirroring LMApi's/MemoryApi's shape (decide `server/host/` vs
`src/host/` based on which the build tooling naturally supports — likely
`server/host/` since the backend already lives under `server/`):

- `contracts.ts` — re-export or mirror the relevant types from
  `HomeBase/src/contracts/hostedApplication.ts` (check whether LMApi/MemoryApi
  import HomeBase's contract package directly or hand-copy the types; match
  whichever pattern they use).
- `config.ts` — `parseHostedConfig(config)` validating `options.config`
  (LMEval likely needs no fields yet, same as LMApi's `z.object({}).passthrough()`
  placeholder — confirm no adapter-specific config is actually needed before
  copying that pattern verbatim).
- `adapter.ts` — the factory:
  - `contractVersion: HOSTED_CONTRACT_VERSION`
  - Lazy `router` getter, populated inside `initialize()`.
  - `initialize()`: configure data paths (step 3) using `options.dataPath`,
    call `buildApp(options.basePath)` (step 2), assign `router`, run the
    seed/git-init checks that used to be at module scope.
  - `attachRealtime(server)`: call the updated `setupWebSocket` (step 5)
    with `options.basePath`, return its `Disposer`.
  - `getStatus()`: `ready` once initialized and the WebSocket server is
    attached; `degraded` if LMApi (`config.lmapiBaseUrl`) is unreachable —
    decide whether this needs an active health check or can infer from
    recent request failures (a cheap `fetch` to LMApi's health endpoint at
    `getStatus()` time is simplest and matches the contract's 2000ms-per-call
    budget in `ApplicationHost.ts`).
  - `getActiveWork()`: report in-flight eval cells (`ExecutionService.ts`
    already tracks concurrency — check if it exposes an active-count; if
    not, add a minimal counter) so HomeBase's shutdown sequence can honor
    its grace window instead of cutting off a running evaluation.
  - `dispose()`: idempotent; call the WebSocket disposer (via
    `attachRealtime`'s returned `Disposer`, not duplicated here) and any
    `ExecutionService` shutdown needed to stop accepting new work.
- `index.ts` — the compiled entry point. **Use plain `export default createLmEvalAdapter(...)`** —
  LMEval is ESM (`"type": "module"`), confirmed in `package.json`, same as
  MemoryApi. Do **not** copy LMApi's `export =` — that exists only because
  LMApi compiles to CommonJS; using it here would be wrong for an ESM build
  and is exactly the kind of copy-paste mistake MemoryApi's plan flags.
- `__tests__/adapter.test.ts` — factory has zero side effects before
  `initialize()` (no listening, no file I/O, no env reads at call time
  beyond option destructuring); `dispose()` safe pre-`initialize()` and
  idempotent when called twice; `getStatus()` reflects a forced-unreachable
  LMApi as `degraded`.

### 7. Host build

Check `tsconfig.json`/`tsconfig.app.json`/`tsconfig.node.json` for
`moduleResolution`. If relative imports across `server/**` are extensionless
(likely, since Vite's default tooling tolerates this) and `moduleResolution`
isn't `nodenext`, a plain `tsc -p tsconfig.host.json` build will produce
output Node's native ESM loader rejects at runtime — the exact failure
MemoryApi's plan documents in detail (`ERR_MODULE_NOT_FOUND`).

If confirmed: add `esbuild` as a devDependency and a `build:host` script
bundling the host entry point — `esbuild server/host/index.ts --bundle
--platform=node --format=esm --outfile=dist/host/index.js --packages=external`
— mirroring MemoryApi's fix exactly (marks all real `package.json`
dependencies external so they still resolve via `node_modules`, inlines the
local `server/**` import graph so no unresolved bare relative specifier
remains).

Verify empirically after building:

```
node -e "import('./dist/host/index.js').then(m => console.log(typeof m.default))"
```

must print `function`.

## Files touched (LMEval repo)

- `server/index.ts` — composition-root split, standalone guard, Express app
  (no more Hono/`serve()` at module scope for hosted mode).
- `server/routes/*.ts` (8 files) — Hono → Express port.
- `server/ws.ts` — accept `basePath`, namespace the WebSocket path, return a
  disposer instead of owning server lifecycle.
- `server/services/FileService.ts`, `GitService.ts`, `PresetService.ts`,
  `ReportService.ts`, `JudgeService.ts` — path injection via a configure
  function instead of module-scope `process.cwd()` constants.
- `server/services/ExecutionService.ts` — expose an active-work signal if
  one doesn't already exist, for `getActiveWork()`.
- `src/api/eval.ts`, `src/api/lmapi.ts`, `src/contexts/WebSocketContext.tsx` —
  base-path-relative URLs.
- New: `server/host/{contracts.ts, config.ts, adapter.ts, index.ts,
  __tests__/adapter.test.ts}` (or `src/host/...`, per the decision in §6).
- `package.json` — remove `bun`-invoking scripts and `@types/bun`; add
  `esbuild` (if needed per §7) and `build:host`; add the TS-runner used for
  dev scripts (per the bun-migration section above) if not already present.
- Delete `bun.lock`.
- `README.md` — note the standalone-vs-hosted split and how to run each.

## HomeBase-side changes (separate, additive — do once the LMEval-side work above is ready to verify live)

- `HomeBase/config/homebase.json` (git-ignored, local-only): add an `lmeval`
  entry shaped like `config/homebase.example.json`'s `example-app` template
  — `id: "lmeval"`, `slug: "lmeval"`, `repoPath` pointing at this repo,
  `adapterPath: "dist/host/index.js"`, `contractVersion: 1`,
  `packageManager: "npm"`, `enabled: false` until the live verification pass
  below succeeds, then flip to `true`.
- `HomeBase/docker-compose.yml` and `docker-compose.dev.yml`: add an
  `lmeval-node-modules` named volume and the matching workspace mount,
  following the existing `devplanner-node-modules` / `lmapi-node-modules` /
  `memoryapi-node-modules` pattern (see those files' current volume
  sections for the exact shape to copy).
- `HomeBase/docs/TASKS.md`: check off LMEval's Phase 5 line and update its
  "Plan:" pointer once implementation and live verification are complete.

## Verification

Standalone (must remain unchanged throughout):

- `npm install && npm run dev` — frontend (Vite) and backend serve as
  today, `/api/eval/...` and `/ws/eval` reachable at root, no `bun` needed.
- `npm test`, `npm run lint`, `npm run build` all pass.
- `npm run test:e2e-ui` (Playwright) still passes against the ported Express
  routes.

Hosted (new):

- `npm run build:host` produces `dist/host/index.js`; the
  `typeof m.default === 'function'` regression check from §7 passes.
- `server/host/__tests__/adapter.test.ts` passes (side-effect-free factory,
  idempotent dispose, degraded status on LMApi unreachability).
- With HomeBase running and `lmeval.enabled: true`, alongside LMApi (and
  ideally MemoryApi/DevPlanner) also enabled:
  - Dashboard card renders `ready`/`degraded` honestly.
  - The eval wizard UI loads and is fully usable under `/lmeval/`.
  - A full N×M eval run completes end-to-end with live WebSocket progress
    events, verified to arrive only for this app's client (no cross-talk
    with LMApi's Socket.IO traffic or any other hosted app's realtime
    channel).
  - LMApi calls from LMEval succeed via loopback/`hostOrigin` in hosted
    mode.
  - `dispose()` during a HomeBase shutdown leaves no open WebSocket
    connections or file handles (check via `docker compose down` or a
    local process inspection, same bar as LMApi's/MemoryApi's verification).
  - Standalone mode, re-checked after all hosted-mode changes have landed,
    still behaves exactly as it did before this migration started.
