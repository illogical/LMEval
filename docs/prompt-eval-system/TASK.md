# Prompt & Model Evaluation System — Task List

> MVP plan: [`../features/prompt-eval-system/MVP_PROMPT_COMPARISON.md`](../features/prompt-eval-system/MVP_PROMPT_COMPARISON.md)
> Full implementation plan: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)
> Original design spec: [`prompt-eval-system-plan.md`](prompt-eval-system-plan.md)
> LMApi API reference: [`LMAPI_API_REFERENCE.md`](LMAPI_API_REFERENCE.md)

This project is a standalone Bun + Vite + React + TypeScript application that consumes the LMApi service for all LLM model interactions.

**Implementation order**: Complete Phase 0 (MVP) first to establish the UI foundation, then proceed to Phase 1 (backend) and beyond.

---

## Phase 0 — MVP: Prompt Comparison UI

> Spec: [`../features/prompt-eval-system/MVP_PROMPT_COMPARISON.md`](../features/prompt-eval-system/MVP_PROMPT_COMPARISON.md)
>
> Goal: Working side-by-side prompt comparison UI that calls LMApi directly from the browser. No backend server required.

- [x] Scaffold project with `bun create vite prompt-eval --template react-ts`
- [x] Install MVP dependency: `bun add highlight.js`
- [x] Update `vite.config.ts` — add `/lmapi` proxy to `http://localhost:3111`
- [x] Update `index.html` — title → "LMEval", add Inter + JetBrains Mono Google Fonts `<link>` tags
- [x] Replace `src/index.css` — vaultpad-inspired CSS custom properties (`--bg`, `--surface`, `--surface-preview`, `--text`, `--muted`, `--accent`, `--border`, `--ok`, `--error`, `--font-ui`, `--font-mono`), base reset, full-height `body`/`#root` (remove Vite defaults: `place-items: center`, `max-width`)
- [x] Replace `src/App.css` — layout CSS: `.app-layout` (4-row grid), `.main-area`, `.response-area`, `.prompt-panel`, `.panel-label`, `.prompt-textarea`, `.response-view`, `.user-message-bar`, header styles, skeleton animation, error/hint classes
- [x] Create `src/types/lmapi.ts` — `LmapiServerStatus`, `LmapiChatCompletionRequest`, `LmapiChatCompletionResponse` (see MVP spec for full shapes)
- [x] Create `src/api/lmapi.ts` — `getServers(): Promise<LmapiServerStatus[]>`, `chatCompletion(req): Promise<LmapiChatCompletionResponse>` (note: `/lmapi/api/servers` returns array directly, not `{ servers: [] }`)
- [x] Create `src/hooks/useModels.ts` — calls `getServers()` on mount, filters `isOnline`, flattens to `ModelOption[]` grouped by `config.name`; returns `{ models, loading, error }`
- [x] Create `src/components/layout/Header.tsx` — flex row: LMEval logo (accent + JetBrains Mono) | `<select>` with `<optgroup>` per server | Run Both button (disabled when loading/no model) + status indicator
- [x] Create `src/components/prompt/ResponseView.tsx` — imports `highlight.js/styles/atom-one-dark.css`, registers `markdown`/`json`/`xml`/`yaml` languages, uses `hljs.highlightAuto()` + `dangerouslySetInnerHTML`; handles idle/loading (skeleton)/error/done states
- [x] Create `src/components/prompt/PromptPanel.tsx` — `label` + `<textarea>` (editor mode) or `<ResponseView>` (response mode); flex column filling grid cell
- [x] Replace `src/App.tsx` — `PromptState` tuple, `userMessage`, `selectedModel` state; `handleRun` with `Promise.allSettled`; auto-select first model on load; 4-section layout JSX
- [x] **Verification**: `bun run dev` → both prompt editors side by side with dark theme → model selector populated from LMApi → enter two prompts + user message → Run Both → responses appear with syntax highlighting → `lmapi.duration_ms` shown per response → error state shown on failure

---

## Phase 1 — Backend: Services & CRUD API

> Prerequisite: Phase 0 complete. At this point `src/types/lmapi.ts` already exists — reuse it.
>
> The backend introduces the Hono server, file-based storage, and eval data management. The frontend Tailwind migration also happens here.

- [x] Install backend dependencies: `bun add hono ajv diff socket.io-client @tailwindcss/vite tailwindcss` and `bun add -d @types/diff @types/bun`
- [x] Configure `vite.config.ts` — add `/api/eval` proxy to `:3200` and `/ws/eval` WebSocket proxy alongside existing `/lmapi` proxy
- [x] Created `src/index.css` with CSS custom properties for the eval palette (Tailwind migration deferred per Phase 1 scope)
- [x] Create `.example.env` with `PORT=3200` and `LMAPI_BASE_URL=http://localhost:3111`
- [x] Create `server/index.ts` — Hono app on port 3200 with `@hono/node-server`
- [x] Create shared TypeScript types:
  - [x] `src/types/eval.ts` — all eval system interfaces from Section 2.2 of `prompt-eval-system-plan.md` (`EvalTemplate`, `JudgePerspective`, `PromptManifest`, `PromptVersionMeta`, `ToolDefinition`, `TestSuite`, `TestCase`, `ExpectedToolCall`, `EvaluationConfig`, `EvaluationResults`, `EvalMatrixCell`, `ToolCallResult`, `JudgeResult`, `PairwiseRanking`, `EvaluationSummary`, `EvalStreamEvent`)
  - [x] Expand `src/types/lmapi.ts` — add `LmapiBatchResponse`, `ToolCall`, `ToolDefinition` (extends Phase 0 types)
  - [x] `server/types/eval.ts` — re-export shared types for backend use
- [x] Create `server/services/FileService.ts` — JSON/Markdown I/O, slug generation, directory helpers, `ensureDir`, `generateId` (see Section 4.2)
- [x] Create `data/evals/` directory structure: `templates/`, `templates/custom/`, `prompts/`, `test-suites/`, `evaluations/`, `baselines/`
- [x] Create built-in template JSON files in `data/evals/templates/`:
  - [x] `general-quality.json` (Accuracy 0.3, Completeness 0.25, Instruction Following 0.25, Conciseness 0.2)
  - [x] `tool-calling.json` (Tool Selection 0.35, Argument Quality 0.3, Reasoning 0.2, Error Handling 0.15)
  - [x] `code-generation.json` (Correctness 0.35, Code Quality 0.25, Completeness 0.2, Efficiency 0.2)
  - [x] `instruction-following.json` (Explicit Instructions 0.4, Format Compliance 0.3, Constraint Adherence 0.2, No Hallucination 0.1)
- [x] Create `scripts/seed-templates.ts` — idempotent seeder for built-in templates
- [x] Create `server/services/LmapiClient.ts` — HTTP client wrapper for LMApi: `getServers()`, `getModels()`, `chatCompletion()` with timeout handling and error wrapping (see Section 4.1)
- [x] Create `server/services/TemplateService.ts` — list/get/create/update/delete/isBuiltIn/seedBuiltIns (see Section 4.3)
- [x] Create `server/services/PromptService.ts` — list/get/getVersionContent/create/addVersion/diff/updateTools/estimateTokens (see Section 4.4)
- [x] Create `server/services/TestSuiteService.ts` — list/get/create/update/delete (see Section 4.5)
- [x] Create `server/routes/templates.ts` — GET list, GET by id, POST create, PUT update, DELETE (Hono routes with request validation)
- [x] Create `server/routes/prompts.ts` — GET list, GET by id, GET version content, POST create, POST add version, GET diff, PUT update tools
- [x] Create `server/routes/testSuites.ts` — GET list, GET by id, POST create, PUT update, DELETE
- [x] Create `server/routes/models.ts` — GET proxy to LMApi servers endpoint, returns grouped model list
- [x] Wire all routes into `server/index.ts`; seed built-in templates on startup
- [x] Create `scripts/test-api.ts` — integration test covering: template CRUD (create custom, list includes built-ins, delete custom, reject delete built-in); prompt CRUD (create, add version, get content, diff); test suite CRUD; model list proxy returns data from LMApi
- [x] Add `"scripts": { "dev:server": ..., "dev:client": ..., "test:api": ... }` to `package.json`
- [x] **Verification**: `scripts/test-api.ts` integration test created; service logic verified; run against live server+LMApi to confirm end-to-end

---

## Phase 1.5 — Session Management Foundation + Prompt Upload

> Prerequisite: Phase 1 complete. Must be implemented before Phase 2 so evaluation runs can be linked to sessions from day one.
>
> Specs: [`../features/session-management/SESSION_MANAGEMENT.md`](../features/session-management/SESSION_MANAGEMENT.md) | [`../features/prompt-upload/PROMPT_UPLOAD.md`](../features/prompt-upload/PROMPT_UPLOAD.md)

**Session Backend:**
- [ ] Create `src/types/session.ts` — `SessionSlot`, `SessionVersionMeta`, `SessionVersion`, `SessionManifest`, `EvalRun`, `ImprovementSuggestion` interfaces (see `SESSION_MANAGEMENT.md` for full type definitions)
- [ ] Add `SESSIONS_DIR = join(process.cwd(), 'data', 'sessions')` constant to `server/services/FileService.ts`
- [ ] Create `data/sessions/.gitkeep` to track the directory in git
- [ ] Create `server/services/SessionService.ts` — `list`, `get`, `getBySlug`, `getVersion`, `getActiveVersion`, `create`, `createVersion`, `setLatestVersion`, `addEvalRun`, `getEvalRun`, `listEvalRuns`, `updateEvalRun`, `delete`
- [ ] Create `server/routes/sessions.ts` — `GET` list, `GET` by id, `GET` active version, `GET` version by number, `POST` create, `POST` add version, `PUT` latest pointer, `GET` runs, `POST` add run, `PATCH` update run, `DELETE`
- [ ] Wire `sessionsRouter` into `server/index.ts` at `/api/eval/sessions`
- [ ] Create `scripts/test-sessions.ts` — integration test: create session with two valid prompt slots → add second version (swap B to A, new B) → list shows both versions → add eval run → update run status → delete session
- [ ] Add `"test:sessions": "bun run scripts/test-sessions.ts"` to `package.json`
- [ ] **Verification**: `bun run test:sessions` passes; `data/sessions/{slug}/manifest.json` created with correct shape; `v1.json` and `v2.json` present after version creation; run record written to `runs/{runId}.json`; `latestVersion` pointer updated correctly

**Prompt Upload Frontend:**
- [ ] Create `src/api/eval.ts` (pull forward from Phase 5) with `createPrompt(name, content)` and `addPromptVersion(id, content, description?)` fetch wrappers targeting `/api/eval/prompts`
- [ ] Update `src/components/prompt/PromptPanel.tsx` — add `onFileUpload`, `uploadStatus`, `uploadError` props; add `isDragOver` state; add `onDragOver`/`onDragLeave`/`onDrop` handlers; add "Browse" button with hidden `<input type="file" accept=".txt,.md">`; add upload status strip below textarea; add drag highlight class when `isDragOver`
- [ ] Add CSS classes to `src/App.css`: `.prompt-panel--dragging` (border + glow), `.upload-hint`, `.upload-browse`, `.upload-progress`, `.upload-progress--reading/saving/saved/error`
- [ ] Update `src/App.tsx` — add `promptManifests: [PromptManifest | null, PromptManifest | null]` state; add `uploadStatus` state; add `activeSessionId` state (persisted in `localStorage`); implement `handleFileUpload(side, content, fileName)` calling `createPrompt` or `addPromptVersion`; pass `onFileUpload` to both editor PromptPanel instances
- [ ] **Verification**: Drag a `.md` file onto Prompt A panel → textarea populates immediately → status shows "Saving…" then "Saved" → `POST /api/eval/prompts` fires → manifest stored; drag second file → `POST /api/eval/prompts/:id/versions` fires; Browse button opens picker with same behavior; unsupported type shows inline error

**Prompt Version Advancement (B → A):**
- [ ] Add `onAdvance` prop to `PromptPanel` — renders "Use as Prompt A →" button in the B panel header when panel has content; absent from A panel
- [ ] Implement `handleAdvance()` in `App.tsx`: copy `prompts[1]` content → `prompts[0]`; clear `prompts[1]`; copy `promptManifests[1]` → `promptManifests[0]`; clear `promptManifests[1]`; if `activeSessionId` is set, call `POST /api/eval/sessions/:id/versions` with new slot data
- [ ] **Verification**: Type into Prompt B → click "Use as Prompt A →" → content moves to A, B clears → session gains new version in `data/sessions/` → refreshing the page re-connects to active session via `localStorage`

---

## Phase 2 — Evaluation Engine: Execution Pipeline (No Judge)

- [ ] Create `server/services/MetricsService.ts` — `validateJsonSchema()` using ajv (singleton, `allErrors: true`); `validateToolCalls()` against definitions + expected calls; `checkKeywords()` for required/forbidden; `estimateTokenCount()` (see Section 4.6)
- [ ] Create `server/services/SummaryService.ts` — `computeSummary()` with per-model and per-prompt aggregate rankings using deterministic metrics only; `computeConsistency()` for multi-run variance (see Section 4.9)
- [ ] Create `server/services/ExecutionService.ts` — 3 of 4 phases:
  - [ ] Phase 1: `buildMatrix()` — expand all prompt × model × testCase × run combinations into `EvalMatrixCell[]`; `estimateCost()` for token/time estimates
  - [ ] Phase 2: `runCompletions()` — dispatch each cell via `LmapiClient.chatCompletion()` with `stream: false` and `groupId: evalId`; run deterministic checks via `MetricsService` on each completed cell; use `Promise.allSettled()` for parallel dispatch; implement `Semaphore` class for batching (default limit: 8 concurrent)
  - [ ] Phase 4: `aggregate()` — call `SummaryService.computeSummary()`, write `results.json` + `summary.json`
  - [ ] `AbortController` map for cancel support; `cancel(evalId)` method
  - [ ] Write `config.json` with `status: 'pending' → 'running' → 'completed'/'failed'`
- [ ] Create `server/ws.ts` — Bun native WebSocket server at `/ws/eval`; broadcast `EvalStreamEvent` messages to all connected clients; track connected clients
- [ ] Emit WebSocket events during execution: `cell:started`, `cell:completed`, `cell:failed`, `eval:progress`, `eval:completed`, `eval:failed`
- [ ] Create `server/routes/evaluations.ts`:
  - [ ] `GET /api/eval/evaluations` — list evaluations with optional status/promptId/modelId filters
  - [ ] `GET /api/eval/evaluations/:id` — read and return `config.json`
  - [ ] `GET /api/eval/evaluations/:id/results` — read and return `results.json`
  - [ ] `GET /api/eval/evaluations/:id/summary` — read and return `summary.json`
  - [ ] `POST /api/eval/evaluations` — validate config, write `config.json`, call `ExecutionService.run(id)` async (do not await), return 202 with config
  - [ ] `DELETE /api/eval/evaluations/:id` — call `ExecutionService.cancel(id)`, return success/failure
- [ ] Add retry resilience to `server/services/LmapiClient.ts` (see [`../../features/retry-resilience/RETRY_RESILIENCE.md`](../../features/retry-resilience/RETRY_RESILIENCE.md)):
  - [ ] Read `LMAPI_RETRY_COUNT` (default 3) and `LMAPI_RETRY_DELAY_MS` (default 2000) from environment
  - [ ] Wrap `chatCompletion()` with `withRetry()` helper — linear backoff (attempt × delay); retry on 429/502/503/504 and network errors; throw immediately on 4xx client errors
  - [ ] Add `retryAttempts?: { attemptNumber, error, timestamp }[]` and `errorType?` fields to `EvalMatrixCell` in `src/types/eval.ts`
  - [ ] `ExecutionService` populates `retryAttempts` on each failed attempt before final failure
  - [ ] Add `LMAPI_RETRY_COUNT` and `LMAPI_RETRY_DELAY_MS` to `.example.env`
- [ ] Add session linking to evaluation runs (see [`../../features/session-management/SESSION_MANAGEMENT.md`](../../features/session-management/SESSION_MANAGEMENT.md)):
  - [ ] `POST /api/eval/evaluations` accepts optional `{ sessionId, sessionVersion }` in request body
  - [ ] If `sessionId` provided: call `SessionService.addEvalRun(sessionId, sessionVersion, evalId)` after writing `config.json`; return `evalRunId` in the 202 response
  - [ ] `ExecutionService.aggregate()`: after writing `summary.json`, call `SessionService.updateEvalRun()` with `{ status: 'completed', completedAt, scoreSummary }` (extract `promptAScore`/`promptBScore` from `EvaluationSummary.promptSummaries`)
  - [ ] On eval failure: call `SessionService.updateEvalRun()` with `{ status: 'failed' }`
- [ ] Add eval re-run endpoint:
  - [ ] `POST /api/eval/evaluations/:id/retry` — read original `config.json`; if `failedCellsOnly: true`, filter to failed cells; write new eval ID; call `ExecutionService.run(newEvalId)` async; if `sessionId` provided, link new run to session; return 202 `{ evalId, evalRunId? }`
- [ ] Create `scripts/test-execution.ts` — end-to-end test: connect WebSocket, create minimal eval (1 prompt × 1 model × 1 test case, no judge), listen for `eval:completed`, verify `results.json` structure (cells have response content + deterministic metrics), verify `summary.json` (model rankings populated)
- [ ] Add `"test:execution": "bun run scripts/test-execution.ts"` to `package.json`
- [ ] **Verification**: `bun run test:execution` — eval completes; `config.json` status transitions to `completed`; all matrix cells present in `results.json` with populated metrics (inputTokens, outputTokens, durationMs, tokensPerSecond, serverName); `summary.json` has model rankings; WebSocket events arrive in correct sequence (cell:started → cell:completed → eval:progress → eval:completed); cancel mid-run stops execution cleanly; eval with `sessionId` creates `EvalRun` record and populates `scoreSummary` after completion; simulate 503 response → retry fires and cell eventually completes

---

## Phase 2.5 — Git Integration for Prompt Versioning

> Prerequisite: Phase 2 complete (sessions + eval runs exist to commit).
>
> Spec: [`../../features/git-integration/GIT_INTEGRATION.md`](../../features/git-integration/GIT_INTEGRATION.md)
>
> Scope: Human-confirmed git commits on the `data/` directory. Automated commits come later in Phase 8.

- [ ] Create `server/services/GitService.ts` — `isInitialized()`, `init()`, `status()`, `commit(message)`, `log(limit?)`, `revert(hash)`; all git calls use `child_process.execFile` (not `exec`) with args as string array to prevent shell injection; `DATA_ROOT = join(process.cwd(), 'data')`
- [ ] Create `server/routes/git.ts` — `GET /status` (initialized + status + last 10 log entries), `POST /init` (idempotent), `POST /commit` (validates message matches `/^(feat|fix|chore)\(prompt\):/`; links to session run if `sessionId`+`runId` provided), `POST /revert` (validates hash is alphanumeric only), `GET /log?limit=N`
- [ ] Wire `gitRouter` into `server/index.ts` at `/api/eval/git`; log warning on startup if `data/` is not a git repo
- [ ] On `POST /api/eval/git/init`, also write `data/.gitignore` with `*.tmp` exclusion
- [ ] Add `.gitignore` note to root `.gitignore`: add `data/.git/` to prevent nested repo detection
- [ ] Frontend — add "Commit Improvement" button in results area (visible after eval completes with positive `scoreDelta`): pre-fills `feat(prompt): improve {session.name} (+{delta} score)`; editable before submit; shows commit hash on success; button becomes disabled "Committed ✓" after commit
- [ ] Frontend — add "Revert to Previous" button (visible when log has ≥ 1 commit): shows last commit subject + date; confirmation dialog before calling `POST /api/eval/git/revert`; toast on success
- [ ] **Verification**: `POST /api/eval/git/init` → `data/.git/` created; create prompt + session + eval → commit → `GET /api/eval/git/log` returns entry with correct hash/subject/date; `POST /commit` with invalid message → 400; `POST /revert` → changes undone; UI buttons pre-fill correct message and show hash

---

## Phase 3 — LLM Judge System

- [ ] Create `server/services/JudgeService.ts`:
  - [ ] `buildRubricPrompt()` — construct judge prompt per perspective with system prompt, user input, response, reference criteria, and scoring instructions in JSON output format (see Section 4.7 for exact prompt template)
  - [ ] `buildPairwisePrompt()` — construct comparison prompt showing both responses (randomize order to reduce position bias), requesting JSON with winner + justification
  - [ ] `parseRubricResponse()` — 4-step fallback chain: direct JSON.parse → strip markdown fences → regex extract first `{...}` block → return null with logged raw text
  - [ ] `parsePairwiseResponse()` — similar parsing, returns `PairwiseRanking` or null
  - [ ] `buildTemplateGeneratorPrompt()` — construct prompt that analyzes a system prompt and proposes 4-6 scoring dimensions, deterministic checks, and 3-5 test cases (see Section 5 of original plan)
  - [ ] `parseTemplateGeneratorResponse()` — parse generated template JSON, return `Partial<EvalTemplate>` or null
- [ ] Update `ExecutionService` with Phase 3 (`runJudging()`):
  - [ ] For each perspective × completed cell: build rubric prompt via `JudgeService.buildRubricPrompt()`, dispatch via `LmapiClient.chatCompletion()` with the judge model
  - [ ] If pairwise enabled: generate all unique cell pairs per test case, build pairwise prompts, dispatch in parallel
  - [ ] Parse all judge responses, accumulate `JudgeResult[]` and `PairwiseRanking[]`
  - [ ] Use `Promise.allSettled()` for parallel judge dispatch; failed parses logged but don't abort
  - [ ] Emit `judge:started` and `judge:completed` WebSocket events
- [ ] Update `SummaryService.computeSummary()` to include:
  - [ ] Composite score calculation (weighted average of perspective scores per cell)
  - [ ] Per-model aggregate: average composite across all prompts × testCases × runs
  - [ ] Per-prompt aggregate: average composite across all models × testCases × runs
  - [ ] Judge result breakdown in `perspectiveScores` field
- [ ] Implement `POST /api/eval/templates/generate` route:
  - [ ] Accept `{ promptContent: string, tools?: ToolDefinition[] }`
  - [ ] Build generator prompt via `JudgeService.buildTemplateGeneratorPrompt()`
  - [ ] Dispatch to LMApi using the most capable available model (or a specified model)
  - [ ] Parse response, return proposed `EvalTemplate`
- [ ] Update `scripts/test-execution.ts` to include judge-enabled eval test case
- [ ] **Verification**: Run eval with judge enabled → `JudgeResult` records in `results.json` with scores in 1-5 range; `summary.json` has perspectiveScores populated; pairwise rankings present and consistent (winner exists in cell pair); auto-generate template returns 4-6 perspectives with weights summing to 1.0; malformed judge responses (wrap in markdown, prepend text) handled gracefully without crash

---

## Phase 4 — Export System, Baselines & History

- [ ] Create `data/evals/templates/report-template.html`:
  - [ ] Dark theme CSS matching eval palette (inline `<style>` tag)
  - [ ] `{{EVAL_NAME}}` and `{{DATA}}` template placeholders
  - [ ] Vanilla JS that renders: interactive sortable tables, heatmap matrix (CSS grid + background gradient), expandable detail sections, basic tab navigation (Scoreboard / Details / Metrics)
  - [ ] No external dependencies (no CDN links); works offline
  - [ ] Printable via `@media print` CSS
  - [ ] Target: under 500KB for a typical evaluation
- [ ] Create `server/services/ReportService.ts`:
  - [ ] `generateMarkdown(evalId)` — read `summary.json` + `results.json`, render Markdown report using template from Section 7.1 of original plan (model rankings table, prompt rankings table, regression analysis, detailed per-cell results)
  - [ ] `generateHtml(evalId)` — read report template, replace `{{DATA}}` with `JSON.stringify(summary + results)` and `{{EVAL_NAME}}` with eval name, return self-contained HTML string
  - [ ] `writeReports(evalId)` — write both `report.md` and `report.html` to the evaluation directory
- [ ] Add export endpoints to `server/routes/evaluations.ts`:
  - [ ] `GET /api/eval/evaluations/:id/export?format=html` — call `ReportService.generateHtml()`, return as `text/html` with `Content-Disposition: attachment` header
  - [ ] `GET /api/eval/evaluations/:id/export?format=md` — call `ReportService.generateMarkdown()`, return as `text/markdown` with attachment header
- [ ] Add baseline endpoint to `server/routes/evaluations.ts`:
  - [ ] `POST /api/eval/evaluations/:id/baseline` — accept `{ slug: string }`, copy `summary.json` to `data/evals/baselines/{slug}.json` with evalId reference
- [ ] Update `SummaryService` with `computeRegression()`:
  - [ ] Accept current `EvaluationSummary` + baseline `EvaluationSummary`
  - [ ] Compute delta for every metric (compositeScore, perspectiveScores, deterministicPassRate, avgLatencyMs, avgTokensPerSecond)
  - [ ] Classify each metric as `improved`, `regressed`, or `unchanged` (threshold: ±2% for scores, ±5% for latency)
  - [ ] Populate `summary.regression` field
- [ ] When `baselineId` is set on `EvaluationConfig`, load baseline in `ExecutionService.aggregate()` and call `computeRegression()`
- [ ] Add history endpoint to `server/routes/prompts.ts`:
  - [ ] `GET /api/eval/prompts/:id/history` — scan `data/evals/evaluations/` directories, read each `config.json`, filter to evals that included this promptId, read corresponding `summary.json` for scores, return sorted timeline array `[{ evalId, date, modelScores, promptScore }]`
- [ ] Add leaderboard endpoint to `server/routes/models.ts`:
  - [ ] `GET /api/eval/models/leaderboard` — scan all completed evaluations, aggregate composite scores per model across all evals, return ranked list
- [ ] Update `scripts/test-api.ts` to cover: HTML export opens standalone (contains `<script>` data block); Markdown export has expected sections; save baseline then run second eval with `baselineId` set → regression data populated in `summary.json`; history endpoint returns timeline
- [ ] **Verification**: HTML export opens in browser with no internet, all sections render with correct data; Markdown export has model rankings table, prompt rankings table, detailed results; baseline save creates file in `data/evals/baselines/`; regression delta correctly identifies improved/regressed metrics; history returns chronologically sorted evaluations for the prompt; leaderboard aggregates across evaluations

---

## Phase 5 — Frontend: Configuration & Execution

- [ ] Set up `src/index.css` with Tailwind directives and CSS custom properties for eval palette
- [ ] Set up `tailwind.config.ts` extending theme with eval colors (see Section 7.3)
- [ ] Create `src/api/eval.ts` — fetch wrapper with typed API client for all `/api/eval/*` endpoints (see Section 7.6)
- [ ] Create `src/api/lmapi.ts` — fetch wrapper for direct LMApi calls (`/api/servers`, `/api/models`)
- [ ] Create React Context for eval state (`EvalContext.tsx` + `useReducer`) — see Section 7.1 for `EvalState` shape
- [ ] Create `src/hooks/useEvalSocket.ts` — native WebSocket hook connecting to `/ws/eval`; filters by `evalId`; returns `{ progress, liveFeed, isCompleted, error }`
- [ ] Create `src/hooks/useLmapiSocket.ts` — Socket.IO client hook connecting to LMApi; returns `{ serverStatuses }` (optional, for bonus metrics)
- [ ] Create `src/hooks/useResizable.ts` — panel resize hook with mouse event handlers; returns `{ sizes, onDragStart }`
- [ ] Create `src/components/layout/ResizablePanel.tsx` — generic three-panel CSS Grid container with drag handles
- [ ] Create `src/components/layout/TopBar.tsx`:
  - [ ] Inline-editable eval name (text input that toggles on click)
  - [ ] Status indicator: animated dot (gray idle, pulsing amber running, teal completed, rose failed)
  - [ ] Matrix badge: "2P × 3M × 4T × 1R = 24 completions" — updates live from config state
  - [ ] Action buttons: "Run Evaluation" (amber primary), "Export" dropdown (HTML / Markdown), "Save as Baseline", "Load Previous"
- [ ] Create `src/components/layout/BottomBar.tsx` — cost ticker (running token total), progress summary ("Phase 2/4 — 18/24 done"), quick stats post-completion (best model, best prompt)
- [ ] Create Left Panel components:
  - [ ] `PromptTabs.tsx` — horizontal tab bar with add/remove buttons; color dot per tab
  - [ ] `PromptEditor.tsx` — monospace `<textarea>` with input mode toggle (Editor / File / Saved); saved mode fetches from `/api/eval/prompts` with version dropdown; metadata bar below (version notes input, token count estimate, "Save Version" button)
  - [ ] `ToolDefinitionEditor.tsx` — collapsible section with JSON `<textarea>`; "Validate" button runs `JSON.parse` and shows errors inline
  - [ ] `PromptDiff.tsx` — unified diff view; calls `GET /api/eval/prompts/:id/diff`; renders additions (teal bg) and deletions (rose bg)
- [ ] Create Center Panel components (config mode):
  - [ ] `ModelSelector.tsx` — fetch from `GET /api/eval/models`; grouped by server/provider with section headers; searchable text input filters; multi-select checkboxes; selected models as removable chips; "Select All Local" / "Clear" buttons
  - [ ] `TestCaseEditor.tsx` — toggle between "Quick" mode (single textarea for one user message) and "Suite" mode (table of test cases: name, message, expected tool calls, reference answer; add/remove rows; load saved suite from dropdown)
  - [ ] `TemplateSelector.tsx` — dropdown of templates from `GET /api/eval/templates`; "Auto-Generate from Prompt" button (calls `POST /api/eval/templates/generate`, shows editable preview); "Customize" button opens inline perspective editor (weights, enable/disable)
  - [ ] `JudgeConfig.tsx` — judge model selector (single select); pairwise comparison toggle; runs-per-combination number input (1-10, default 1); perspective weight sliders (sum to 1.0 with auto-rebalance)
  - [ ] `ExecutionPreview.tsx` — small grid showing prompt × model × testCase dimensions; estimated total completions, tokens, time; warning if matrix > 50 cells
- [ ] Create Center Panel components (execution mode):
  - [ ] `ProgressDashboard.tsx` — overall progress bar with percentage + ETA calculation; phase indicator (1-4)
  - [ ] `ModelProgressRow.tsx` — per-model row: model name, progress bar (done/total), average latency, tokens/sec
  - [ ] `LiveFeed.tsx` — scrolling list of completed cells as compact cards (model name, test case name, pass/fail indicator); CSS slide-in animation; click card to preview response in modal
- [ ] Transition logic: when eval starts, center panel smoothly swaps config for execution view; when complete, right panel expands
- [ ] Implement keyboard shortcuts (see Section 7.7): `Ctrl+Enter` (run), `Ctrl+E` (export), `Ctrl+1/2/3` (panel focus), `Ctrl+D` (diff), `Esc` (close modal), `Ctrl+S` (save prompt)
- [ ] **Verification**: Full browser walkthrough — load `/` → three-panel layout renders → add two prompts → select models (grouped correctly) → add test cases → select template → configure judge → execution preview shows correct matrix dimensions → click "Run" → live progress updates via WebSocket → completion feed shows slide-in cards → keyboard shortcuts work → panel resize works via drag handles

---

## Phase 6 — Frontend: Results & Analysis

- [ ] Create `src/lib/scoring.ts` — utility functions: `scoreToColor(score, min, max)` returns CSS color from heatmap gradient (teal → amber → rose); `formatScore(score)` rounds to 1 decimal; `formatLatency(ms)` to human-readable
- [ ] Create `src/components/results/Scoreboard.tsx`:
  - [ ] Default results tab view
  - [ ] `HeatmapMatrix.tsx` sub-component: CSS Grid table; rows = prompts × test cases, columns = models; each cell shows composite score (1.0-5.0) with background color from `scoreToColor()`; hover tooltip shows per-perspective breakdown; click opens DetailView for that cell
  - [ ] Model leaderboard: ranked cards with composite score, deterministic pass rate, avg latency, tokens/sec; top model gets teal border accent
  - [ ] Prompt leaderboard: same format ranking prompts by composite score
  - [ ] Regression banner (if baseline set): prominent alert showing improvements (teal up-arrows) and regressions (rose down-arrows) with delta values
- [ ] Create `src/components/results/CompareView.tsx`:
  - [ ] Two dropdown selectors to pick any two prompt × model × testCase cells
  - [ ] Left and right columns showing full response text
  - [ ] Tool calls rendered as structured cards (function name, arguments, valid/invalid badge)
  - [ ] Pairwise verdict section below: winner indicator + judge justification
  - [ ] Diff toggle button: highlights text differences between the two responses (teal additions, rose deletions)
- [ ] Create `src/components/results/DetailView.tsx`:
  - [ ] Full drill-down for a single matrix cell (selected from heatmap click or dropdown)
  - [ ] Sections: raw response (monospace, scrollable), tool calls (collapsible cards with pass/fail per call and error details), deterministic metrics table (format compliant, JSON valid, keywords, token count), per-perspective judge scores with justifications (expandable), latency/token breakdown
  - [ ] "Why Did This Fail?" button (visible if composite score < 2.5): calls `POST /api/eval/evaluations/:id/diagnose` with cell data, shows improvement suggestions in a modal
- [ ] Create `src/components/results/MetricsView.tsx`:
  - [ ] Bar charts via HTML5 Canvas: latency by model, tokens/second by model, token usage (input vs output) by model
  - [ ] Deterministic compliance table: per-cell pass/fail for each enabled check (format, JSON schema, tool calls, keywords) with color coding
  - [ ] Consistency chart (visible if runs > 1): box plot or variance chart showing score distribution per model
- [ ] Create `src/components/results/TimelineView.tsx`:
  - [ ] Line chart via HTML5 Canvas: x-axis = evaluation date, y-axis = composite score
  - [ ] One line per model (color-coded)
  - [ ] Hover to see evaluation details (tooltip with eval name, scores)
  - [ ] Markers for prompt version changes along x-axis
  - [ ] Fetches data from `GET /api/eval/prompts/:id/history`
- [ ] Create results tab navigation: five tab buttons at top of right panel; content switches with crossfade transition; no layout shift
- [ ] Wire export buttons in TopBar: "Export HTML" calls `GET /api/eval/evaluations/:id/export?format=html` and triggers download; "Export Markdown" similar
- [ ] Wire "Save as Baseline" button: prompts for slug name, calls `POST /api/eval/evaluations/:id/baseline`
- [ ] Wire "Load Previous" button: opens modal with list from `GET /api/eval/evaluations`, click loads results into right panel
- [ ] **Verification**: Complete an evaluation → Scoreboard shows heatmap with correct colors and tooltips → model/prompt leaderboards ranked correctly → Compare view shows two responses side-by-side with working diff toggle → Details view shows all metrics sections → Metrics tab renders Canvas charts with correct data → Timeline tab shows history (run 2+ evals for same prompt) → Export downloads valid HTML/Markdown files → Baseline save + regression badges work

---

## Phase 7 — Polish, Edge Cases & Documentation

- [ ] Implement "Why Did This Fail?" diagnostic endpoint:
  - [ ] `POST /api/eval/evaluations/:id/diagnose` — accepts `{ cellId: string }`
  - [ ] Constructs a diagnostic prompt: includes the original system prompt, user message, model response, judge rubric + score, and asks for specific improvement suggestions
  - [ ] Dispatches to LMApi via `LmapiClient.chatCompletion()`
  - [ ] Returns improvement suggestions as structured text
- [ ] Confirm retry resilience from Phase 2 (see [`../../features/retry-resilience/RETRY_RESILIENCE.md`](../../features/retry-resilience/RETRY_RESILIENCE.md)) — retry is in `LmapiClient` and covers judge calls as well as cell completions; no additional `ExecutionService`-level retry needed
- [ ] Handle partial evaluation failures:
  - [ ] Cells that fail after all retries: `status: 'failed'` in `EvalMatrixCell`; `errorType` and `retryAttempts` populated; eval continues
  - [ ] `summary.json` notes `failedCells` count and which models/test cases were affected
  - [ ] Frontend shows failed cells in heatmap with rose border + ⚠ icon; clicking opens failure detail panel (see below)
- [ ] Add `groupId` tagging: set `groupId: evalId` on all LMApi requests so eval traffic can be filtered in LMApi's prompt history dashboard
- [ ] Accessibility pass:
  - [ ] `aria-label` on all interactive controls (buttons, selects, tabs)
  - [ ] Keyboard navigation through model selector list and test case table
  - [ ] Focus management on tab switches (focus first element in new tab content)
  - [ ] High contrast mode: ensure all text meets WCAG AA contrast ratio against dark backgrounds
  - [ ] Screen reader: heatmap cells announce score and model/test case context
- [ ] Responsive layout:
  - [ ] Below 1024px width: panels stack vertically (prompt → config → results)
  - [ ] Panel collapse buttons work at all breakpoints
  - [ ] Mobile: single-panel view with tab navigation between panels
- [ ] Error boundary: React error boundary wrapping each panel so one panel crash doesn't take down the whole page
- [ ] Loading states: skeleton loaders for model list, template list, results panels
- [ ] Create project `README.md`:
  - [ ] Overview and purpose
  - [ ] Prerequisites: Node.js/Bun, running LMApi instance
  - [ ] Setup instructions: clone, install, configure `.env`, seed templates
  - [ ] Running: `bun run dev:server` + `bun run dev:client`
  - [ ] Usage walkthrough: create prompt → configure eval → run → analyze results → export
  - [ ] Architecture overview (standalone project consuming LMApi)
  - [ ] All API endpoints table (`/api/eval/*`)
  - [ ] Built-in template descriptions
  - [ ] Data storage layout (`data/evals/` directory tree)
  - [ ] Export formats (HTML standalone, Markdown)
  - [ ] Keyboard shortcuts table
  - [ ] Configuration reference (`.env` variables)
- [ ] Add failure detail panel to results UI (see [`../../features/retry-resilience/RETRY_RESILIENCE.md`](../../features/retry-resilience/RETRY_RESILIENCE.md)):
  - [ ] Clicking a failed cell opens a detail panel: error type, retry history (attempt number + timestamp + error message), full raw model response (monospace scrollable), partial tool calls attempted, judge's `rawJudgeResponse` (if applicable), deterministic check breakdown
  - [ ] Add `rawJudgeResponse?: string` field to `JudgeResult` in `src/types/eval.ts` (stored by JudgeService parse fallback chain)
  - [ ] "↻ Retry this cell" button in the failure detail panel — calls `POST /api/eval/evaluations/:id/retry` with `{ failedCellsOnly: true }`
- [ ] Add eval run selector to results panel (when session has multiple runs): run tab bar showing run number + completion status; clicking a tab loads that run's results
- [ ] Add real-time timing display to execution progress UI: start time (from `EvalRun.createdAt`), live `HH:MM:SS` elapsed counter (updates every second, no WebSocket needed — frontend timer), end time on completion, running token total accumulating from `cell:completed` WS events, per-model token totals
- [ ] **Verification**: Force cell failure (use nonexistent model) → eval completes with partial results; failed cells shown with rose + ⚠; clicking opens failure detail panel with retry history and raw response; "Retry" creates new eval scoped to failed cells; "Why Did This Fail?" returns suggestions for low-scoring cell; real-time timer increments correctly; run selector shows multiple runs when available; screen reader navigates eval page successfully; responsive layout works at mobile widths; README is complete and accurate

---

## Phase 8 — Automated Refinement Loop

> Prerequisite: Phases 2–7 complete (sessions, evals, judge, git all working).
>
> Spec: [`../../features/automated-refinement/AUTOMATED_REFINEMENT.md`](../../features/automated-refinement/AUTOMATED_REFINEMENT.md)
>
> Phase 8a implements human-in-the-loop suggestions. Phase 8b implements the automated overnight loop.

**Environment Configuration:**
- [ ] Add `REFINEMENT_MODEL` to `.example.env` — model used for improvement suggestions (e.g. `qwen3:32b`); suggestions endpoint returns 400 if not set
- [ ] Expose `REFINEMENT_MODEL` config in `GET /api/eval/health` so the frontend can gate the "Suggest Improvements" button

**Phase 8a — Human-in-the-Loop:**
- [ ] Add `ImprovementSuggestion` and `RefinementLoopConfig` types to `src/types/session.ts`
- [ ] Create `server/services/RefinementService.ts`:
  - [ ] `buildImprovementPrompt(session, activeVersion, promptContent, evalResults, template)` — constructs feedback prompt including eval template, current prompt, top failing cells with full context (raw response, `rawJudgeResponse`, `retryAttempts`, deterministic check failures), and scoring summary; requests JSON array of `ImprovementSuggestion`
  - [ ] `parseSuggestions(rawResponse)` — 4-step fallback parse chain (same pattern as `JudgeService`); returns `ImprovementSuggestion[]` or null with logged raw text
  - [ ] `applySuggestion(sessionId, suggestion, description?)` — calls `PromptService.addVersion()` then `SessionService.createVersion()` with updated slot; returns `{ promptManifest, sessionVersion }`
  - [ ] `buildEvalImprovementPrompt()` and `parseEvalSuggestions()` — Phase 8c, lower priority
- [ ] Create `POST /api/eval/sessions/:id/suggest-improvements` route — loads eval run results + template; calls `RefinementService.buildImprovementPrompt()`; dispatches via `LmapiClient` using `REFINEMENT_MODEL`; returns `ImprovementSuggestion[]`
- [ ] Create `POST /api/eval/sessions/:id/apply-suggestion` route — calls `RefinementService.applySuggestion()`; returns `{ promptManifest, sessionVersion }`
- [ ] Create `GET /api/eval/sessions/:id/suggestions` route — returns stored suggestions for the session
- [ ] Frontend — "Suggest Improvements" button in results panel (only shown when `REFINEMENT_MODEL` configured and eval is complete): calls suggest endpoint; renders suggestion cards with `rationale`, `estimatedImpact`, and "Show diff" / "Apply" / "Reject" buttons; diff view uses same `diff` library as `PromptDiff` component
- [ ] Frontend — "Apply" handler: calls apply endpoint; updates prompt panel content; creates new session version; shows toast "New session version created — run eval to compare"
- [ ] **Verification (Phase 8a)**: Complete eval with failures → "Suggest Improvements" returns 1-3 suggestions with non-empty `rationale` and `revisedContent`; "Apply" creates new prompt version + new session version; "Reject" shows rejected state; `REFINEMENT_MODEL` not set → 400 error with clear message

**Phase 8b — Automated Loop (deferred):**
- [ ] Create `POST /api/eval/sessions/:id/refine-loop` route — accepts `RefinementLoopConfig`; starts background loop (suggest → apply → eval) with configurable stop conditions; streams `refine:*` WebSocket events; returns 202 `{ loopId }`
- [ ] Implement stop conditions in loop: target score delta reached, max iterations, 3 consecutive no-improvement iterations, no parseable suggestions, user cancel
- [ ] Add `DELETE /api/eval/sessions/:id/refine-loop/:loopId` cancel endpoint
- [ ] Auto-commit successful iterations if `autoCommit: true` via `GitService.commit()`; auto-revert regressions via `GitService.revert()`
- [ ] Write `loopSummary` to session run record on completion: iterations count, final delta, stop reason, commits/reverts made
- [ ] Frontend — refinement loop progress UI: iteration counter, current action label, live score trajectory chart, "Cancel Loop" button
- [ ] **Verification (Phase 8b)**: Run loop with `maxIterations: 3` → 3 iterations complete; WebSocket events arrive in order; `autoCommit: true` → git log shows `feat(prompt):` commits for improvements; regression → revert commit in git log; cancel mid-loop → stops cleanly after current iteration

**Phase 8c — Eval Definition Improvement (lower priority, deferred):**
- [ ] `RefinementService.buildEvalImprovementPrompt()` and `parseEvalSuggestions()` — analyze failures to propose new test cases, adjusted perspective weights, refined criteria
- [ ] `POST /api/eval/sessions/:id/suggest-eval-improvements` route
- [ ] Frontend — separate "Improve Evals" suggestion flow, reviewed before applying to template
