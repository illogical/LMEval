# Eval Wizard — Run Dashboard Redesign

> **Status**: Planned
> **Context**: The current Step 3 (`/eval/run/:id`) dashboard provides almost no feedback, contains several bugs preventing prompts from actually being sent to Ollama, and wastes the available screen space.

---

## Root Cause: Bugs Preventing Execution

### Bug 1 — Wrong LMApi endpoint in ExecutionService (Critical)

`LmapiClient.chatCompletion()` sends to `/api/chat/completions/any` with `model: "serverName::modelName"` (the combined format stored in `EvaluationConfig.modelIds`). LMApi's `/any` endpoint likely expects a bare model name, not the `server::model` compound format.

**Compare view reference** (working): calls `chatCompletionOnServer(req, serverName)` which maps to `/api/chat/completions/server` and sends `serverName` and `modelName` separately.

**Fix**: In `ExecutionService.runCompletions()`, split `cell.modelId` on `::` to extract `serverName` and `modelName`, then call LMApi's server-specific endpoint with each part separate. Update `LmapiClient` to expose a `chatCompletionOnServer(req, serverName)` method identical to the pattern used in the Compare view frontend (`/api/chat/completions/server`).

Relevant files:
- `server/services/LmapiClient.ts` — add `chatCompletionOnServer(req, serverName)` method
- `server/services/ExecutionService.ts:144` — replace `LmapiClient.chatCompletion()` call with server-specific variant

### Bug 2 — Unsaved prompts produce empty `promptIds` (Critical)

`ConfigPage.handleRun()` builds `promptIds` from `state.promptA.id` and `state.promptB.id`. These are `null` whenever the user typed or dragged content directly without clicking "Save copy." The filter produces an empty array, the backend returns 400, and the eval never starts (or the error is swallowed).

**Fix**: In `ConfigPage.handleRun()`, before calling `createEvaluation()`, auto-save any prompt slot that has content but no ID. Call `createPrompt(name, content)` for each null-ID slot and update the dispatch with the returned manifest. Only then proceed to create the evaluation.

Relevant files:
- `src/pages/ConfigPage.tsx:35-52` — auto-save prompts before `createEvaluation()`
- `src/api/eval.ts` — `createPrompt()` already exists

### Bug 3 — inlineTestCases not passed to backend

`ConfigPage.handleRun()` never includes `state.inlineTestCases` in the `createEvaluation()` payload. If a user adds inline test cases (not a test suite, not a single userMessage), zero test cases reach the backend → zero cells built → nothing runs.

**Fix**: Expand `createEvaluation()` API call to include `inlineTestCases: state.inlineTestCases`. Update the backend `POST /api/eval/evaluations` route and `ExecutionService.run()` to accept and store inline test cases in the eval directory.

Relevant files:
- `src/pages/ConfigPage.tsx:42-52`
- `src/api/eval.ts`
- `server/routes/evaluations.ts:52-80`
- `server/services/ExecutionService.ts` — `run()` function

### Bug 4 — WebSocket race condition loses early events

The frontend WebSocket reconnects with exponential backoff (initial delay 2 s → doubles). Short evals complete before the client reconnects. The result: `0 / 0 cells` shown indefinitely even though the eval finished.

**Fix**:
1. On `DashboardPage` mount, immediately `GET /api/eval/evaluations/:id` to check current status. If already `completed` or `failed`, load results from REST and skip directly to the results state or show the completion screen.
2. When WebSocket connects, also fetch the current `config.json` status so missed events can be recovered.
3. Reduce reconnect backoff: cap initial delay at 500 ms, max at 5 s.

Relevant files:
- `src/hooks/useEvalSocket.ts` — reconnect delays
- `src/pages/DashboardPage.tsx` — add REST status check on mount
- `src/api/eval.ts` — add `getEvaluation(id)` fetch helper if not present

### Bug 5 — Cell failures are silent to the user

`cell:failed` events are broadcast server-side, but the DashboardPage casts the event data as `EvalMatrixCell` even though the actual payload is `{ cellId, error }`. Errors are never displayed.

**Fix**: Handle `cell:failed` events explicitly. Show a dedicated error panel on the dashboard when any cells fail.

---

## UX Redesign: Run Dashboard

### Layout

Remove the single-column layout with an empty expanse below the progress bar. Replace with:

```
┌─────────────────────────────────────────────────────────┐
│  Evaluation Running   00:01:06          [WS: connected] │
│  Eval: "Eval 3/22 2:04 PM"  ·  2 prompts  ·  3 models   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  LIVE COMPLETIONS                                       │
│  ✓ llama3.2 · Prompt B · 3.4s · 412 tok/s               │
│  ✗ mistral · Prompt A · Error: connection refused       │
└─────────────────────────────────────────────────────────┘

┌────────────────────────┐   ┌────────────────────────────┐
│  PROMPT A              │   │  PROMPT B                  │
│  "My System Prompt"    │   │  "Improved System Prompt"  │
│  (preview, 3 lines)    │   │  (preview, 3 lines)        │
│                        │   │                            │
│  ┌──────────────────┐  │   │  ┌──────────────────────┐  │
│  │ llama3.2 · local │  │   │  │ llama3.2 · local     │  │
│  │ ● Running  0:42  │  │   │  │ ✓ 3.4s · 412 tok/s   │  │
│  └──────────────────┘  │   │  └──────────────────────┘  │
│  ┌──────────────────┐  │   │  ┌──────────────────────┐  │
│  │ mistral · remote │  │   │  │ mistral · remote     │  │
│  │ ⏳ Waiting       │  │   │  │ ⏳ Waiting           │  │
│  └──────────────────┘  │   │  └──────────────────────┘  │
└────────────────────────┘   └────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ERRORS (only shown if any)                             │
│  1 cell failed: mistral · Prompt A                      │
│  → connection refused                                   │
└─────────────────────────────────────────────────────────┘
```

### Specific Changes

**Remove:**
- The percentage text (`0%`)
- The horizontal progress bar

**Add:**
- **Eval summary bar**: eval name, prompt count, model count, test case count — rendered from the fetched `EvaluationConfig`
- **WebSocket status indicator**: small dot/text in the header (connecting / connected / reconnecting) so the user knows if events are live
- **Two-column prompt cards**: one column per prompt slot (A and B). Each card shows:
  - Prompt name (from manifest) or truncated content preview
  - One row per selected model: model name, server name, status (waiting / running / done / failed), when done: latency + tokens/sec
- **Error panel**: appears if any `cell:failed` events arrive. Shows the modelId, promptId, and the error message
- **Live completions feed**: ordered list of recently completed cells (keep existing `LiveFeed` component, retarget to show per-prompt-and-model entries)
- **"View Results" button**: shown only when `isCompleted` (keep existing pattern)
- **"Retry Failed Cells" button**: shown when any cells failed, calls `POST /api/eval/evaluations/:id/retry`

### Component Plan

| Component | Status | Notes |
|---|---|---|
| `DashboardPage.tsx` | Rewrite | New layout, REST status poll on mount |
| `DashboardPage.css` | Rewrite | New two-column grid |
| `EvalSummaryBar` | New | Shows eval config (prompts, models, test cases) |
| `PromptRunCard` | New | Per-prompt column with per-model status rows |
| `ModelStatusRow` | New | One model's progress within a prompt card |
| `ErrorPanel` | New | Collects and displays cell failures |
| `WsStatusDot` | New | Small indicator for WebSocket connection state |
| `LiveFeed` | Keep/Extend | Already exists, extend to show error rows |
| `ElapsedTimer` | Keep | Already exists |
| `ProgressOverview` | Remove | Replaced by two-column layout |
| `ModelProgressGrid` | Remove | Replaced by PromptRunCard |

---

## Data Flow After Fix

```
ConfigPage.handleRun()
  1. Auto-save unsaved prompts → get IDs
  2. createEvaluation({ promptIds, modelIds, inlineTestCases, userMessage, ... })
  ↓
POST /api/eval/evaluations → 202 { id, ... }
  ↓
ExecutionService.run(evalId):
  - buildMatrix(config, testCases)  ← testCases includes inline ones now
  - For each cell:
      split modelId "server::model" → serverName + modelName
      LmapiClient.chatCompletionOnServer({ model: modelName, ... }, serverName)
      → /api/chat/completions/server  ← same as Compare view
  - broadcast cell:started / cell:completed / cell:failed
  ↓
DashboardPage.tsx:
  - On mount: GET /api/eval/evaluations/:id (check if already done)
  - WS: connect to /ws/eval, receive events
  - If already completed: show results/errors from REST
  - If in-progress: update PromptRunCards per cell event
```

---

## Files to Create/Modify

### Bug Fixes
- `server/services/LmapiClient.ts` — add `chatCompletionOnServer(req, serverName)`
- `server/services/ExecutionService.ts` — use server-specific LMApi endpoint, accept inline test cases
- `server/routes/evaluations.ts` — accept `inlineTestCases` in POST body, persist them
- `src/pages/ConfigPage.tsx` — auto-save prompts, pass `inlineTestCases`
- `src/api/eval.ts` — update `createEvaluation()` type to include `inlineTestCases`
- `src/hooks/useEvalSocket.ts` — reduce reconnect backoff

### UX
- `src/pages/DashboardPage.tsx` — full rewrite of layout
- `src/pages/DashboardPage.css` — new grid layout styles
- `src/components/dashboard/EvalSummaryBar.tsx` — new component
- `src/components/dashboard/PromptRunCard.tsx` — new component
- `src/components/dashboard/ModelStatusRow.tsx` — new component
- `src/components/dashboard/ErrorPanel.tsx` — new component
- `src/components/dashboard/WsStatusDot.tsx` — new component
- `src/components/dashboard/LiveFeed.tsx` — extend for error rows
- `src/components/dashboard/ProgressOverview.tsx` — delete
- `src/components/dashboard/ModelProgressGrid.tsx` — delete

---

## Verification

1. Start the server and dev client
2. Go to `/eval/prompts`, type (don't save) two prompts, select one Ollama model
3. Click Next → Prepare, enter a test message, click Run
4. Should auto-save prompts, navigate to `/eval/run/:id`
5. Dashboard shows both prompt cards with the selected model in "running" state
6. Within seconds, the model rows update to "completed" with latency + tok/s
7. Live feed shows the completion
8. "View Results" button appears
9. Test with a bad server/model — error panel appears with the error message
10. Navigate away and back — status loads from REST, not just WS
