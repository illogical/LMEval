# LMEval

> **Refine your prompts with precision. Identify the best model for the job. Get deterministic, local feedback that makes every prompt engineering decision measurable.**

## Purpose

LMEval is a standalone web application for systematic prompt engineering and model evaluation. It connects to [LMApi](https://github.com/illogical/LMApi) — a local multi-model routing layer — to deliver **reproducible, deterministic, and fully private** insight into how prompt changes affect model output across every model you have available.

Prompt engineering without measurement is guesswork. LMEval replaces intuition with evidence: run side-by-side comparisons of prompt variants, evaluate responses against structured rubrics, and surface which combination of prompt and model delivers the best results for your specific use case — ranked by accuracy, speed, and consistency.

Whether you're tightening instructions, adjusting tone, restructuring context, or switching between models, LMEval gives you the feedback loop to iterate with confidence. No cloud dependencies. No per-token billing. No black-box scoring. Your models, your data, your results.

---

## Features

### MVP: Side-by-Side Prompt Comparison

- **Split-screen editor** — write two system prompts (A and B) side by side
- **Shared user message** — send the same user turn to both prompts simultaneously
- **Parallel execution** — both completions dispatch at the same time via `Promise.allSettled`
- **Syntax-highlighted responses** — atom-one-dark theme with auto-detection of Markdown, JSON, XML, and YAML
- **Per-response timing** — see server-side `duration_ms` from LMApi for each response
- **Model selector** — choose any model from your running LMApi servers, grouped by server name
- **Error resilience** — one side failing doesn't block the other; errors display inline

### Backend: Versioned Prompt Storage & CRUD API (Phase 1)

- **Versioned prompt library** — store system prompts with full version history; add new versions without losing old ones
- **Unified diff** — compare any two versions of a prompt with a structured unified diff
- **Token estimation** — rough token count estimate per version
- **Tool definition storage** — attach JSON tool definitions to prompts for function-calling evaluation
- **Test suite management** — create and manage test suites with multiple user messages, expected keywords, forbidden keywords, and JSON schema validators
- **Eval template library** — four built-in scoring rubrics (General Quality, Tool Calling, Code Generation, Instruction Following) plus unlimited custom templates
- **REST API** — Hono-based HTTP server at port 3200 with full CRUD for templates, prompts, and test suites

### Session Management (Phase 1.5)

- **Session tracking** — tie prompt pairs together as a "session" representing one comparison effort over time
- **Version history** — each time Prompt A or B changes, a new session version is created automatically
- **Drag-and-drop upload** — load `.md` or `.txt` prompt files directly into the editor panels
- **Browse file button** — alternative to drag-and-drop with file picker
- **"Use as Prompt A →"** — advance the B prompt to A position for iterative refinement workflows
- **Upload status** — subtle status strip shows "Saving…" → "Saved" with auto-dismiss

### Evaluation Engine (Phase 2)

- **N prompts × M models matrix** — evaluate every combination of prompts and models in a single run
- **Deterministic metric checks** — keyword matching, forbidden phrase detection, JSON Schema validation, tool call matching (via `ajv`)
- **Parallel execution with concurrency control** — semaphore-limited parallel dispatch (configurable via `EVAL_CONCURRENCY`)
- **Retry resilience** — automatic retry on 429/502/503/504 and network errors (configurable via `LMAPI_RETRY_COUNT`, `LMAPI_RETRY_DELAY_MS`)
- **Abort/cancel** — stop a running evaluation at any time via `DELETE /api/eval/evaluations/:id`
- **Session linking** — link evaluation runs to sessions for history tracking
- **Re-run support** — retry failed evaluations via `POST /api/eval/evaluations/:id/retry`
- **WebSocket events** — real-time `cell:started`, `cell:completed`, `eval:progress`, `eval:completed` events

### Git Integration for Prompt Versioning (Phase 2.5)

- **Git-tracked data** — initialize a git repo in `data/` to version-control prompt changes and eval results
- **Commit API** — commit changes with enforced message format (`feat|fix|chore(prompt): ...`)
- **Revert support** — revert to any previous commit via the API
- **Change log** — view git history via `GET /api/eval/git/log`

### Export & History (Phase 3)

- **HTML reports** — self-contained offline reports with dark theme, sortable tables, and tab navigation
- **Markdown reports** — shareable Markdown with model rankings, prompt rankings, and regression analysis
- **Baseline snapshots** — save evaluation summaries as baselines for regression comparison
- **Regression detection** — compare evaluations against baselines to identify performance changes
- **Prompt history** — timeline of all evaluations for a given prompt
- **Model leaderboard** — aggregate composite scores across all evaluations

### LLM-as-Judge Scoring (Phase 4)

- **Rubric-based scoring** — per-perspective 1-5 scoring dispatched via LMApi to a configurable judge model
- **Pairwise ranking** — head-to-head comparison of model responses to reduce position bias
- **Composite scores** — weighted average of perspective scores per evaluation cell
- **Auto-template generation** — analyze a system prompt and auto-propose scoring dimensions and test cases
- **Graceful parse fallback** — 4-step JSON extraction (direct parse → strip fences → regex extract → warn+skip)

### Planned: Frontend Evaluation UI (Phase 5+)

- **Three-panel layout** — resizable panels for prompts, configuration, and results
- **Heatmap scoreboard** — visual matrix of prompt × model scores
- **Live progress dashboard** — real-time updates via WebSocket with per-model progress bars
- **Results analysis** — comparison view, detail view, metrics charts, timeline view
- **Keyboard shortcuts** — `Ctrl+Enter` to run, `Ctrl+E` to export, etc.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Bun / Node.js |
| Frontend | Vite + React 19 + TypeScript |
| Styling | CSS custom properties (vaultpad dark theme) |
| Syntax highlighting | highlight.js (atom-one-dark) |
| Backend API | Hono on `@hono/node-server` |
| Storage | File-based JSON + Markdown on disk |
| JSON Schema validation | `ajv` |
| Text diffing | `diff` npm package |
| Model calls | HTTP to [LMApi](https://github.com/illogical/LMApi) |
| Testing | Vitest + Testing Library |

---

## Prerequisites

- **[LMApi](https://github.com/illogical/LMApi)** running locally on port `3111` (or configured via `LMAPI_BASE_URL`)
- **Node.js ≥ 18** or **Bun** runtime
- At least one Ollama model available through LMApi

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/illogical/LMEval.git
cd LMEval
npm install
# or: bun install
```

### 2. Configure environment (optional)

Copy `.example.env` to `.env` and adjust if your LMApi or eval server run on non-default ports:

```bash
cp .example.env .env
```

```env
PORT=3200
LMAPI_BASE_URL=http://localhost:3111
```

### 3. Start the frontend

```bash
npm run dev
# or: bun run dev
```

Navigate to [http://localhost:5173](http://localhost:5173).

### 4. Start the eval backend (Phase 1+)

```bash
npm run dev:server
# or: bun run dev:server
```

The eval API runs on [http://localhost:3200](http://localhost:3200).

---

## Using the Prompt Comparison UI

1. **Select a model** from the dropdown in the header (populated from LMApi's online servers)
2. **Enter System Prompt A** in the left editor panel — your baseline/original prompt
3. **Enter System Prompt B** in the right editor panel — your revised/candidate prompt
4. **Enter a User Message** in the shared bar below the editors
5. **Click "Run ▶"** — both completions dispatch in parallel
6. **Compare responses** — syntax-highlighted results appear side by side with server-side timing

---

## Project Structure

```
LMEval/
├── src/                        # Frontend (Vite + React + TypeScript)
│   ├── api/
│   │   ├── lmapi.ts            # getServers(), chatCompletion()
│   │   └── eval.ts             # Eval backend API client (prompts, sessions)
│   ├── components/
│   │   ├── layout/
│   │   │   └── Header.tsx      # Logo, model selector, Run button
│   │   └── prompt/
│   │       ├── PromptPanel.tsx # Dual-mode: textarea editor or response view
│   │       └── ResponseView.tsx # Syntax-highlighted response + states
│   ├── hooks/
│   │   └── useModels.ts        # Fetches and flattens LMApi server models
│   ├── types/
│   │   ├── lmapi.ts            # LMApi request/response interfaces
│   │   ├── eval.ts             # Eval system interfaces (shared with backend)
│   │   └── session.ts          # Session management types
│   ├── test/                   # Vitest unit tests
│   ├── App.tsx
│   └── index.css               # CSS custom properties, dark theme
├── server/                     # Eval backend (Hono)
│   ├── index.ts                # Server entry point (port 3200)
│   ├── ws.ts                   # WebSocket event broadcasting
│   ├── routes/
│   │   ├── templates.ts        # Template CRUD + auto-generate endpoint
│   │   ├── prompts.ts          # Prompt CRUD + history endpoint
│   │   ├── testSuites.ts       # Test suite CRUD
│   │   ├── models.ts           # LMApi model proxy + leaderboard
│   │   ├── evaluations.ts      # Eval CRUD, export, baseline endpoints
│   │   ├── sessions.ts         # Session and eval run CRUD
│   │   └── git.ts              # Git status, commit, revert, log endpoints
│   ├── services/
│   │   ├── FileService.ts      # JSON/Markdown I/O, slug generation
│   │   ├── TemplateService.ts  # Eval template management
│   │   ├── PromptService.ts    # Versioned prompt storage
│   │   ├── TestSuiteService.ts # Test case management
│   │   ├── LmapiClient.ts      # HTTP client for LMApi with retry
│   │   ├── MetricsService.ts   # JSON schema validation, keyword checking, tool call verification
│   │   ├── SummaryService.ts   # Per-model/prompt aggregation, regression detection
│   │   ├── ExecutionService.ts # Eval pipeline orchestration (matrix, completions, judge, aggregate)
│   │   ├── SessionService.ts   # Session and eval run management
│   │   ├── JudgeService.ts     # LLM judge prompt building and response parsing
│   │   ├── ReportService.ts    # HTML and Markdown report generation
│   │   └── GitService.ts       # Git operations for data versioning
│   └── types/                  # Re-exports shared types
├── data/
│   ├── evals/                  # File-based eval storage
│   │   ├── templates/          # Built-in + custom eval templates
│   │   ├── prompts/            # Versioned system prompts
│   │   ├── test-suites/        # Test case collections
│   │   ├── evaluations/        # Eval run results
│   │   └── baselines/          # Baseline snapshots for regression
│   ├── prompts/
│   │   └── judge/              # Judge system prompt files (editable markdown)
│   │       ├── rubric-system.md        # Rubric scoring prompt (uses {{PERSPECTIVE_NAME}} etc.)
│   │       ├── pairwise-system.md      # Pairwise A/B comparison prompt
│   │       └── template-generator-system.md  # Eval template auto-generation prompt
│   └── sessions/               # Session manifests and version history
├── scripts/
│   ├── seed-templates.ts       # Seed built-in eval templates
│   ├── test-api.ts             # Integration tests for the eval API
│   ├── test-sessions.ts        # Session API integration tests
│   └── test-execution.ts       # Execution pipeline integration tests
├── docs/                       # Design docs and implementation plans
├── .example.env
├── vite.config.ts
└── package.json
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite frontend dev server |
| `npm run dev:server` | Start eval backend server |
| `npm run build` | Production build |
| `npm run test` | Run Vitest unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | ESLint |
| `npm run test:api` | Run API integration tests (requires server running) |
| `npm run test:sessions` | Run session API integration tests |
| `npm run test:execution` | Run execution pipeline integration tests (requires server + LMApi) |

---

## Git Integration Workflow

The `data/` directory — which holds all prompts, sessions, and evaluation results — can be tracked as its own git repository, separate from the main LMEval source code. This lets you version-control your prompt evolution and evaluation history without mixing it with application code.

> **Human-confirmed commits only.** LMEval never commits automatically. Every commit is triggered by an explicit API call.

### Setup

```bash
# Initialize a git repo inside data/ (one-time setup)
curl -X POST http://localhost:3200/api/eval/git/init
```

This creates `data/.git/` and a `data/.gitignore` that excludes temporary files. The root `.gitignore` already excludes `data/.git/` so the nested repo is invisible to git operations on the LMEval source itself.

### How Sessions and Git Work Together

Each **session** represents one prompt-comparison project over time. Sessions contain **versions** (snapshots of the A/B prompt pair) and **eval runs** (individual evaluation executions). Git provides the low-level change history that cuts across all of these:

```
Session: "Customer Support Bot"
│
├── Version 1 — Prompt A (original) vs Prompt B (revision 1)
│   ├── Eval Run 1  →  B scores +0.4 over A  ✓
│   └── git commit: feat(prompt): improve tone, v1 baseline (+0.4 score)
│                   └─ captures: data/evals/prompts/, data/sessions/
│
├── Version 2 — Prompt A (was B) vs Prompt B (revision 2)
│   │   [click "Use as Prompt A →" in UI to advance]
│   ├── Eval Run 2  →  B scores +0.2 over A  ✓
│   └── git commit: fix(prompt): remove hallucination trigger (+0.2 score)
│
└── Version 3 — continue iterating...
    └── git revert if new B performs worse than expected
```

### Commit Message Convention

All commit messages are validated and **must** match the pattern:

```
(feat|fix|chore)(prompt): <description>
```

| Prefix | Use when |
|---|---|
| `feat(prompt):` | A new or improved prompt version that clearly outperforms the previous |
| `fix(prompt):` | Fixing a specific failure, hallucination, or format issue |
| `chore(prompt):` | Saving a baseline, reorganizing, or non-score-improving changes |

### Typical Iterative Workflow

1. **Write Prompt A and Prompt B** — drag `.md` files into the comparison UI or type directly
2. **Run an evaluation** — `POST /api/eval/evaluations` with prompt IDs, model IDs, and test suite
3. **Review results** — check scores, read the HTML report, compare responses
4. **Commit the improvement** — `POST /api/eval/git/commit` with a descriptive message
5. **Advance B → A** — click "Use as Prompt A →" in the UI to start the next iteration
6. **Repeat or revert** — continue refining, or `POST /api/eval/git/revert` to undo if a change regresses

### Useful Endpoints for Git Workflow

```bash
# Check repo status and view recent commits
GET  /api/eval/git/status

# Commit all pending data/ changes
POST /api/eval/git/commit
Body: { "message": "feat(prompt): improve brevity after eval run 3" }

# View full commit history
GET  /api/eval/git/log?limit=20

# Revert a specific commit
POST /api/eval/git/revert
Body: { "hash": "abc1234" }

# View a prompt's evaluation history over time
GET  /api/eval/prompts/:id/history
```

---

## API Endpoints

### Templates (`/api/eval/templates`)
| Endpoint | Description |
|---|---|
| `GET /api/eval/templates` | List all templates (built-in + custom) |
| `GET /api/eval/templates/:id` | Get template by ID |
| `POST /api/eval/templates` | Create custom template |
| `PUT /api/eval/templates/:id` | Update custom template |
| `DELETE /api/eval/templates/:id` | Delete custom template |
| `POST /api/eval/templates/generate` | Auto-generate template from system prompt |

### Prompts (`/api/eval/prompts`)
| Endpoint | Description |
|---|---|
| `GET /api/eval/prompts` | List all prompts |
| `GET /api/eval/prompts/:id` | Get prompt manifest |
| `POST /api/eval/prompts` | Create new prompt |
| `POST /api/eval/prompts/:id/versions` | Add new version |
| `GET /api/eval/prompts/:id/content?version=N` | Get version content |
| `GET /api/eval/prompts/:id/diff?from=1&to=2` | Unified diff between versions |
| `PUT /api/eval/prompts/:id/tools` | Update tool definitions |
| `GET /api/eval/prompts/:id/history` | Timeline of evaluations for this prompt |

### Sessions (`/api/eval/sessions`)
| Endpoint | Description |
|---|---|
| `GET /api/eval/sessions` | List all sessions |
| `GET /api/eval/sessions/:id` | Get session manifest |
| `POST /api/eval/sessions` | Create session with initial A/B prompt slots |
| `GET /api/eval/sessions/:id/active` | Get active (latest) session version |
| `GET /api/eval/sessions/:id/versions/:n` | Get specific version |
| `POST /api/eval/sessions/:id/versions` | Add new version (new A/B pair) |
| `PUT /api/eval/sessions/:id/latest` | Update latest version pointer |
| `GET /api/eval/sessions/:id/runs` | List eval runs for session |
| `POST /api/eval/sessions/:id/runs` | Add eval run |
| `PATCH /api/eval/sessions/:id/runs/:runId` | Update run status/scores |
| `DELETE /api/eval/sessions/:id` | Delete session |

### Evaluations (`/api/eval/evaluations`)
| Endpoint | Description |
|---|---|
| `GET /api/eval/evaluations` | List evaluations (filterable by status/promptId/modelId) |
| `GET /api/eval/evaluations/:id` | Get evaluation config |
| `GET /api/eval/evaluations/:id/results` | Get cell results |
| `GET /api/eval/evaluations/:id/summary` | Get aggregated summary |
| `POST /api/eval/evaluations` | Create and start evaluation |
| `DELETE /api/eval/evaluations/:id` | Cancel running evaluation |
| `POST /api/eval/evaluations/:id/retry` | Re-run failed evaluation |
| `GET /api/eval/evaluations/:id/export?format=html\|md` | Download report |
| `POST /api/eval/evaluations/:id/baseline` | Save summary as baseline |

### Models (`/api/eval/models`)
| Endpoint | Description |
|---|---|
| `GET /api/eval/models` | List models from LMApi (grouped by server) |
| `GET /api/eval/models/leaderboard` | Aggregate composite scores across all evals |

### Git (`/api/eval/git`)
| Endpoint | Description |
|---|---|
| `GET /api/eval/git/status` | Git initialization status + recent log |
| `POST /api/eval/git/init` | Initialize git repo in data/ |
| `POST /api/eval/git/commit` | Commit current changes (enforced message format) |
| `POST /api/eval/git/revert` | Revert a specific commit |
| `GET /api/eval/git/log?limit=N` | Get commit history |

---

## Built-in Eval Templates

| Template | Perspectives | Best for |
|---|---|---|
| **General Quality** | Accuracy (0.3), Completeness (0.25), Instruction Following (0.25), Conciseness (0.2) | General-purpose prompt evaluation |
| **Tool Calling** | Tool Selection (0.35), Argument Quality (0.3), Reasoning (0.2), Error Handling (0.15) | Function/tool-calling prompts |
| **Code Generation** | Correctness (0.35), Code Quality (0.25), Completeness (0.2), Efficiency (0.2) | Code generation prompts |
| **Instruction Following** | Explicit Instructions (0.4), Format Compliance (0.3), Constraint Adherence (0.2), No Hallucination (0.1) | Strict instruction adherence |

---

## Why Local & Deterministic?

Cloud-based prompt evaluation tools come with tradeoffs: cost, rate limits, data privacy concerns, and non-deterministic cloud model versioning. LMEval is designed around a different philosophy:

- **Local first** — all model calls go through your own LMApi instance; no data leaves your machine
- **Deterministic checks first** — keyword matching, JSON Schema validation, and tool call verification run before any LLM judge
- **Reproducible** — evaluation configs and results are stored as plain JSON/Markdown files you control
- **Model-agnostic** — works with any model available through LMApi (Ollama, OpenRouter, or any OpenAI-compatible endpoint)

---

## Contributing

See [`docs/prompt-eval-system/IMPLEMENTATION_PLAN.md`](docs/prompt-eval-system/IMPLEMENTATION_PLAN.md) for the full roadmap and task breakdown.
