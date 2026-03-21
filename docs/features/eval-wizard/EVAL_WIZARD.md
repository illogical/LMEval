# Eval Wizard — Frontend Implementation Plan

> Feature spec for Phases 5 & 6 of the [Prompt & Model Evaluation System](../../prompt-eval-system/TASK.md).
>
> Replaces the three-panel layout from the original plan (Section 6.2 of `prompt-eval-system-plan.md`) with a wizard-style multi-step flow.

---

## Design Decision: Hybrid Wizard-Tab Architecture

Five layout strategies were evaluated (linear wizard, tab hub, master-detail sidebar, dashboard grid, resizable split-pane). The chosen approach is a **hybrid of the linear wizard and tab hub** — called "Guided Flow with Free Navigation."

**Core concept**: Five routes, each owning the full viewport below a persistent header. A horizontal **step indicator** at the top shows the user's position in the workflow and allows clicking to jump to any previously-visited step. The wizard metaphor guides new users through the flow; tab-like free navigation lets power users jump between steps.

**Key design choices** (confirmed by user):
- **Landing page**: Session Hub at `/` showing recent sessions/evals as cards
- **Diff style**: Side-by-side (JetBrains-style) for comparing Prompt A vs B
- **CSS approach**: Pure CSS with custom properties (no Tailwind)
- **Chart library**: Recharts for results visualizations

---

## Route Structure

```
/                       → Session Hub (recent sessions/evals, "New Evaluation" + "Quick Compare")
/compare                → Current App.tsx (simple A/B comparison, preserved as-is)
/eval/prompts           → Step 1: Prompt & Model Selection + Diff
/eval/config            → Step 2: Evaluation Configuration
/eval/run/:id           → Step 3: Execution Dashboard
/eval/results/:id       → Step 4: Results & Analysis
/eval/summary/:id       → Step 5: Summary & Suggestions (future — see Phase 9 in TASK.md)
```

---

## Page Descriptions

### Session Hub (`/`)

The landing page. Shows recent activity and provides entry points into the app.

- Grid of recent session cards showing: session name, prompt A/B names, last eval date, best model, composite score
- Each card links to the relevant eval results or the wizard at the last-visited step
- **"New Evaluation"** button → navigates to `/eval/prompts` (Step 1)
- **"Quick Compare"** button → navigates to `/compare` (existing simple comparison)
- Empty state for first-time users: hero message + single "Get Started" CTA
- Data source: `GET /api/eval/sessions` + `GET /api/eval/evaluations?status=completed`

### Step 1 — Prompts & Models (`/eval/prompts`)

The primary setup page. Load prompts, view their differences, and select which models to test.

- Side-by-side prompt editors (reuse existing `PromptPanel` component)
- **Version selector** per prompt — dropdown to load saved prompts from `/api/eval/prompts` with version picker
- Collapsible **side-by-side diff panel** between the two editors:
  - JetBrains-style: two columns with gutter line numbers, matched line pairing
  - Added lines highlighted with green/teal background on the right
  - Removed lines highlighted with rose background on the left
  - Word-level inline highlights within changed lines (using `diffWords` from the `diff` package)
  - Toggle button to show/hide diff
- **Model selector** at bottom (reuse existing `ModelSelector` component, grouped by server)
- **"Next: Configure Evaluation →"** button advances to Step 2
- Drag-and-drop file upload for `.md`/`.txt` files (reuse existing upload logic in `PromptPanel`)

### Step 2 — Configuration (`/eval/config`)

Configure the evaluation parameters before running.

- **Template selector**: Dropdown of built-in + custom eval templates from `GET /api/eval/templates`. "Auto-Generate from Prompt" button calls `POST /api/eval/templates/generate` and shows an editable preview. "Customize" opens inline perspective editor.
- **Test case editor**: Toggle between "Quick" mode (single textarea for one user message) and "Suite" mode (table of test cases with add/remove rows; load saved suite from dropdown via `GET /api/eval/test-suites`).
- **Judge configuration**: Judge model selector (single select from available models), pairwise comparison toggle, runs-per-combination number input (1–10, default 1).
- **Execution preview**: Matrix badge showing "2P x 3M x 4T x 1R = 24 completions" with estimated tokens and time. Warning if matrix > 50 cells.
- **"Save as Preset"** / **"Load Preset"** for reusable eval configurations (new feature — see Evaluation Presets section below).
- **"Run Evaluation"** button → serializes config, POSTs to `POST /api/eval/evaluations`, navigates to Step 3.

### Step 3 — Execution Dashboard (`/eval/run/:id`)

Real-time monitoring while the evaluation runs.

- **Compact config summary** at top: which prompts are being tested, models grouped by server name, expected total runs
- **Elapsed timer**: Frontend-driven `HH:MM:SS` clock (updates every second, no WebSocket needed)
- **Overall progress bar** with percentage and phase indicator (Completions → Judging → Aggregation)
- **Per-model progress cards** grouped by server name: model name, progress bar (done/total), average latency so far, tokens/sec
- **Live feed**: Scrolling list of completed cells as compact cards with slide-in animation. Each card shows: model name, test case name, pass/fail indicator for deterministic checks. Click a card to preview the response in a modal.
- On `eval:completed` WebSocket event: show completion state with total time. A **"View Results →"** button appears to navigate to Step 4.

### Step 4 — Results & Analysis (`/eval/results/:id`)

Full results exploration with sub-tab navigation.

**Sub-tabs**: Scoreboard | Compare | Detail | Metrics | Timeline

- **Scoreboard** (default tab):
  - **Heatmap matrix**: CSS Grid table. Rows = prompts x test cases, columns = models. Each cell shows composite score (1.0–5.0) with background color from heatmap gradient (teal → amber → rose). Hover tooltip shows per-perspective breakdown. Click opens Detail view.
  - **Model leaderboard**: Ranked cards with composite score, deterministic pass rate, avg latency, tokens/sec. Top model gets teal border accent.
  - **Prompt leaderboard**: Same format ranking prompts.
  - **Regression banner** (if baseline set): Prominent alert showing improvements (teal up-arrows) and regressions (rose down-arrows) with delta values.

- **Compare**:
  - Two dropdown selectors to pick any two prompt x model x testCase cells.
  - Left and right columns showing full response text.
  - Tool calls rendered as structured cards (function name, arguments, valid/invalid badge).
  - Pairwise verdict section below: winner indicator + judge justification.
  - Diff toggle: highlights text differences between the two responses.

- **Detail**:
  - Full drill-down for a single matrix cell (selected from heatmap click or dropdown).
  - Sections: raw response (monospace, scrollable), tool calls (collapsible cards with pass/fail), deterministic metrics table, per-perspective judge scores with justifications (expandable), latency/token breakdown.

- **Metrics**:
  - Recharts bar charts: latency by model, tokens/sec by model, token usage (input vs output) by model.
  - Deterministic compliance table: per-cell pass/fail for each enabled check.
  - Consistency chart (visible if runs > 1): score distribution per model.

- **Timeline** (visible when viewing a prompt with evaluation history):
  - Recharts line chart: x-axis = evaluation date, y-axis = composite score.
  - One line per model (color-coded). Hover to see evaluation details.
  - Markers for prompt version changes along x-axis.
  - Data source: `GET /api/eval/prompts/:id/history`.

- **Action buttons**: "Export HTML", "Export Markdown" (trigger downloads), "Save as Baseline" (prompts for slug name).
- After reviewing results, a **"View Summary & Suggestions →"** button navigates to Step 5 (future phase — see Phase 9).

### Step 5 — Summary & Suggestions (`/eval/summary/:id`) — Future Phase

> **This step is designed separately and implemented in Phase 9.** The route and step indicator slot should be reserved but the page itself is deferred until the rest of the wizard is working well.

A dedicated page for AI-powered analysis and improvement suggestions, presented after the user has reviewed the raw eval results.

**What this page will provide:**
- **Executive summary**: Natural language summary of the evaluation — which prompt performed better, by how much, on which dimensions, and with which models.
- **Best model recommendation**: Based on composite scores, latency, consistency, and cost — which model(s) are the best fit for this prompt's use case, with reasoning.
- **Per-model improvement suggestions**: For models that scored poorly, suggestions on what aspects of the prompt may be causing issues with that specific model (e.g., "Model X struggles with the JSON output format constraint — consider providing an explicit example").
- **Prompt improvement suggestions**: Concrete suggestions for how to revise the prompt based on judge feedback, low-scoring perspectives, and deterministic check failures. Each suggestion includes: the rationale, the specific change proposed, estimated impact, and a diff preview.
- **"Apply Suggestion" action**: Applies a suggestion by creating a new prompt version and session version, then offers to re-run the evaluation.

**What context the LLM needs for generating suggestions:**
- The full text of both prompts (A and B)
- The eval template (perspectives, weights, scoring rubrics)
- The evaluation summary (model rankings, prompt rankings, per-perspective scores)
- The top N lowest-scoring cells with: raw model response, judge scores + justifications, deterministic check failures, retry attempts if any
- The test cases used (user messages, expected outputs)
- Model metadata (parameter count, server name) for model-specific advice

**Integration with existing backend:**
- Leverages `POST /api/eval/sessions/:id/suggest-improvements` from Phase 8a
- Extends the existing `RefinementService` with model recommendation logic
- Uses `REFINEMENT_MODEL` env var for the suggestion-generating model

---

## New Features

### Evaluation Presets

A new concept distinct from `EvalTemplate` (which is about judge rubrics). Evaluation presets capture reusable evaluation *configurations* — model selections, template ID, test suite ID, judge settings — so users can quickly set up evaluations for different prompts with the same testing parameters.

**Type definition** (add to `src/types/eval.ts`):
```typescript
interface EvalPreset {
  id: string;
  name: string;
  description?: string;
  modelIds: string[];           // Selected model IDs
  templateId?: string;          // Eval template to use
  testSuiteId?: string;         // Test suite to load
  judgeModelId?: string;        // Judge model
  enablePairwise: boolean;      // Pairwise comparison toggle
  runsPerCell: number;          // Runs per prompt x model x testCase combination
  createdAt: string;
  updatedAt: string;
}
```

**Backend:**
- Create `data/evals/presets/` directory
- Create `server/services/PresetService.ts` — list/get/create/update/delete
- Create `server/routes/presets.ts` — CRUD at `/api/eval/presets`
- Wire into `server/index.ts`

**Frontend:**
- "Save as Preset" button on ConfigPage — saves current config (excluding prompt IDs)
- "Load Preset" dropdown on ConfigPage — populates config fields from saved preset

### Prompt A/B Diff View

Side-by-side diff rendering for comparing Prompt A vs Prompt B.

**Implementation:**
- The `diff` npm package is already installed (`"diff": "^8.0.3"`). The server already uses it in `PromptService.diff()`.
- For cross-prompt diff (A vs B): compute client-side using `diffLines` from `diff`.
- For same-prompt version diff: call existing `GET /api/eval/prompts/:id/diff?from=1&to=2` endpoint.
- Create `PromptDiffView.tsx` component:
  - Side-by-side layout with two columns and gutter line numbers
  - Matched line pairing (blank lines inserted for alignment)
  - Added lines: green/teal background on the right column
  - Removed lines: rose background on the left column
  - Word-level inline highlights within changed lines using `diffWords`
- CSS classes: `.diff-added`, `.diff-removed`, `.diff-word-added`, `.diff-word-removed`
- Integrated into PromptsPage as a collapsible panel between the two prompt editors

---

## State Management

### React Context + useReducer

Two contexts (no external state library):

**1. EvalWizardContext** — Holds wizard state across route transitions:
```typescript
interface EvalWizardState {
  // Step 1: Prompts
  promptA: { id: string | null; version: number; content: string; manifest: PromptManifest | null };
  promptB: { id: string | null; version: number; content: string; manifest: PromptManifest | null };
  selectedModels: SelectedModel[];

  // Step 2: Configuration
  templateId: string | null;
  testSuiteId: string | null;
  inlineTestCases: TestCase[];
  userMessage: string;
  judgeModelId: string | null;
  enablePairwise: boolean;
  runsPerCell: number;

  // Step 3-4: Execution
  evalId: string | null;
  sessionId: string | null;

  // Wizard metadata
  currentStep: 1 | 2 | 3 | 4 | 5;
  maxVisitedStep: number;
  isDirty: boolean;
}
```

Reducer actions: `SET_PROMPT_A`, `SET_PROMPT_B`, `SET_MODELS`, `SET_CONFIG`, `START_EVAL`, `LOAD_SAVED_CONFIG`, `LOAD_PRESET`, `RESET`.

**2. WebSocketContext** — Manages single WebSocket connection, filters events by evalId, provides typed event streams to consumers.

### Serialization / Persistence

- **In-progress state**: Serialize `EvalWizardState` to `localStorage` on every change (debounced 500ms). On wizard mount, check for saved state and offer to restore. Key format: `lmeval:wizard:{sessionId}`.
- **Reusable presets**: Stored server-side via `/api/eval/presets` (see Evaluation Presets above).

---

## Technical Decisions

### Routing: `react-router-dom` v7

```bash
bun add react-router-dom
```

Router setup in `main.tsx`:
```tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<SessionHubPage />} />
    <Route path="/compare" element={<ComparePage />} />
    <Route path="/eval" element={<EvalLayout />}>
      <Route index element={<Navigate to="prompts" />} />
      <Route path="prompts" element={<PromptsPage />} />
      <Route path="config" element={<ConfigPage />} />
      <Route path="run/:evalId" element={<DashboardPage />} />
      <Route path="results/:evalId" element={<ResultsPage />} />
      <Route path="summary/:evalId" element={<SummaryPage />} />
    </Route>
  </Routes>
</BrowserRouter>
```

`EvalLayout` renders the persistent header, step indicator, and `<Outlet />`. Wraps children in `EvalWizardProvider`.

### WebSocket Transport

The current `server/ws.ts` is a stub — it sets a broadcast function but has no actual WebSocket transport to the browser. The `vite.config.ts` already proxies `/ws/eval`.

- **Server**: Replace stub with real WebSocket implementation using the `ws` npm package (or Bun native WS).
- **Client**: `useEvalSocket(evalId)` hook:
  - Opens native WebSocket to `/ws/eval` when `evalId` is provided
  - Filters incoming events to match the evalId
  - Returns `{ progress, events, status, isCompleted }`
  - Reconnects on disconnect with exponential backoff
  - Closes on unmount or evalId change

### Charts: Recharts

```bash
bun add recharts
```

Used for: bar charts (latency, tokens/sec, token usage), line charts (historical score trends), consistency visualizations. The heatmap matrix is done with CSS Grid (not Recharts).

### CSS: Pure CSS with Custom Properties

Continue the existing pattern — co-located `.css` files per component. Extend `src/index.css` with new semantic properties:
```css
--diff-add-bg: rgba(46, 160, 67, 0.15);
--diff-add-text: #3fb950;
--diff-remove-bg: rgba(244, 63, 94, 0.15);
--diff-remove-text: #f43f5e;
--diff-word-add-bg: rgba(46, 160, 67, 0.4);
--diff-word-remove-bg: rgba(244, 63, 94, 0.4);
--step-active: var(--accent);
--step-complete: var(--ok);
--step-pending: var(--muted);
--progress-bar: var(--accent);
--heatmap-low: #f43f5e;
--heatmap-mid: #f59e0b;
--heatmap-high: #2ea043;
```

CSS transitions for step changes (translateX-based slide animation). `@keyframes` for progress bars and live feed slide-ins.

### Streaming Text: Deferred

Currently `stream: false` is hardcoded in `LmapiChatCompletionRequest`. Implementing streaming requires changes across all layers (LMApi client, server WS forwarding, frontend renderer). Moderate effort (2–3 days assuming LMApi supports it). Low priority for eval workflows. Recommend implementing for `/compare` route first if desired later.

---

## Component Hierarchy

```
src/
  main.tsx                          -- BrowserRouter setup
  App.tsx                           -- Preserved as ComparePage content

  contexts/
    EvalWizardContext.tsx            -- Wizard state + reducer + provider
    WebSocketContext.tsx             -- WS connection management

  hooks/
    useModels.ts                    -- (existing)
    useModelsByServer.ts            -- (existing)
    useEvalSocket.ts                -- NEW: WS events for eval
    useEvalConfig.ts                -- NEW: localStorage serialization
    usePromptDiff.ts                -- NEW: diff computation

  layouts/
    EvalLayout.tsx                  -- Shared layout: header + step indicator + Outlet

  pages/
    SessionHubPage.tsx              -- Landing page: recent sessions/evals as cards
    ComparePage.tsx                 -- Current App.tsx (at /compare)
    PromptsPage.tsx                 -- Step 1
    ConfigPage.tsx                  -- Step 2
    DashboardPage.tsx               -- Step 3
    ResultsPage.tsx                 -- Step 4
    SummaryPage.tsx                 -- Step 5 (placeholder until Phase 9)

  components/
    layout/
      Header.tsx                    -- (existing, extended with nav links)
      EvalStepIndicator.tsx         -- NEW: horizontal step bar (1-5 steps)
    model/
      ModelSelector.tsx             -- (existing, reused)
      ModelNav.tsx                  -- (existing, reused)
    prompt/
      PromptPanel.tsx               -- (existing, reused)
      ResponseView.tsx              -- (existing, reused)
      PromptDiffView.tsx            -- NEW: side-by-side diff renderer
      PromptVersionSelector.tsx     -- NEW: version dropdown
    config/
      TemplateSelector.tsx          -- NEW: template picker + auto-generate
      TestCaseEditor.tsx            -- NEW: quick/suite mode
      JudgeConfig.tsx               -- NEW: judge model + pairwise + runs
      ExecutionPreview.tsx          -- NEW: matrix dimensions + estimates
      ConfigSummary.tsx             -- NEW: compact read-only summary
      PresetSelector.tsx            -- NEW: save/load eval presets
    dashboard/
      ProgressOverview.tsx          -- NEW: overall progress bar + ETA
      ModelProgressGrid.tsx         -- NEW: per-model/server progress cards
      LiveFeed.tsx                  -- NEW: scrolling cell completion feed
      ElapsedTimer.tsx              -- NEW: running clock
    results/
      Scoreboard.tsx                -- NEW: heatmap + leaderboards
      HeatmapMatrix.tsx             -- NEW: CSS Grid colored cells
      CompareView.tsx               -- NEW: side-by-side responses
      DetailView.tsx                -- NEW: single cell drill-down
      MetricsView.tsx               -- NEW: Recharts charts
      TimelineView.tsx              -- NEW: historical score trends
      RegressionBanner.tsx          -- NEW: improvement/regression alerts
    summary/
      SummaryOverview.tsx           -- FUTURE: executive summary
      ModelRecommendation.tsx       -- FUTURE: best model analysis
      ImprovementSuggestions.tsx    -- FUTURE: prompt improvement cards
```

---

## Implementation Sequence

### Phase 5A: Foundation (routing, context, layout)
1. Install `react-router-dom`, `recharts`
2. Restructure `main.tsx` with BrowserRouter and route definitions
3. Create `EvalLayout.tsx` with `EvalStepIndicator.tsx` (horizontal step bar, 5 steps, step 5 shows as "coming soon")
4. Create `EvalWizardContext.tsx` with `useReducer` state management
5. Move current `App.tsx` content to `ComparePage.tsx` at `/compare`
6. Create `SessionHubPage.tsx` at `/` — grid of recent session cards, "New Evaluation" + "Quick Compare" buttons, empty state for first use
7. Create skeleton pages for all wizard steps (PromptsPage, ConfigPage, DashboardPage, ResultsPage, SummaryPage placeholder)
8. Implement step indicator navigation and CSS slide transitions between steps
9. Add new CSS custom properties to `src/index.css` (diff colors, heatmap gradient, step indicator, progress bar)
10. Add SPA fallback route to `vite.config.ts` if needed

### Phase 5B: Step 1 — Prompts & Models
1. Create `PromptVersionSelector.tsx` — dropdown to load saved prompts with version picker
2. Create `PromptDiffView.tsx` — side-by-side diff using `diff` package (`diffLines` + `diffWords`), gutter line numbers, word-level inline highlights
3. Compose `PromptsPage.tsx`: dual prompt editors + collapsible diff panel + model selector + "Next" button
4. Wire prompt and model state into `EvalWizardContext`
5. Extend `src/api/eval.ts` with missing endpoint wrappers: `listPrompts()`, `getPrompt(id)`, `getPromptContent(id, version)`, `listSessions()`, `getEvaluation(id)`, `getEvaluationSummary(id)`

### Phase 5C: Step 2 — Configuration
1. Create `TemplateSelector.tsx` — dropdown of templates, auto-generate button, inline customization
2. Create `TestCaseEditor.tsx` — quick mode (single textarea) / suite mode (table with add/remove, load from dropdown)
3. Create `JudgeConfig.tsx` — judge model selector, pairwise toggle, runs-per-cell input
4. Create `ExecutionPreview.tsx` — matrix badge, estimated totals, warning for large matrices
5. Create `ConfigSummary.tsx` — compact read-only summary of full configuration
6. Compose `ConfigPage.tsx` with all config components + "Run Evaluation" button
7. Implement `localStorage` serialization for in-progress wizard state (debounced, restore on mount)
8. Backend: Create `EvalPreset` type in `src/types/eval.ts`
9. Backend: Create `data/evals/presets/` directory + `server/services/PresetService.ts` + `server/routes/presets.ts`
10. Backend: Wire presets router into `server/index.ts` at `/api/eval/presets`
11. Create `PresetSelector.tsx` — "Save as Preset" + "Load Preset" dropdown on ConfigPage

### Phase 5D: WebSocket + Execution Dashboard
1. Implement real WebSocket transport in `server/ws.ts` (replace stub with actual browser-facing WS)
2. Create `useEvalSocket.ts` hook — native WebSocket, filter by evalId, reconnect with backoff
3. Create `ProgressOverview.tsx` — overall progress bar + percentage + phase indicator
4. Create `ModelProgressGrid.tsx` — per-model progress cards grouped by server name
5. Create `LiveFeed.tsx` — scrolling event cards with slide-in animation, click to preview response
6. Create `ElapsedTimer.tsx` — frontend-driven HH:MM:SS clock
7. Compose `DashboardPage.tsx` with config summary + timer + progress + live feed
8. Implement auto-navigation: POST eval → navigate to `/eval/run/:id`; eval complete → show "View Results" button

### Phase 6A: Results — Core Views
1. Create `src/lib/scoring.ts` — `scoreToColor(score, min, max)`, `formatScore(score)`, `formatLatency(ms)`
2. Create `HeatmapMatrix.tsx` — CSS Grid with computed background colors, hover tooltips, click to detail
3. Create `Scoreboard.tsx` — heatmap matrix + model leaderboard cards + prompt leaderboard cards
4. Create `CompareView.tsx` — two dropdown selectors, side-by-side response text, diff toggle, pairwise verdict
5. Create `DetailView.tsx` — single cell drill-down with raw response, tool calls, metrics, judge scores
6. Create sub-tab navigation in `ResultsPage.tsx` (Scoreboard | Compare | Detail | Metrics | Timeline)

### Phase 6B: Results — Charts & Analysis
1. Create `MetricsView.tsx` — Recharts bar charts (latency by model, tokens/sec, token usage), deterministic compliance table
2. Create `TimelineView.tsx` — Recharts line chart (historical scores per model over time)
3. Create `RegressionBanner.tsx` — baseline comparison alerts with improvement/regression indicators
4. Wire export buttons: "Export HTML" → `GET /api/eval/evaluations/:id/export?format=html`, "Export Markdown" → same with `format=md`
5. Wire "Save as Baseline" button → `POST /api/eval/evaluations/:id/baseline`
6. Add keyboard shortcuts: `Ctrl+Enter` (run), `Ctrl+E` (export), `Ctrl+D` (diff toggle), `Esc` (close modal)
7. Add "View Summary & Suggestions →" button on ResultsPage (navigates to placeholder SummaryPage until Phase 9)

---

## Critical Files to Modify

| File | Change |
|------|--------|
| `src/main.tsx` | Add BrowserRouter, route definitions |
| `src/App.tsx` | Extract content to `ComparePage.tsx` |
| `src/types/eval.ts` | Add `EvalPreset` type, extend `EvalWizardState` |
| `src/api/eval.ts` | Add missing endpoint wrappers (list prompts, get content, presets CRUD, etc.) |
| `src/index.css` | Add diff, heatmap, step indicator, progress bar CSS properties |
| `server/ws.ts` | Replace stub with real WebSocket transport |
| `server/index.ts` | Wire presets router |
| `vite.config.ts` | SPA fallback route for client-side routing |
| `package.json` | Add `react-router-dom`, `recharts` dependencies |

## Existing Code to Reuse

| Component/Utility | Location | Reuse In |
|---|---|---|
| `ModelSelector` | `src/components/model/ModelSelector.tsx` | PromptsPage (Step 1) |
| `ModelNav` | `src/components/model/ModelNav.tsx` | DashboardPage (Step 3) |
| `PromptPanel` | `src/components/prompt/PromptPanel.tsx` | PromptsPage (Step 1) |
| `ResponseView` | `src/components/prompt/ResponseView.tsx` | CompareView, DetailView |
| `useModelsByServer` | `src/hooks/useModelsByServer.ts` | PromptsPage, ConfigPage |
| `chatCompletion` | `src/api/lmapi.ts` | ComparePage (preserved) |
| `createPrompt` / `addPromptVersion` | `src/api/eval.ts` | PromptsPage |
| `diff` package | Already installed | PromptDiffView, CompareView |
| `highlight.js` | Already installed | ResponseView (reused) |

---

## Verification Checklist

1. Navigate to `/` → Session Hub shows recent sessions as cards (or empty state for first use)
2. Click "New Evaluation" → navigates to `/eval/prompts` → step indicator shows Step 1 active
3. Load prompts A and B → side-by-side diff panel shows highlighted differences with word-level detail
4. Select models (grouped by server) → click "Next" → slides to `/eval/config`
5. Configure template, test cases, judge → execution preview shows correct matrix dimensions
6. Click "Run" → auto-navigates to `/eval/run/:id` → dashboard shows live progress via WebSocket
7. Per-model cards grouped by server show individual progress bars
8. Live feed shows completed cells with slide-in animation
9. Eval completes → completion summary shown → click "View Results" → navigates to `/eval/results/:id`
10. Scoreboard tab shows heatmap with correct colors and hover tooltips
11. Compare tab shows side-by-side responses with diff toggle
12. Metrics tab shows Recharts charts with correct data
13. Click step indicator → can jump back to any previously-visited step
14. `/compare` → existing simple comparison page works unchanged
15. Save/load eval preset works across sessions
16. Close browser mid-config → return → localStorage state restored with offer to continue
17. Session Hub shows completed eval with scores → click card → opens results
