# LMEval — AI Prompt & Model Evaluation System

A standalone web application for systematically comparing LLM prompts and models. Built with **Bun + Vite + React + TypeScript** on the frontend and a **Bun + Hono** backend. Connects to a running [LMApi](https://github.com/illogical/LMApi) instance for all model interactions.

![LMEval UI](https://github.com/user-attachments/assets/50e35566-1fd1-47ab-bbba-a6e046a77fdd)

---

## Purpose

LMEval answers two core questions:

1. **Is prompt A better than prompt B?** — Compare prompt revisions across the same models and test cases.
2. **Is model X better than model Y for this task?** — Compare models against the same prompts and test cases.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [Bun](https://bun.sh) | ≥ 1.0 | Runtime + package manager |
| [LMApi](https://github.com/illogical/LMApi) | running | Must be accessible at `LMAPI_BASE_URL` |

---

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

The `.env` file in the project root controls the backend port and LMApi connection:

```env
# Eval backend port (default: 3200)
PORT=3200

# URL of your running LMApi instance
LMAPI_BASE_URL=http://localhost:3111
```

Edit `LMAPI_BASE_URL` to point to your LMApi instance if it's not on the default port.

### 3. Verify LMApi is running

```bash
curl http://localhost:3111/api/servers
```

You should see a JSON array of configured Ollama servers.

---

## Running

Two processes run concurrently:

| Process | Command | Port | Purpose |
|---|---|---|---|
| Eval Backend | `bun run dev:server` | 3200 | REST API + WebSocket |
| Vite Dev Client | `bun run dev:client` | 5173 | React frontend with HMR |

**Run both together:**

```bash
bun run dev
```

Then open **http://localhost:5173** in your browser.

---

## Verifying the Implementation

### Build check (no LMApi required)

```bash
# 1. Build the frontend — must complete with zero errors
bun run build

# 2. Verify built-in templates exist
ls data/evals/templates/
# Expected: code-generation.json  general-quality.json
#           instruction-following.json  tool-calling.json  report-template.html  custom/
```

### Backend health check

```bash
# Start the backend
bun run dev:server &

# Health endpoint
curl http://localhost:3200/health
# Expected: {"status":"ok","port":3200}
```

### Template API verification

```bash
# List built-in templates (should return 4)
curl http://localhost:3200/api/eval/templates | jq 'length'
# Expected: 4

curl http://localhost:3200/api/eval/templates | jq '.[].name'
# Expected: "General Quality" "Tool Calling" "Code Generation" "Instruction Following"

# Create a custom template
TMPL_ID=$(curl -s -X POST http://localhost:3200/api/eval/templates \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My Template",
    "description": "Test template",
    "deterministicChecks": {
      "formatCompliance": false,
      "jsonSchemaValidation": false,
      "toolCallValidation": false
    },
    "judgeConfig": {
      "enabled": false,
      "model": "",
      "perspectives": [],
      "pairwiseComparison": false,
      "runsPerCombination": 1
    }
  }' | jq -r '.id')

echo "Created template: $TMPL_ID"

# Delete it (built-ins are protected)
curl -X DELETE http://localhost:3200/api/eval/templates/$TMPL_ID
# Expected: 204 or {"success":true}
```

### Prompt versioning + diff verification

```bash
# Create a prompt
PROMPT_ID=$(curl -s -X POST http://localhost:3200/api/eval/prompts \
  -H 'Content-Type: application/json' \
  -d '{"name": "My Agent", "content": "You are a helpful assistant.", "description": "Test"}' \
  | jq -r '.id')

echo "Created prompt: $PROMPT_ID"

# Add a second version
curl -s -X POST http://localhost:3200/api/eval/prompts/$PROMPT_ID/versions \
  -H 'Content-Type: application/json' \
  -d '{"content": "You are a very helpful assistant.", "notes": "Added emphasis"}' | jq '.currentVersion'
# Expected: 2

# Get diff between v1 and v2
curl "http://localhost:3200/api/eval/prompts/$PROMPT_ID/diff?v1=1&v2=2" | jq '.'
# Expected: unified diff showing "very" was added
```

### Test suite CRUD verification

```bash
SUITE_ID=$(curl -s -X POST http://localhost:3200/api/eval/test-suites \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Basic Tests",
    "description": "Test suite for verification",
    "testCases": [
      {"id": "tc1", "name": "Simple greeting", "userMessage": "Hello, how are you?"},
      {"id": "tc2", "name": "Capital query", "userMessage": "What is the capital of France?"}
    ]
  }' | jq -r '.id')

echo "Created suite: $SUITE_ID"
curl http://localhost:3200/api/eval/test-suites/$SUITE_ID | jq '.testCases | length'
# Expected: 2
```

### Full evaluation run (requires LMApi with at least one model)

```bash
# Run the integration test script
bun run test:api
```

Or manually via the UI:

1. Open **http://localhost:5173**
2. Enter a system prompt in the left panel
3. Select models in the center panel
4. Add test cases in Quick mode
5. Select "General Quality" template
6. Click **Run Evaluation** or press `Ctrl+Enter`
7. Watch live progress in the center panel
8. Explore results in the right panel tabs (Scores / Compare / Details / Metrics / Timeline)

### WebSocket event verification

```bash
# Connect and watch events while running an eval from the UI
wscat -c ws://localhost:3200/ws/eval
# You should see JSON events: cell:started, cell:completed, eval:progress, eval:completed
```

---

## Architecture

```
┌─────────────────────────────────┐     HTTP/WS      ┌─────────────────────────┐
│   LMEval (this project)         │ ◄──────────────── │   LMApi                 │
│                                 │ ──────────────►   │   (external service)    │
│   Vite React Frontend  :5173    │                   │                         │
│   Bun/Hono API Backend :3200    │                   │   Ollama Server Pool    │
│   File-based JSON storage       │                   │   OpenRouter Fallback   │
│   WebSocket eval progress       │                   │   Socket.IO Events      │
└─────────────────────────────────┘                   └─────────────────────────┘
```

### Project Structure

```
LMEval/
├── server/                     # Bun + Hono backend (port 3200)
│   ├── index.ts                # Entry point, WebSocket server
│   ├── routes/                 # REST API routes
│   │   ├── templates.ts        # /api/eval/templates
│   │   ├── prompts.ts          # /api/eval/prompts
│   │   ├── testSuites.ts       # /api/eval/test-suites
│   │   ├── evaluations.ts      # /api/eval/evaluations
│   │   └── models.ts           # /api/eval/models (proxy to LMApi)
│   ├── services/               # Business logic
│   │   ├── FileService.ts      # JSON/Markdown I/O
│   │   ├── LmapiClient.ts      # HTTP client for LMApi
│   │   ├── TemplateService.ts  # Template CRUD + built-in seeding
│   │   ├── PromptService.ts    # Versioned prompt storage + diff
│   │   ├── TestSuiteService.ts # Test suite CRUD
│   │   ├── ExecutionService.ts # 4-phase eval pipeline
│   │   ├── MetricsService.ts   # Deterministic checks (ajv, keywords)
│   │   ├── JudgeService.ts     # LLM-as-judge prompt builder/parser
│   │   ├── SummaryService.ts   # Aggregation, ranking, regression
│   │   └── ReportService.ts    # Markdown + HTML report generation
│   └── ws.ts                   # WebSocket client tracking + broadcast
├── src/                        # Vite + React frontend (port 5173)
│   ├── api/                    # Typed API clients
│   │   ├── eval.ts             # All /api/eval/* endpoints
│   │   └── lmapi.ts            # Direct LMApi calls
│   ├── components/
│   │   ├── layout/             # TopBar, BottomBar, ResizablePanel
│   │   ├── prompt/             # PromptEditor, PromptTabs, ToolDefinitionEditor, PromptDiff
│   │   ├── config/             # ModelSelector, TestCaseEditor, TemplateSelector, JudgeConfig, ExecutionPreview
│   │   ├── execution/          # ProgressDashboard, LiveFeed, ModelProgressRow
│   │   └── results/            # Scoreboard, HeatmapMatrix, CompareView, DetailView, MetricsView, TimelineView
│   ├── context/EvalContext.tsx  # useReducer state management
│   ├── hooks/                  # useEvalSocket, useLmapiSocket, useResizable
│   ├── lib/scoring.ts          # scoreToColor, formatScore, formatLatency
│   └── types/                  # Shared TypeScript interfaces
├── data/evals/                 # File-based storage (created at runtime)
│   ├── templates/              # Built-in + custom eval templates
│   ├── prompts/                # Versioned system prompts
│   ├── test-suites/            # Reusable test case collections
│   ├── evaluations/            # Results per evaluation run
│   └── baselines/              # Saved regression baselines
└── scripts/
    └── test-api.ts             # Integration test script
```

---

## API Endpoints

All served by the Bun backend at `http://localhost:3200`.

### Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/eval/templates` | List all templates (built-in + custom) |
| GET | `/api/eval/templates/:id` | Get a template |
| POST | `/api/eval/templates` | Create a custom template |
| PUT | `/api/eval/templates/:id` | Update a custom template |
| DELETE | `/api/eval/templates/:id` | Delete a custom template (built-ins protected) |
| POST | `/api/eval/templates/generate` | AI-generate a template from a prompt |

### Prompts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/eval/prompts` | List all saved prompts |
| GET | `/api/eval/prompts/:id` | Get prompt manifest + version history |
| GET | `/api/eval/prompts/:id/versions/:v` | Get version content |
| POST | `/api/eval/prompts` | Create a prompt (first version) |
| POST | `/api/eval/prompts/:id/versions` | Add a new version |
| GET | `/api/eval/prompts/:id/diff?v1=1&v2=2` | Diff two versions |
| PUT | `/api/eval/prompts/:id/tools` | Update tool definitions |
| GET | `/api/eval/prompts/:id/history` | Evaluation history timeline |

### Test Suites

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/eval/test-suites` | List all test suites |
| GET | `/api/eval/test-suites/:id` | Get a test suite |
| POST | `/api/eval/test-suites` | Create a test suite |
| PUT | `/api/eval/test-suites/:id` | Update a test suite |
| DELETE | `/api/eval/test-suites/:id` | Delete a test suite |

### Evaluations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/eval/evaluations` | List evaluations (filter: status, promptId, modelId) |
| GET | `/api/eval/evaluations/:id` | Get evaluation config |
| GET | `/api/eval/evaluations/:id/results` | Get full results (all cells) |
| GET | `/api/eval/evaluations/:id/summary` | Get aggregated summary + rankings |
| POST | `/api/eval/evaluations` | Start evaluation (async, returns 202) |
| DELETE | `/api/eval/evaluations/:id` | Cancel a running evaluation |
| GET | `/api/eval/evaluations/:id/export?format=html` | Export self-contained HTML report |
| GET | `/api/eval/evaluations/:id/export?format=md` | Export Markdown report |
| POST | `/api/eval/evaluations/:id/baseline` | Save as regression baseline |
| POST | `/api/eval/evaluations/:id/diagnose` | "Why did this fail?" diagnostic |

### Models & Leaderboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/eval/models` | Available models grouped by server (proxied from LMApi) |
| GET | `/api/eval/models/leaderboard` | Aggregate model rankings across all evaluations |

### WebSocket

Connect to `ws://localhost:3200/ws/eval` for real-time evaluation progress:

| Event | Description |
|-------|-------------|
| `cell:started` | A matrix cell started executing |
| `cell:completed` | A cell completed with metrics |
| `cell:failed` | A cell failed with error message |
| `judge:started` | Judge evaluation started for a cell |
| `judge:completed` | Judge score received for a perspective |
| `eval:progress` | Overall progress update |
| `eval:completed` | Evaluation finished |
| `eval:failed` | Evaluation failed |

---

## Built-in Evaluation Templates

| Template | Perspectives (weights) | Use Case |
|----------|----------------------|----------|
| **General Quality** | Accuracy (0.3), Completeness (0.25), Instruction Following (0.25), Conciseness (0.2) | General-purpose prompts |
| **Tool Calling** | Tool Selection (0.35), Argument Quality (0.3), Reasoning (0.2), Error Handling (0.15) | Function-calling prompts |
| **Code Generation** | Correctness (0.35), Code Quality (0.25), Completeness (0.2), Efficiency (0.2) | Coding assistant prompts |
| **Instruction Following** | Explicit Instructions (0.4), Format Compliance (0.3), Constraint Adherence (0.2), No Hallucination (0.1) | Agentic/structured-output |

---

## Data Storage Layout

All data is stored as JSON files under `data/evals/` (created automatically at runtime):

```
data/evals/
├── templates/              # Built-in templates (seeded on startup)
│   └── custom/             # User-created templates
├── prompts/
│   └── {slug}/
│       ├── manifest.json   # Metadata, version list
│       ├── v1.md           # Prompt content
│       ├── v2.md           # Subsequent versions
│       └── tools.json      # Tool definitions (optional)
├── test-suites/
│   └── {slug}.json
├── evaluations/
│   └── {eval-id}/
│       ├── config.json     # What was configured and run
│       ├── results.json    # All cell responses + metrics
│       ├── summary.json    # Rankings, regression data
│       ├── report.md       # Markdown report
│       └── report.html     # Self-contained HTML report
└── baselines/
    └── {slug}.json         # Saved regression baselines
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Run Evaluation |
| `Ctrl+E` | Toggle Export menu |
| `Ctrl+D` | Toggle diff view |
| `Esc` | Close modal / overlay |
| `Ctrl+S` | Save current prompt version |

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3200` | Eval backend port |
| `LMAPI_BASE_URL` | `http://localhost:3111` | LMApi base URL |
| `LMAPI_TIMEOUT_MS` | `600000` | Completion request timeout (10 min) |
| `EVAL_COMPLETION_CONCURRENCY` | `8` | Max parallel completion requests |
| `EVAL_JUDGE_CONCURRENCY` | `4` | Max parallel judge requests |
| `EVAL_MAX_RETRIES` | `1` | Retries on transient errors (max: 3) |
