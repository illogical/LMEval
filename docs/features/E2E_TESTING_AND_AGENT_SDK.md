# E2E Test Suite + Agent SDK Implementation Plan

## Context

LMEval has a fully implemented 5-step evaluation wizard (Prompts → Prepare → Run → Results → Summary) and a REST/WebSocket backend. The goal of this work is:

1. **Verification** — prove that the current UI controls and backend functionality all work correctly, end-to-end
2. **Agent parity** — ensure every feature available in the UI is also reachable via API, enabling an AI agent to drive the full self-refinement loop without a browser
3. **Typed SDK** — provide a clean `LMEvalClient` class that agents (or test scripts) can import and use

Decisions: both API script + Playwright browser tests, add missing API endpoints, self-contained cleanup with `e2e-test-*` prefix, and a typed SDK class.

---

## Phase 1 — API Endpoint Gaps

Several UI features have no server-side API equivalent. These must be added before the SDK and tests can cover them.

### 1a. Server-side test case parsing
**New endpoint**: `POST /api/eval/test-suites/parse`
- Body: `{ content: string; format: 'csv' | 'json' }`
- Returns: `{ cases: TestCase[]; warnings: string[]; errors: string[] }`
- Reuses existing `src/utils/testCaseIO.ts` logic (move shared parser to `server/services/` or import directly)
- File: `server/routes/testSuites.ts`

### 1b. Delete endpoints for cleanup
Add `DELETE` handlers to routes that are missing them:
- `DELETE /api/eval/prompts/:id` → `server/routes/prompts.ts`
- `DELETE /api/eval/evaluations/:id` → `server/routes/evaluations.ts`
- `DELETE /api/eval/sessions/:id` → `server/routes/sessions.ts`

Each should remove the resource's data directory/file. `evaluations` delete must also remove associated cells and summary files.

### 1c. Evaluation cancel
**New endpoint**: `POST /api/eval/evaluations/:id/cancel`
- Sets eval status to `cancelled`, stops in-flight cell processing in `ExecutionService`
- File: `server/routes/evaluations.ts`, `server/services/ExecutionService.ts`

### 1d. Frontend API client additions
Add wrapper functions for new endpoints to `src/api/eval.ts`:
- `deletePrompt(id)`, `deleteEvaluation(id)`, `deleteSession(id)`
- `parseTestCases(content, format)` — for agent use, not needed in UI

---

## Phase 2 — Typed Agent SDK

**File**: `scripts/lib/LMEvalClient.ts`

A class that talks directly to `http://localhost:3200/api/eval` (no Vite proxy). Imports types from `src/types/eval.ts`.

```ts
class LMEvalClient {
  constructor(baseUrl = 'http://localhost:3200/api/eval')

  // Prompts
  createPrompt(name, content): Promise<PromptManifest>
  addPromptVersion(id, content, description?): Promise<PromptManifest>
  listPrompts(): Promise<PromptManifest[]>
  getPromptContent(id, version?): Promise<string>
  deletePrompt(id): Promise<void>

  // Templates
  listTemplates(): Promise<EvalTemplate[]>
  generateTemplate(promptContent, tools?): Promise<Partial<EvalTemplate>>
  createTemplate(data): Promise<EvalTemplate>
  updateTemplate(id, data): Promise<EvalTemplate>
  deleteTemplate(id): Promise<void>

  // Test Suites
  listTestSuites(): Promise<TestSuite[]>
  createTestSuite(data): Promise<TestSuite>
  parseTestCases(content, format): Promise<TestCase[]>  // uses new endpoint
  deleteTestSuite(id): Promise<void>

  // Evaluations
  createEvaluation(config): Promise<{ evalId: string }>
  waitForCompletion(evalId, timeoutMs?): Promise<EvaluationSummary>  // WebSocket + polling fallback
  getEvaluation(id): Promise<EvaluationConfig>
  getResults(id): Promise<EvalMatrixCell[]>
  getSummary(id): Promise<EvaluationSummary>
  exportEvaluation(id, format): Promise<string>
  saveBaseline(id, slug): Promise<void>
  cancelEvaluation(id): Promise<void>
  deleteEvaluation(id): Promise<void>

  // Models
  listModels(): Promise<{ servers: Array<{ name: string; models: string[] }> }>

  // Presets
  listPresets(): Promise<EvalPreset[]>
  getPreset(id): Promise<EvalPreset>
  createPreset(data): Promise<EvalPreset>
  updatePreset(id, data): Promise<EvalPreset>
  deletePreset(id): Promise<void>

  // Sessions
  listSessions(): Promise<SessionManifest[]>
  createSession(data): Promise<SessionManifest>
  addSessionVersion(id, data): Promise<SessionManifest>
  deleteSession(id): Promise<void>

  // Cleanup helper
  cleanupTestResources(prefix = 'e2e-test-'): Promise<void>
}
```

`waitForCompletion` implementation:
1. Open WebSocket to `ws://localhost:3200/ws/eval`
2. Subscribe to eval events, resolve on `eval:completed` or reject on `eval:failed`
3. Fallback: poll `GET /evaluations/:id` every 2s if WebSocket fails
4. Honor `timeoutMs` with a rejection

---

## Phase 3 — API End-to-End Test Script

**File**: `scripts/e2e-api.ts`

Runs via `bun scripts/e2e-api.ts`. All resources named `e2e-test-*`. Cleanup runs in `finally`.

### Test scenarios (in order):

1. **Health check** — `GET /api/eval/health` returns 200

2. **Model discovery** — `listModels()` returns ≥1 server with ≥1 model; capture `firstModel` for use in all evals

3. **Prompt lifecycle**
   - `createPrompt('e2e-test-prompt-a', 'You are a helpful assistant.')` → returns manifest with version 1
   - `addPromptVersion(id, 'You are a concise assistant.')` → version 2
   - `getPromptContent(id, 1)` → original content
   - `listPrompts()` → includes new prompt

4. **Template operations**
   - `listTemplates()` → built-in templates present
   - `generateTemplate(promptContent)` → returns partial template with perspectives
   - `createTemplate({ name: 'e2e-test-template', ...generated })` → persisted template
   - `updateTemplate(id, { name: 'e2e-test-template-v2' })` → name updated

5. **Test case parsing**
   - `parseTestCases(csvString, 'csv')` → returns TestCase[] with correct fields
   - `parseTestCases(jsonString, 'json')` → returns TestCase[] with tags parsed
   - Invalid CSV → returns errors array (not a thrown exception)

6. **Test suite lifecycle**
   - `createTestSuite({ name: 'e2e-test-suite', testCases: parsedCases })`
   - `listTestSuites()` → suite present

7. **Preset lifecycle**
   - `createPreset({ name: 'e2e-test-preset', modelIds: [firstModel], runsPerCell: 1 })`
   - `updatePreset(id, { runsPerCell: 2 })`
   - `getPreset(id)` → runsPerCell === 2

8. **Session lifecycle**
   - `createSession({ name: 'e2e-test-session', promptA: { id: promptAId }, promptB: { id: promptBId } })`
   - `addSessionVersion(sessionId, { description: 'v2' })`
   - `listSessions()` → session present

9. **Full evaluation run**
   - `createEvaluation({ name: 'e2e-test-eval', promptIds: [promptAId, promptBId], modelIds: [firstModel], testSuiteId, runsPerCell: 1 })`
   - `waitForCompletion(evalId, 120_000)` → resolves to summary
   - Assert: `summary.completedCells > 0`, `summary.failedCells === 0`

10. **Results inspection**
    - `getResults(evalId)` → cells have `response`, `compositeScore`
    - `getSummary(evalId)` → model summaries present
    - `exportEvaluation(evalId, 'html')` → non-empty string containing `<html`
    - `exportEvaluation(evalId, 'md')` → non-empty string containing `# `

11. **Baseline + regression**
    - `saveBaseline(evalId, 'e2e-test-baseline')`
    - Create second eval with same config → `waitForCompletion`
    - `getSummary(secondEvalId)` → check for regression field

12. **Evaluation cancel**
    - Create a new evaluation (larger, e.g. runsPerCell: 3)
    - Immediately `cancelEvaluation(evalId)`
    - `getEvaluation(evalId)` → status === `cancelled`

13. **Cleanup** (in `finally`)
    - `cleanupTestResources('e2e-test-')` deletes all created prompts, templates, suites, presets, sessions, evals

---

## Phase 4 — Playwright Browser E2E Tests

**New files**:
```
playwright.config.ts
tests/e2e/
  wizard-happy-path.spec.ts   # Complete wizard walkthrough
  step1-prompts.spec.ts       # Prompt step features
  step2-config.spec.ts        # Prepare step features
  step2-testcases.spec.ts     # Test case import/export
  step3-run.spec.ts           # Run dashboard
  step4-results.spec.ts       # Results tabs
```

### playwright.config.ts
- `baseURL`: `http://localhost:5173`
- `webServer`: starts `bun run dev` and waits for port 5173
- `testDir`: `tests/e2e`
- One project: `chromium`
- Screenshots on failure, video on retry

### wizard-happy-path.spec.ts
Full flow through all 4 implemented steps:
1. Navigate to `/eval/prompts`
2. Type content into Prompt A text area → verify "Unsaved" indicator
3. Save Prompt A → verify save status indicator
4. Select a model from the model selector
5. Click Next → land on `/eval/config`
6. Select a built-in template
7. Enter a quick test case message
8. Configure judge model
9. Click "Run Evaluation" → land on `/eval/run/:id`
10. Wait for run to complete (poll for summary bar to show "Completed")
11. Auto-navigate to `/eval/results/:id`
12. Verify Scoreboard tab renders with cells

### step1-prompts.spec.ts
- **Prompt B inline editing**: type in Prompt B, verify debounce + save
- **Version selector**: load a saved prompt, select version, verify content loads
- **File drag-and-drop**: `page.dispatchEvent` to simulate file drop
- **Next button disabled** when no model selected
- **Next button enabled** after model selection

### step2-config.spec.ts
- **Template auto-generate**: click "Generate from prompt", wait for template to load, verify perspectives visible
- **Perspective weight slider**: adjust a slider, verify total weight updates
- **Preset load**: select preset from dropdown, verify model/template fields populate
- **Execution matrix preview**: change runsPerCell, verify count updates

### step2-testcases.spec.ts
- **Quick tab**: enter a user message, verify it appears in execution preview
- **Suite tab — inline add**: click "Add row", fill in userMessage, verify row persists
- **Suite tab — CSV import**: drop a CSV file, confirm dialog appears, click "Replace all", verify table populated
- **Suite tab — JSON import**: paste JSON via clipboard mock
- **Export CSV**: click Export CSV, verify download triggered (intercept `downloadFile` call)
- **Export JSON**: same for JSON
- **Tags column**: add a case with tags, verify Tags column appears
- **Save as suite**: click "Save as Suite", provide name, verify toast/confirmation

### step3-run.spec.ts
- **WebSocket connection indicator**: verify `WsStatusDot` shows connected state
- **Progress tracking**: wait for cell events in LiveFeed
- **Error panel**: mock a failed cell and verify it appears in ErrorPanel (or use a test prompt that produces a deterministic failure)

### step4-results.spec.ts
- **Tab navigation**: click each of the 5 result tabs (Scoreboard, Compare, Detail, Metrics, Timeline), verify content renders
- **Cell drill-down**: click a cell in Scoreboard → navigates to Detail view with that cell's data
- **Export HTML**: click export, verify download triggered
- **Export Markdown**: same
- **Save baseline button**: click, provide slug, verify confirmation

---

## Phase 5 — CI / package.json Integration

Add to `package.json`:
```json
"test:e2e-api": "bun scripts/e2e-api.ts",
"test:e2e-ui": "playwright test",
"test:e2e-ui:headed": "playwright test --headed",
"test:all": "bun run test && bun run test:e2e-api && bun run test:e2e-ui"
```

Add `@playwright/test` to devDependencies.

---

## Critical Files

| File | Action |
|------|--------|
| `server/routes/testSuites.ts` | Add `POST /parse` endpoint |
| `server/routes/prompts.ts` | Add `DELETE /:id` |
| `server/routes/evaluations.ts` | Add `DELETE /:id`, `POST /:id/cancel` |
| `server/routes/sessions.ts` | Add `DELETE /:id` |
| `server/services/ExecutionService.ts` | Add cancel support |
| `src/api/eval.ts` | Add delete/cancel/parse wrappers |
| `scripts/lib/LMEvalClient.ts` | **Create** — typed SDK class |
| `scripts/e2e-api.ts` | **Create** — API e2e test script |
| `playwright.config.ts` | **Create** |
| `tests/e2e/*.spec.ts` | **Create** — 6 spec files |

---

## Verification

1. `bun run test` — existing unit tests still pass (no regressions)
2. `bun run test:e2e-api` — all 12 API scenarios pass against a running dev server
3. `bun run test:e2e-ui` — all Playwright specs pass in headless Chromium
4. Confirm `cleanupTestResources` leaves `data/` directory with no `e2e-test-*` files

---

## Execution Order

1. Phase 1 (API gaps) — server-side changes, no client changes yet
2. Phase 2 (SDK) — depends on new endpoints from Phase 1
3. Phase 3 (API e2e script) — depends on SDK from Phase 2
4. Phase 4 (Playwright) — can start in parallel with Phase 3 once Playwright is set up
5. Phase 5 (CI wiring) — last, after tests are passing
