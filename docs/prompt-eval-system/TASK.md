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
- [x] Create `src/components/layout/Header.tsx` — flex row: LMEval logo (accent + JetBrains Mono) | `<select>` with `<optgroup>` per server | Run button (disabled when loading/no model) + status indicator
- [x] Create `src/components/prompt/ResponseView.tsx` — imports `highlight.js/styles/atom-one-dark.css`, registers `markdown`/`json`/`xml`/`yaml` languages, uses `hljs.highlightAuto()` + `dangerouslySetInnerHTML`; handles idle/loading (skeleton)/error/done states
- [x] Create `src/components/prompt/PromptPanel.tsx` — `label` + `<textarea>` (editor mode) or `<ResponseView>` (response mode); flex column filling grid cell
- [x] Replace `src/App.tsx` — `PromptState` tuple, `userMessage`, `selectedModel` state; `handleRun` with `Promise.allSettled`; auto-select first model on load; 4-section layout JSX
- [x] **Verification**: `bun run dev` → both prompt editors side by side with dark theme → model selector populated from LMApi → enter two prompts + user message → Run → responses appear with syntax highlighting → `lmapi.duration_ms` shown per response → error state shown on failure

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
- [x] Create `src/types/session.ts` — `SessionSlot`, `SessionVersionMeta`, `SessionVersion`, `SessionManifest`, `EvalRun`, `ImprovementSuggestion` interfaces (see `SESSION_MANAGEMENT.md` for full type definitions)
- [x] Add `SESSIONS_DIR = join(process.cwd(), 'data', 'sessions')` constant to `server/services/FileService.ts`
- [x] Create `data/sessions/.gitkeep` to track the directory in git
- [x] Create `server/services/SessionService.ts` — `list`, `get`, `getBySlug`, `getVersion`, `getActiveVersion`, `create`, `createVersion`, `setLatestVersion`, `addEvalRun`, `getEvalRun`, `listEvalRuns`, `updateEvalRun`, `delete`
- [x] Create `server/routes/sessions.ts` — `GET` list, `GET` by id, `GET` active version, `GET` version by number, `POST` create, `POST` add version, `PUT` latest pointer, `GET` runs, `POST` add run, `PATCH` update run, `DELETE`
- [x] Wire `sessionsRouter` into `server/index.ts` at `/api/eval/sessions`
- [x] Create `scripts/test-sessions.ts` — integration test: create session with two valid prompt slots → add second version (swap B to A, new B) → list shows both versions → add eval run → update run status → delete session
- [x] Add `"test:sessions": "bun run scripts/test-sessions.ts"` to `package.json`
- [x] **Verification**: `bun run test:sessions` passes; `data/sessions/{slug}/manifest.json` created with correct shape; `v1.json` and `v2.json` present after version creation; run record written to `runs/{runId}.json`; `latestVersion` pointer updated correctly

**Prompt Upload Frontend:**
- [x] Create `src/api/eval.ts` (pull forward from Phase 5) with `createPrompt(name, content)` and `addPromptVersion(id, content, description?)` fetch wrappers targeting `/api/eval/prompts`
- [x] Update `src/components/prompt/PromptPanel.tsx` — add `onFileUpload`, `uploadStatus`, `uploadError` props; add `isDragOver` state; add `onDragOver`/`onDragLeave`/`onDrop` handlers; add "Browse" button with hidden `<input type="file" accept=".txt,.md">`; add upload status strip below textarea; add drag highlight class when `isDragOver`
- [x] Add CSS classes to `src/App.css`: `.prompt-panel--dragging` (border + glow), `.upload-hint`, `.upload-browse`, `.upload-progress`, `.upload-progress--reading/saving/saved/error`
- [x] Update `src/App.tsx` — add `promptManifests: [PromptManifest | null, PromptManifest | null]` state; add `uploadStatus` state; add `activeSessionId` state (persisted in `localStorage`); implement `handleFileUpload(side, content, fileName)` calling `createPrompt` or `addPromptVersion`; pass `onFileUpload` to both editor PromptPanel instances
- [x] **Verification**: Drag a `.md` file onto Prompt A panel → textarea populates immediately → status shows "Saving…" then "Saved" → `POST /api/eval/prompts` fires → manifest stored; drag second file → `POST /api/eval/prompts/:id/versions` fires; Browse button opens picker with same behavior; unsupported type shows inline error

**Prompt Version Advancement (B → A):**
- [x] Add `onAdvance` prop to `PromptPanel` — renders "Use as Prompt A →" button in the B panel header when panel has content; absent from A panel
- [x] Implement `handleAdvance()` in `App.tsx`: copy `prompts[1]` content → `prompts[0]`; clear `prompts[1]`; copy `promptManifests[1]` → `promptManifests[0]`; clear `promptManifests[1]`; if `activeSessionId` is set, call `POST /api/eval/sessions/:id/versions` with new slot data
- [x] **Verification**: Type into Prompt B → click "Use as Prompt A →" → content moves to A, B clears → session gains new version in `data/sessions/` → refreshing the page re-connects to active session via `localStorage`

---

## Phase 2 — Evaluation Engine: Execution Pipeline (No Judge)

- [x] Create `server/services/MetricsService.ts` — `validateJsonSchema()` using ajv (singleton, `allErrors: true`); `validateToolCalls()` against definitions + expected calls; `checkKeywords()` for required/forbidden; `estimateTokenCount()` (see Section 4.6)
- [x] Create `server/services/SummaryService.ts` — `computeSummary()` with per-model and per-prompt aggregate rankings using deterministic metrics only; `computeConsistency()` for multi-run variance (see Section 4.9)
- [x] Create `server/services/ExecutionService.ts` — 3 of 4 phases:
  - [x] Phase 1: `buildMatrix()` — expand all prompt × model × testCase × run combinations into `EvalMatrixCell[]`; `estimateCost()` for token/time estimates
  - [x] Phase 2: `runCompletions()` — dispatch each cell via `LmapiClient.chatCompletion()` with `stream: false` and `groupId: evalId`; run deterministic checks via `MetricsService` on each completed cell; use `Promise.allSettled()` for parallel dispatch; implement `Semaphore` class for batching (default limit: 8 concurrent)
  - [x] Phase 4: `aggregate()` — call `SummaryService.computeSummary()`, write `results.json` + `summary.json`
  - [x] `AbortController` map for cancel support; `cancel(evalId)` method
  - [x] Write `config.json` with `status: 'pending' → 'running' → 'completed'/'failed'`
- [x] Create `server/ws.ts` — Bun native WebSocket server at `/ws/eval`; broadcast `EvalStreamEvent` messages to all connected clients; track connected clients
- [x] Emit WebSocket events during execution: `cell:started`, `cell:completed`, `cell:failed`, `eval:progress`, `eval:completed`, `eval:failed`
- [x] Create `server/routes/evaluations.ts`:
  - [x] `GET /api/eval/evaluations` — list evaluations with optional status/promptId/modelId filters
  - [x] `GET /api/eval/evaluations/:id` — read and return `config.json`
  - [x] `GET /api/eval/evaluations/:id/results` — read and return `results.json`
  - [x] `GET /api/eval/evaluations/:id/summary` — read and return `summary.json`
  - [x] `POST /api/eval/evaluations` — validate config, write `config.json`, call `ExecutionService.run(id)` async (do not await), return 202 with config
  - [x] `DELETE /api/eval/evaluations/:id` — call `ExecutionService.cancel(id)`, return success/failure
- [x] Add retry resilience to `server/services/LmapiClient.ts` (see [`../../features/retry-resilience/RETRY_RESILIENCE.md`](../../features/retry-resilience/RETRY_RESILIENCE.md)):
  - [x] Read `LMAPI_RETRY_COUNT` (default 3) and `LMAPI_RETRY_DELAY_MS` (default 2000) from environment
  - [x] Wrap `chatCompletion()` with `withRetry()` helper — linear backoff (attempt × delay); retry on 429/502/503/504 and network errors; throw immediately on 4xx client errors
  - [x] Add `retryAttempts?: { attemptNumber, error, timestamp }[]` and `errorType?` fields to `EvalMatrixCell` in `src/types/eval.ts`
  - [x] `ExecutionService` populates `retryAttempts` on each failed attempt before final failure
  - [x] Add `LMAPI_RETRY_COUNT` and `LMAPI_RETRY_DELAY_MS` to `.example.env`
- [x] Add session linking to evaluation runs (see [`../../features/session-management/SESSION_MANAGEMENT.md`](../../features/session-management/SESSION_MANAGEMENT.md)):
  - [x] `POST /api/eval/evaluations` accepts optional `{ sessionId, sessionVersion }` in request body
  - [x] If `sessionId` provided: call `SessionService.addEvalRun(sessionId, sessionVersion, evalId)` after writing `config.json`; return `evalRunId` in the 202 response
  - [x] `ExecutionService.aggregate()`: after writing `summary.json`, call `SessionService.updateEvalRun()` with `{ status: 'completed', completedAt, scoreSummary }` (extract `promptAScore`/`promptBScore` from `EvaluationSummary.promptSummaries`)
  - [x] On eval failure: call `SessionService.updateEvalRun()` with `{ status: 'failed' }`
- [x] Add eval re-run endpoint:
  - [x] `POST /api/eval/evaluations/:id/retry` — read original `config.json`; if `failedCellsOnly: true`, filter to failed cells; write new eval ID; call `ExecutionService.run(newEvalId)` async; if `sessionId` provided, link new run to session; return 202 `{ evalId, evalRunId? }`
- [x] Create `scripts/test-execution.ts` — end-to-end test: connect WebSocket, create minimal eval (1 prompt × 1 model × 1 test case, no judge), listen for `eval:completed`, verify `results.json` structure (cells have response content + deterministic metrics), verify `summary.json` (model rankings populated)
- [x] Add `"test:execution": "bun run scripts/test-execution.ts"` to `package.json`
- [x] **Verification**: `bun run test:execution` — eval completes; `config.json` status transitions to `completed`; all matrix cells present in `results.json` with populated metrics (inputTokens, outputTokens, durationMs, tokensPerSecond, serverName); `summary.json` has model rankings; WebSocket events arrive in correct sequence (cell:started → cell:completed → eval:progress → eval:completed); cancel mid-run stops execution cleanly; eval with `sessionId` creates `EvalRun` record and populates `scoreSummary` after completion; simulate 503 response → retry fires and cell eventually completes

---

## Phase 2.5 — Git Integration for Prompt Versioning

> Prerequisite: Phase 2 complete (sessions + eval runs exist to commit).
>
> Spec: [`../../features/git-integration/GIT_INTEGRATION.md`](../../features/git-integration/GIT_INTEGRATION.md)
>
> Scope: Human-confirmed git commits on the `data/` directory. Automated commits come later in Phase 8.

- [x] Create `server/services/GitService.ts` — `isInitialized()`, `init()`, `status()`, `commit(message)`, `log(limit?)`, `revert(hash)`; all git calls use `child_process.execFile` (not `exec`) with args as string array to prevent shell injection; `DATA_ROOT = join(process.cwd(), 'data')`
- [x] Create `server/routes/git.ts` — `GET /status` (initialized + status + last 10 log entries), `POST /init` (idempotent), `POST /commit` (validates message matches `/^(feat|fix|chore)\(prompt\):/`; links to session run if `sessionId`+`runId` provided), `POST /revert` (validates hash is alphanumeric only), `GET /log?limit=N`
- [x] Wire `gitRouter` into `server/index.ts` at `/api/eval/git`; log warning on startup if `data/` is not a git repo
- [x] On `POST /api/eval/git/init`, also write `data/.gitignore` with `*.tmp` exclusion
- [x] Add `.gitignore` note to root `.gitignore`: add `data/.git/` to prevent nested repo detection
- [ ] Frontend — add "Commit Improvement" button in results area (visible after eval completes with positive `scoreDelta`): pre-fills `feat(prompt): improve {session.name} (+{delta} score)`; editable before submit; shows commit hash on success; button becomes disabled "Committed ✓" after commit
- [ ] Frontend — add "Revert to Previous" button (visible when log has ≥ 1 commit): shows last commit subject + date; confirmation dialog before calling `POST /api/eval/git/revert`; toast on success
- [ ] **Verification**: `POST /api/eval/git/init` → `data/.git/` created; create prompt + session + eval → commit → `GET /api/eval/git/log` returns entry with correct hash/subject/date; `POST /commit` with invalid message → 400; `POST /revert` → changes undone; UI buttons pre-fill correct message and show hash

---

## Phase 3 — Export System, Baselines & History

- [x] Create `data/evals/templates/report-template.html`:
  - [x] Dark theme CSS matching eval palette (inline `<style>` tag)
  - [x] `{{EVAL_NAME}}` and `{{DATA}}` template placeholders
  - [x] Vanilla JS that renders: interactive sortable tables, heatmap matrix (CSS grid + background gradient), expandable detail sections, basic tab navigation (Scoreboard / Details / Metrics)
  - [x] No external dependencies (no CDN links); works offline
  - [x] Printable via `@media print` CSS
  - [x] Target: under 500KB for a typical evaluation
- [x] Create `server/services/ReportService.ts`:
  - [x] `generateMarkdown(evalId)` — read `summary.json` + `results.json`, render Markdown report using template from Section 7.1 of original plan (model rankings table, prompt rankings table, regression analysis, detailed per-cell results)
  - [x] `generateHtml(evalId)` — read report template, replace `{{DATA}}` with `JSON.stringify(summary + results)` and `{{EVAL_NAME}}` with eval name, return self-contained HTML string
  - [x] `writeReports(evalId)` — write both `report.md` and `report.html` to the evaluation directory
- [x] Add export endpoints to `server/routes/evaluations.ts`:
  - [x] `GET /api/eval/evaluations/:id/export?format=html` — call `ReportService.generateHtml()`, return as `text/html` with `Content-Disposition: attachment` header
  - [x] `GET /api/eval/evaluations/:id/export?format=md` — call `ReportService.generateMarkdown()`, return as `text/markdown` with attachment header
- [x] Add baseline endpoint to `server/routes/evaluations.ts`:
  - [x] `POST /api/eval/evaluations/:id/baseline` — accept `{ slug: string }`, copy `summary.json` to `data/evals/baselines/{slug}.json` with evalId reference
- [x] Update `SummaryService` with `computeRegression()`:
  - [x] Accept current `EvaluationSummary` + baseline `EvaluationSummary`
  - [x] Compute delta for every metric (compositeScore, perspectiveScores, deterministicPassRate, avgLatencyMs, avgTokensPerSecond)
  - [x] Classify each metric as `improved`, `regressed`, or `unchanged` (threshold: ±2% for scores, ±5% for latency)
  - [x] Populate `summary.regression` field
- [x] When `baselineId` is set on `EvaluationConfig`, load baseline in `ExecutionService.aggregate()` and call `computeRegression()`
- [x] Add history endpoint to `server/routes/prompts.ts`:
  - [x] `GET /api/eval/prompts/:id/history` — scan `data/evals/evaluations/` directories, read each `config.json`, filter to evals that included this promptId, read corresponding `summary.json` for scores, return sorted timeline array `[{ evalId, date, modelScores, promptScore }]`
- [x] Add leaderboard endpoint to `server/routes/models.ts`:
  - [x] `GET /api/eval/models/leaderboard` — scan all completed evaluations, aggregate composite scores per model across all evals, return ranked list
- [x] Update `scripts/test-api.ts` to cover: HTML export opens standalone (contains `<script>` data block); Markdown export has expected sections; save baseline then run second eval with `baselineId` set → regression data populated in `summary.json`; history endpoint returns timeline
- [x] **Verification**: HTML export opens in browser with no internet, all sections render with correct data; Markdown export has model rankings table, prompt rankings table, detailed results; baseline save creates file in `data/evals/baselines/`; regression delta correctly identifies improved/regressed metrics; history returns chronologically sorted evaluations for the prompt; leaderboard aggregates across evaluations

---

## Phase 4 — LLM Judge System

- [x] Create `server/services/JudgeService.ts`:
  - [x] `buildRubricPrompt()` — construct judge prompt per perspective with system prompt, user input, response, reference criteria, and scoring instructions in JSON output format (see Section 4.7 for exact prompt template)
  - [x] `buildPairwisePrompt()` — construct comparison prompt showing both responses (randomize order to reduce position bias), requesting JSON with winner + justification
  - [x] `parseRubricResponse()` — 4-step fallback chain: direct JSON.parse → strip markdown fences → regex extract first `{...}` block → return null with logged raw text
  - [x] `parsePairwiseResponse()` — similar parsing, returns `PairwiseRanking` or null
  - [x] `buildTemplateGeneratorPrompt()` — construct prompt that analyzes a system prompt and proposes 4-6 scoring dimensions, deterministic checks, and 3-5 test cases (see Section 5 of original plan)
  - [x] `parseTemplateGeneratorResponse()` — parse generated template JSON, return `Partial<EvalTemplate>` or null
- [x] Update `ExecutionService` with Phase 3 (`runJudging()`):
  - [x] For each perspective × completed cell: build rubric prompt via `JudgeService.buildRubricPrompt()`, dispatch via `LmapiClient.chatCompletion()` with the judge model
  - [x] If pairwise enabled: generate all unique cell pairs per test case, build pairwise prompts, dispatch in parallel
  - [x] Parse all judge responses, accumulate `JudgeResult[]` and `PairwiseRanking[]`
  - [x] Use `Promise.allSettled()` for parallel judge dispatch; failed parses logged but don't abort
  - [x] Emit `judge:started` and `judge:completed` WebSocket events
- [x] Update `SummaryService.computeSummary()` to include:
  - [x] Composite score calculation (weighted average of perspective scores per cell)
  - [x] Per-model aggregate: average composite across all prompts × testCases × runs
  - [x] Per-prompt aggregate: average composite across all models × testCases × runs
  - [x] Judge result breakdown in `perspectiveScores` field
- [x] Implement `POST /api/eval/templates/generate` route:
  - [x] Accept `{ promptContent: string, tools?: ToolDefinition[] }`
  - [x] Build generator prompt via `JudgeService.buildTemplateGeneratorPrompt()`
  - [x] Dispatch to LMApi using the most capable available model (or a specified model)
  - [x] Parse response, return proposed `EvalTemplate`
- [x] Update `scripts/test-execution.ts` to include judge-enabled eval test case
- [x] **Verification**: Run eval with judge enabled → `JudgeResult` records in `results.json` with scores in 1-5 range; `summary.json` has perspectiveScores populated; pairwise rankings present and consistent (winner exists in cell pair); auto-generate template returns 4-6 perspectives with weights summing to 1.0; malformed judge responses (wrap in markdown, prepend text) handled gracefully without crash

---

## Phase 5 — Frontend: Configuration & Execution

- [x] Set up `src/index.css` with CSS custom properties for eval palette (diff colors, heatmap gradient, step indicator, progress bar, card bg)
- [x] Create `src/api/eval.ts` — fetch wrapper with typed API client for all `/api/eval/*` endpoints (prompts, templates, test suites, sessions, evaluations, presets, export, baseline)
- [x] Create React Context for eval state (`EvalWizardContext.tsx` + `useReducer`) — wizard state with localStorage persistence; actions: `SET_PROMPT_A/B`, `SET_MODELS`, `SET_CONFIG`, `START_EVAL`, `LOAD_PRESET`, `RESET`, `SET_STEP`
- [x] Create `WebSocketContext.tsx` — shared WS connection management with exponential backoff reconnect
- [x] Create `src/hooks/useEvalSocket.ts` — native WebSocket hook connecting to `/ws/eval`; filters by `evalId`; returns `{ progress, events, isCompleted, status }`
- [x] Create `src/layouts/EvalLayout.tsx` — shared layout: persistent header + `EvalStepIndicator` + `<Outlet />`; wraps children in `EvalWizardProvider`
- [x] Create `src/components/layout/EvalStepIndicator.tsx` — horizontal 5-step bar; active/complete/pending states; click to navigate; "Coming Soon" badge on Step 5
- [x] Move current `App.tsx` content to `ComparePage.tsx` at `/compare`
- [x] Create `SessionHubPage.tsx` at `/` — grid of session cards, "New Evaluation" + "Quick Compare" buttons, empty state with hero message, feature highlight cards
- [x] Create `PromptsPage.tsx` — Step 1: dual PromptPanel + PromptVersionSelector + collapsible PromptDiffView + ModelSelector + "Next" button
- [x] Create `ConfigPage.tsx` — Step 2: TemplateSelector + TestCaseEditor + JudgeConfig + ExecutionPreview + PresetSelector + "Run Evaluation" button
- [x] Create `DashboardPage.tsx` — Step 3: ElapsedTimer + ProgressOverview + ModelProgressGrid + LiveFeed + "View Results →" on completion
- [x] Create `ResultsPage.tsx` — Step 4: 5-tab navigation (Scoreboard | Compare | Detail | Metrics | Timeline) + export/baseline buttons
- [x] Create `SummaryPage.tsx` — Step 5 placeholder (deferred to Phase 9 per spec)
- [x] Update `src/main.tsx` with BrowserRouter and full route tree
- [x] Update `vite.config.ts` — add `historyApiFallback: true` for SPA routing
- [x] Create Left Panel components:
  - [x] `PromptVersionSelector.tsx` — version dropdown to load saved prompts from `/api/eval/prompts`
  - [x] `PromptDiffView.tsx` — side-by-side JetBrains-style diff using `diffLines` + `diffWords`; gutter line numbers; word-level inline highlights; CSS classes `.diff-added`, `.diff-removed`, `.diff-word-added`, `.diff-word-removed`
- [x] Create Center Panel components (config mode):
  - [x] `ModelSelector.tsx` — (reused existing) searchable multi-select with server grouping
  - [x] `TestCaseEditor.tsx` — toggle between "Quick" mode (single textarea) and "Suite" mode (table with add/remove rows; load from dropdown)
  - [x] `TemplateSelector.tsx` — dropdown of templates; "Auto-Generate from Prompt" button; inline perspective editor
  - [x] `JudgeConfig.tsx` — judge model selector; pairwise comparison toggle; runs-per-cell number input (1-10)
  - [x] `ExecutionPreview.tsx` — matrix badge (`2P × 3M × 4T × 1R = 24 completions`); warning if matrix > 50 cells
  - [x] `PresetSelector.tsx` — "Save as Preset" + "Load Preset" dropdown
- [x] Create Center Panel components (execution mode):
  - [x] `ElapsedTimer.tsx` — frontend-driven HH:MM:SS clock (updates every second)
  - [x] `ProgressOverview.tsx` — overall progress bar with percentage + phase indicator
  - [x] `ModelProgressGrid.tsx` — per-model progress cards grouped by server name
  - [x] `LiveFeed.tsx` — scrolling list of completed cells with CSS slide-in animation; click to preview in modal
- [x] Backend: Add `EvalPreset` type to `src/types/eval.ts`
- [x] Backend: Create `data/evals/presets/` directory
- [x] Backend: Create `server/services/PresetService.ts` — list/get/create/update/delete
- [x] Backend: Create `server/routes/presets.ts` — CRUD at `/api/eval/presets`
- [x] Backend: Wire presets router into `server/index.ts`
- [x] Backend: Replace `server/ws.ts` stub with real WebSocket server (`ws` npm package)
- [x] Install `react-router-dom`, `recharts`, `lucide-react` dependencies
- [x] **Verification**: Full browser walkthrough — load `/` → Session Hub with hero + CTAs → "New Evaluation" → Step 1 loads with dual prompt editors + collapsible diff + model selector → Step 2 has template/test/judge/preview config → "Run" navigates to live dashboard → progress updates → "View Results" navigates to results with 5 tabs

---

## Phase 6 — Frontend: Results & Analysis

- [x] Create `src/lib/scoring.ts` — utility functions: `scoreToColor(score, min, max)` returns CSS hex color interpolated from heatmap gradient (rose → amber → teal); `formatScore(score)` rounds to 1 decimal; `formatLatency(ms)` to human-readable
- [x] Create `src/components/results/Scoreboard.tsx`:
  - [x] Default results tab view — wraps HeatmapMatrix + model leaderboard + prompt leaderboard + RegressionBanner
  - [x] `HeatmapMatrix.tsx` sub-component: CSS Grid table; rows = prompts × test cases, columns = models; each cell shows composite score (1.0-5.0) with background color from `scoreToColor()`; hover tooltip shows per-perspective breakdown; click opens DetailView for that cell
  - [x] Model leaderboard: ranked cards with composite score, deterministic pass rate, avg latency, tokens/sec; top model gets teal border accent
  - [x] Prompt leaderboard: same format ranking prompts by composite score
  - [x] Regression banner (if baseline set): prominent alert showing improvements (teal up-arrows) and regressions (rose down-arrows) with delta values
- [x] Create `src/components/results/CompareView.tsx`:
  - [x] Two dropdown selectors to pick any two prompt × model × testCase cells
  - [x] Left and right columns showing full response text
  - [x] Pairwise verdict section below: winner indicator + judge justification
  - [x] Diff toggle button: highlights text differences between the two responses
- [x] Create `src/components/results/DetailView.tsx`:
  - [x] Full drill-down for a single matrix cell (selected from heatmap click or dropdown)
  - [x] Sections: raw response (monospace, scrollable), tool calls (collapsible cards with pass/fail), deterministic metrics table, per-perspective judge scores with justifications (expandable), latency/token breakdown
- [x] Create `src/components/results/MetricsView.tsx`:
  - [x] Recharts `BarChart`: latency by model, tokens/second by model, token usage (input vs output) by model
  - [x] Deterministic compliance table: per-cell pass/fail for each enabled check
- [x] Create `src/components/results/TimelineView.tsx`:
  - [x] Recharts `LineChart`: x-axis = evaluation date, y-axis = composite score
  - [x] One line per model (color-coded); hover tooltips
  - [x] Fetches data from `GET /api/eval/prompts/:id/history`
- [x] Create `src/components/results/RegressionBanner.tsx` — improvement/regression alerts with delta values
- [x] Create results tab navigation in `ResultsPage.tsx`: five tab buttons (Scoreboard | Compare | Detail | Metrics | Timeline); content switches with active tab state
- [x] Wire export buttons in `ResultsPage.tsx`: "Export HTML" calls `GET /api/eval/evaluations/:id/export?format=html` and triggers download; "Export Markdown" similar
- [x] Wire "Save as Baseline" button: prompts for slug name, calls `POST /api/eval/evaluations/:id/baseline`
- [x] Add "View Summary & Suggestions →" button on `ResultsPage.tsx` (navigates to placeholder `/eval/summary/:id` until Phase 9)
- [x] **Verification**: Complete an evaluation → Scoreboard shows heatmap with correct colors and tooltips → model/prompt leaderboards ranked correctly → Compare view shows two responses side-by-side with working diff toggle → Details view shows all metrics sections → Metrics tab renders Recharts bar charts with correct data → Timeline tab shows history → Export downloads valid HTML/Markdown files → Baseline save works

---

## Phase 6.5 — Run Dashboard Bug Fixes & Redesign

> Prerequisite: Phase 5 & 6 complete.
>
> Spec: [`../../features/eval-wizard/RUN_DASHBOARD_REDESIGN.md`](../../features/eval-wizard/RUN_DASHBOARD_REDESIGN.md)
>
> The current Step 3 (`/eval/run/:id`) execution dashboard has critical bugs that prevent prompts from being sent to Ollama, and a very sparse UX that provides almost no feedback about what is happening.

**Bug Fixes (backend):**
- [x] Fix `LmapiClient` endpoint for eval execution — add `chatCompletionOnServer(req, serverName)` method that calls `/api/chat/completions/server` (matches the working Compare view pattern); split `cell.modelId` ("serverName::modelName") in `ExecutionService.runCompletions()` before calling LMApi
- [x] Accept `inlineTestCases` in `POST /api/eval/evaluations` request body; persist them in `config.json`; load them in `ExecutionService.run()` alongside `testSuiteId` and `userMessage`; add `inlineTestCases?: TestCase[]` to `EvaluationConfig` type
- [x] `cell:failed` event already includes error details — frontend now handles the `{ cellId, error }` payload correctly; error surfaced in ErrorPanel

**Bug Fixes (frontend):**
- [x] `ConfigPage.handleRun()` — before calling `createEvaluation()`, auto-save any prompt slot that has content but `id === null` via `createPrompt()`; dispatch `SET_PROMPT_A/B` with returned manifest before proceeding
- [x] `ConfigPage.handleRun()` — pass `inlineTestCases: state.inlineTestCases` to `createEvaluation()`
- [x] `EvaluationConfig` type in `src/types/eval.ts` now includes `inlineTestCases?: TestCase[]` — `createEvaluation()` API call automatically includes it
- [x] `useEvalSocket.ts` — reduce reconnect backoff: initial delay 500 ms, max 5 s (was 1 s initial doubling to 30 s)
- [x] `DashboardPage.tsx` — on mount, `GET /api/eval/evaluations/:id` to check current status; if already `completed` or `failed`, load results from REST rather than waiting for WS events; `getEvaluation(id)` already existed in `src/api/eval.ts`
- [x] Handle `cell:failed` event data correctly — the payload is `{ cellId, error }` not a full `EvalMatrixCell`; fixed the cast in `DashboardPage.tsx`

**Run Dashboard UX Redesign:**
- [x] Removed `ProgressOverview.tsx` (progress bar + percentage) from `DashboardPage.tsx` — replaced with prompt-centric two-column layout (files kept for potential reuse)
- [x] Removed `ModelProgressGrid.tsx` from `DashboardPage.tsx` — replaced by per-prompt model status rows (files kept for potential reuse)
- [x] Created `EvalSummaryBar.tsx` — shows eval name, prompt count, model count, test case count; data fetched from `GET /api/eval/evaluations/:id` on mount
- [x] Created `PromptRunCard.tsx` — one card per prompt slot (A and B); shows prompt label; contains one `ModelStatusRow` per selected model
- [x] Created `ModelStatusRow.tsx` — shows model name, server name, and status: pending / running (spinner) / completed (latency + tok/s) / failed (error badge + retry button)
- [x] Created `ErrorPanel.tsx` — appears when any `cell:failed` events arrive; lists each failure with model ID, prompt ID, and error message; includes "Retry Failed Cells" button calling `POST /api/eval/evaluations/:id/retry`
- [x] Created `WsStatusDot.tsx` — small indicator in the dashboard header showing WebSocket state (connecting / connected / reconnecting / closed)
- [x] Updated `LiveFeed.tsx` — error rows now show error text in rose color; failed cell modal shows error details
- [x] Rewrote `DashboardPage.tsx` layout — two-column `PromptRunCard` grid + `ErrorPanel` + `LiveFeed`; `ElapsedTimer` and `WsStatusDot` in header; `EvalSummaryBar` below header
- [x] Rewrote `DashboardPage.css` — new grid layout with `grid-template-columns: 1fr 1fr` for prompt cards; full styling for all new components

- [x] **Verification**: New eval with typed (unsaved) prompts → prompts auto-save → eval starts → dashboard shows Prompt A and Prompt B cards each with selected models in "running" state → models update to "completed" with latency and tok/s → Live Feed shows completions → use a bad model name → ErrorPanel shows error message → "Retry" button creates new eval for failed cells; navigate away and back → REST status loaded, completion shown without WS events

---

## Phase 7 — Prepare & Results Page Review / Refinement

> Prerequisite: Phase 6.5 complete (run dashboard working end-to-end).
>
> Goal: Review and refine the **Prepare page** (Step 2 — `/eval/config`) and the **Results page** (Step 4 — `/eval/results/:id`) to improve usability, completeness, and feedback quality. This phase also adds the failure detail panel for the Results page, which is directly useful now that the run dashboard can surface cell failures.

**Prepare Page (ConfigPage) Improvements:**
- [ ] Add validation feedback before Run: if no prompts have content, show inline error ("At least one prompt is required"); if no models selected, show tooltip on disabled Run button
- [ ] Show auto-save status on the Run button when prompts are being saved (e.g., spinner + "Saving prompts…" while `createPrompt()` calls are in-flight)
- [ ] Add a "Cell count" summary below the Execution Preview that shows the total matrix: `promptCount × modelCount × testCaseCount × runsPerCell` with a plain-English label ("X total LLM calls")
- [ ] Improve `TestCaseEditor` inline test case UX: add drag-to-reorder for inline test case rows; show row count badge next to section title; add "Import from test suite" shortcut

**Results Page (ResultsPage) Improvements:**
- [ ] Add failure detail panel to Results page: clicking a failed cell (rose border + ⚠ icon) in the heatmap opens a drawer/modal showing:
  - [ ] Error message and error type
  - [ ] Retry history: attempt number, timestamp, error message per attempt
  - [ ] Full raw model response (monospace, scrollable) — may be partial
  - [ ] Deterministic check breakdown (keywords found/missing, JSON schema errors)
  - [ ] "↻ Retry this cell" button — calls `POST /api/eval/evaluations/:id/retry` with `{ failedCellsOnly: true }` → navigates to new run dashboard
- [ ] Add `rawJudgeResponse?: string` field to `JudgeResult` in `src/types/eval.ts`; store it in `JudgeService` parse fallback chain; display it in the failure detail panel when available
- [ ] Improve the Compare view tab: add a "Copy response" button for each side; show token counts and latency below each response panel
- [ ] Improve the Metrics tab: add a "Success rate by model" bar chart; show a table of failed cells grouped by model
- [ ] Add eval run selector when session has multiple runs: a tab bar at the top of ResultsPage showing run number + completion status; clicking a tab loads that run's results from the session's run history

**Shared / Infra:**
- [ ] Error boundary: React error boundary wrapping `DashboardPage`, `ResultsPage`, and `ConfigPage` so one panel crash doesn't take down the whole wizard flow
- [ ] Loading states: skeleton loaders for heatmap cells while results are fetching; spinner in model leaderboard while data loads

- [ ] **Verification**: ConfigPage — try to run with empty prompts → inline error shown; run button shows "Saving prompts…" while auto-save is in flight; cell count shows correct math. ResultsPage — click a failed heatmap cell → failure detail drawer opens with error, retry history, and "Retry" button; clicking "Retry" navigates to new run dashboard. Compare view has copy buttons and shows token counts. Session with 2+ runs shows run tab bar in ResultsPage.

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

---

## Phase 9 — Eval Wizard Step 5: Summary & AI-Powered Suggestions

> Prerequisite: Phases 5–7 complete (eval wizard flow, results analysis, and polish all working well).
>
> Spec: [`../../features/eval-wizard/EVAL_WIZARD.md`](../../features/eval-wizard/EVAL_WIZARD.md) (Step 5 section)
>
> This is the final step of the eval wizard (`/eval/summary/:id`). After the user has reviewed the raw eval results in Step 4, this page provides AI-generated analysis, model recommendations, and prompt improvement suggestions.

**Summary Page UI:**
- [ ] Create `SummaryPage.tsx` at `/eval/summary/:id` — replaces the placeholder skeleton from Phase 5A
- [ ] Create `SummaryOverview.tsx` — natural language executive summary of the evaluation: which prompt performed better, by how much, on which dimensions, and with which models
- [ ] Create `ModelRecommendation.tsx` — ranked model cards with reasoning for each: composite score, latency, consistency, and suitability for this prompt's use case. Highlight the best overall model and best value model (if latency/cost tradeoffs exist)
- [ ] Create `PerModelAnalysis.tsx` — for each model that scored below average, display analysis of what aspects of the prompt caused issues (e.g., "Model X struggles with the JSON output format — consider providing an explicit example"). Group by failure pattern (format issues, hallucination, instruction non-compliance, etc.)
- [ ] Create `ImprovementSuggestions.tsx` — concrete prompt revision suggestions based on judge feedback, low-scoring perspectives, and deterministic check failures. Each suggestion card shows: rationale, the specific text change proposed, estimated impact (high/medium/low), and a diff preview using the existing `PromptDiffView` component
- [ ] Add "Apply Suggestion" button per suggestion card — creates a new prompt version and session version via `POST /api/eval/sessions/:id/apply-suggestion`, then offers to re-run the evaluation from Step 3
- [ ] Add "Apply & Re-run" shortcut — applies suggestion and immediately starts a new evaluation run, navigating to the Dashboard (Step 3)
- [ ] Wire "View Summary & Suggestions →" button on `ResultsPage.tsx` to navigate to `/eval/summary/:id`

**Backend — Summary Generation Endpoint:**
- [ ] Create `POST /api/eval/evaluations/:id/summary-analysis` — accepts `{ refinementModel?: string }`, constructs a comprehensive analysis prompt and dispatches to LMApi
- [ ] The analysis prompt must include:
  - Full text of both prompts (A and B)
  - The eval template (perspectives, weights, scoring rubrics)
  - The evaluation summary (model rankings, prompt rankings, per-perspective scores)
  - The top N lowest-scoring cells with: raw model response, judge scores + justifications, deterministic check failures, retry attempts
  - The test cases used (user messages, expected outputs)
  - Model metadata (parameter count, server name) for model-specific advice
- [ ] Parse response into structured sections: executive summary, model recommendation, per-model analysis, prompt improvement suggestions
- [ ] Return structured JSON with typed sections (reuse `ImprovementSuggestion` type from Phase 8a, add `ModelRecommendation` and `SummaryAnalysis` types)
- [ ] Cache generated summary to avoid redundant LLM calls — store in `data/evals/evaluations/{id}/analysis.json`

**Integration with Phase 8a:**
- [ ] Reuse `RefinementService.buildImprovementPrompt()` and `parseSuggestions()` for the prompt improvement portion
- [ ] Extend `RefinementService` with `buildModelRecommendationPrompt()` and `parseModelRecommendation()`
- [ ] Uses `REFINEMENT_MODEL` env var — if not configured, the Summary page shows the raw results summary without AI-generated suggestions (graceful degradation)

- [ ] **Verification**: Complete an eval → navigate to Step 4 (Results) → click "View Summary" → Step 5 loads with AI-generated executive summary, model recommendation with reasoning, per-model analysis for underperforming models, and 1–3 prompt improvement suggestions with diff previews; "Apply Suggestion" creates new prompt version + session version; "Apply & Re-run" starts new eval and navigates to Dashboard; `REFINEMENT_MODEL` not set → page shows manual summary only without AI suggestions; cached analysis loads instantly on revisit

---

## Phase F5 — AI-Generated Test Cases (Dogfood Candidate)

> Prerequisite: Phase 4 (LLM Judge) complete. Requires a working `generateTemplate` prompt pattern (already in `JudgeService.buildTemplateGeneratorPrompt()`) as a reference for the generation prompt style.
>
> Full spec: [`../features/eval-wizard/TEST_CASE_IMPORT_EXPORT.md`](../features/eval-wizard/TEST_CASE_IMPORT_EXPORT.md) — Section 7
>
> **⭐ Self-evaluation candidate**: This feature is an ideal dogfood scenario for LMEval itself. The test case generation prompt can and should be evaluated using LMEval before the feature ships. See "Dogfood Eval Setup" below.

### Why This Is Deferred

The "Generate test cases" feature requires a carefully engineered prompt that reliably produces:
- Diverse test cases (not just paraphrases of the prompt)
- Correct JSON output format matching `TestCase[]`
- Good coverage of happy paths, edge cases, refusal scenarios, and format stress tests

This prompt must be iterated using LMEval before the feature ships. The generation prompt is the thing being evaluated — not the feature code itself.

### What Exists Now (Context)

- The existing **Auto-Generate** button on the Template Selector (`TemplateSelector.tsx`) calls `POST /api/eval/templates/generate`, which uses `JudgeService.buildTemplateGeneratorPrompt()` to generate evaluation rubric weights from a prompt. This is the closest existing pattern.
- The existing import/export infrastructure (Phase I1–I4 above) provides the `TestCase[]` type and the import flow that generated cases will feed into.

### Feature Description

A **"Generate test cases"** button in the Suite tab of `TestCaseEditor`. When clicked:

1. Takes the current **Prompt A content** as context (the prompt being evaluated)
2. Optionally accepts a **"test focus"** free-text description from the user (e.g., "focus on edge cases and refusal behavior")
3. Sends a structured request to LMApi to generate N test cases
4. Streams or polls the response
5. Parses the result as `TestCase[]`
6. Feeds into the standard import/confirm flow (replace / append / cancel)

### Backend Tasks

- [ ] Add `buildTestCaseGeneratorPrompt(promptContent, focus, count)` to `server/services/JudgeService.ts`
  - Prompt instructs the model to analyze the system prompt and generate diverse test cases
  - Output format: JSON array matching `TestCase[]` (`description`, `userMessage`, `expectedOutput?`, `tags?`)
  - Include diversity instructions: happy paths, edge cases, out-of-scope inputs, format stress tests, adversarial inputs
- [ ] Add `parseTestCaseGeneratorResponse(raw)` to `JudgeService.ts` — 4-step fallback parse chain (same pattern as `parseRubricResponse`)
- [ ] Add `POST /api/eval/test-cases/generate` route:
  - Accepts `{ promptContent: string, focus?: string, count?: number }` (default count: 8)
  - Dispatches via `LmapiClient` using the most capable available model
  - Returns `{ cases: TestCase[], generationModel: string }`
  - Returns 400 if `promptContent` is empty

### Frontend Tasks

- [ ] Add **"✨ Generate"** button to the Suite tab toolbar in `TestCaseEditor.tsx` (alongside Import/Export)
- [ ] Button is disabled if Prompt A has no content (show tooltip: "Enter a prompt in Step 1 first")
- [ ] On click: open a small inline panel below the toolbar:
  - Text input: `Test focus (optional): [________________________]`
  - Count selector: `Generate: [5 ▾] cases`
  - `[Generate]` button
- [ ] Loading state: spinner + "Generating…" while awaiting response
- [ ] On success: feed into standard import/confirm flow (so user can Replace / Append)
- [ ] On error: inline error banner with the failure reason

### Dogfood Eval Setup

Before shipping, run LMEval against the generation prompt itself:

- **Prompt A**: Initial generation prompt (v1)
- **Prompt B**: Refined generation prompt (v2 — after reviewing v1 output quality)
- **Test cases**: A set of seeded system prompts covering different domains (customer service, code assistant, data extraction, creative writing, refusal-heavy)
- **Template**: Custom rubric with perspectives:
  - *Format compliance* — is the output valid JSON matching `TestCase[]`?
  - *Diversity* — do the cases cover multiple input patterns, not just paraphrases?
  - *Relevance* — are cases meaningfully related to the given system prompt?
  - *Adversarial coverage* — does at least one case test a refusal or edge scenario?
- **Judge**: Use the best available Ollama model
- **Expected outcome**: Prompt B composite score ≥ Prompt A; format compliance = 100% (hard gate)

This evaluation should be saved as a preset and re-run whenever the generation prompt is modified.

### Acceptance Criteria

- [ ] "Generate" button appears in Suite tab, disabled without Prompt A content
- [ ] Inline focus input and count selector appear on button click
- [ ] Loading state shown during generation
- [ ] Generated cases feed into standard replace/append/cancel confirm flow
- [ ] Generated cases respect the extended `TestCase` type (include `tags` and `expectedOutput` where appropriate)
- [ ] Malformed LLM output (non-JSON, wrong shape) handled gracefully with error banner
- [ ] Generation prompt has been validated using LMEval before the feature ships (see Dogfood Eval Setup above)
