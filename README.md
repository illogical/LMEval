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

### Planned: Full Evaluation Pipeline (Phase 2+)

- **N prompts × M models matrix** — evaluate every combination of prompts and models in a single run
- **Deterministic metric checks** — keyword matching, forbidden phrase detection, JSON Schema validation, tool call matching (via `ajv`)
- **LLM-as-judge scoring** — configurable rubric perspectives with weighted scores (1–5), dispatched via LMApi
- **Pairwise ranking** — head-to-head comparison of model responses to reduce position bias
- **WebSocket progress feed** — real-time `cell:started`, `cell:completed`, `eval:progress` events
- **Parallel execution with concurrency control** — semaphore-limited parallel dispatch (default: 8 concurrent)
- **Abort/cancel** — stop a running evaluation at any time
- **Auto-template generation** — analyze your system prompt and auto-propose scoring dimensions and test cases
- **Scoreboard & heatmap** — visual matrix of prompt × model scores, sortable leaderboard
- **Regression detection** — compare evaluation runs to identify performance regressions
- **HTML & Markdown reports** — self-contained offline report files for sharing and archiving

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
│   │   └── lmapi.ts            # getServers(), chatCompletion()
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
│   │   └── eval.ts             # Eval system interfaces (shared with backend)
│   ├── test/                   # Vitest unit tests
│   ├── App.tsx
│   └── index.css               # CSS custom properties, dark theme
├── server/                     # Eval backend (Hono)
│   ├── index.ts                # Server entry point (port 3200)
│   ├── routes/                 # templates, prompts, testSuites, models
│   ├── services/               # FileService, TemplateService, PromptService, etc.
│   └── types/                  # Re-exports shared types
├── data/evals/                 # File-based storage
│   ├── templates/              # Built-in + custom eval templates
│   ├── prompts/                # Versioned system prompts
│   ├── test-suites/            # Test case collections
│   ├── evaluations/            # Eval run results
│   └── baselines/              # Baseline snapshots for regression
├── scripts/
│   ├── seed-templates.ts       # Seed built-in eval templates
│   └── test-api.ts             # Integration tests for the eval API
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
