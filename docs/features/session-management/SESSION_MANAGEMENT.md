# Session Management

> **Phase**: 1.5 — implement before Phase 2 (Evaluation Engine)
>
> **Purpose**: A *session* represents one prompt comparison effort over time. It ties together the two prompts being compared, their version history, and all evaluation runs performed against them. Sessions are the top-level unit of work in LMEval.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Session** | One prompt-comparison project (e.g. "Customer Support Refinement") |
| **Session Version** | A snapshot of which Prompt A and Prompt B are under comparison at a point in time |
| **Eval Run** | One execution of an evaluation config against a session version |
| **Score Summary** | Cached A/B scores on an EvalRun, populated after the eval completes |

### Versioning Rule

**A new session version is created when either Prompt A or Prompt B changes.**

Changing only the eval configuration (test suite, judge model, run count, etc.) does **not** create a new session version — it creates a new eval run within the same version. Each eval run records its own config snapshot so nothing is lost.

This keeps the version history focused on prompt evolution: version N always means "exactly this A/B pair."

---

## Folder Structure

Sessions live at `data/sessions/` — a sibling of `data/evals/`, not inside it. Sessions are a higher-level concept that *reference* evals.

```
data/
├── evals/                          # existing — prompt content, eval results
│   └── prompts/{slug}/
│       ├── manifest.json
│       └── v1.md, v2.md ...
└── sessions/                       # NEW
    ├── .gitkeep
    └── {session-slug}/
        ├── manifest.json           # SessionManifest — index + version list
        ├── v1.json                 # SessionVersion for version 1
        ├── v2.json                 # SessionVersion for version 2
        └── runs/
            ├── {runId}.json        # EvalRun linking session version → eval result
            └── {runId}.json
```

**Design notes:**
- `v{n}.json` filenames mirror the `v{n}.md` pattern used in the prompts directory.
- `runs/` is a flat folder so a single `listDir` call retrieves all runs; filtering by `sessionVersion` happens in memory.
- Session records never duplicate prompt content — they reference `promptId` + `promptVersion` from `data/evals/prompts/`.

---

## TypeScript Types

**File: `src/types/session.ts`**

```typescript
/**
 * Reference to a specific version of a stored prompt.
 * promptId → data/evals/prompts/{slug}/manifest.json
 * promptVersion → v{promptVersion}.md in that prompt's folder
 */
export interface SessionSlot {
  promptId: string;       // e.g. "prm-abc123-xyz789"
  promptVersion: number;  // e.g. 2
}

/**
 * Lightweight metadata stored in manifest.json versions[].
 * Mirrors PromptVersionMeta — do not store content here.
 */
export interface SessionVersionMeta {
  version: number;
  createdAt: string;      // ISO 8601
  description?: string;   // e.g. "Improved B after first run"
  promptA: SessionSlot;
  promptB: SessionSlot;
}

/**
 * Full version data stored as data/sessions/{slug}/v{n}.json
 */
export interface SessionVersion {
  sessionId: string;
  version: number;
  createdAt: string;
  description?: string;
  promptA: SessionSlot;
  promptB: SessionSlot;
  evalRunIds: string[];    // ordered list of EvalRun IDs within this version
}

/**
 * Root manifest stored at data/sessions/{slug}/manifest.json
 */
export interface SessionManifest {
  id: string;             // "ses-{timestamp}-{random}"
  slug: string;           // url-safe, e.g. "customer-support-refinement"
  name: string;           // human-readable display name
  description?: string;
  latestVersion: number;  // pointer to the current active version number
  versions: SessionVersionMeta[];
  createdAt: string;
  updatedAt: string;
}

/**
 * One evaluation run linked to a session version.
 * Stored at data/sessions/{slug}/runs/{runId}.json
 *
 * Multiple EvalRuns can exist within the same session version —
 * each represents a separate execution (different config, retry, etc.)
 */
export interface EvalRun {
  id: string;             // "run-{timestamp}-{random}"
  sessionId: string;
  sessionVersion: number;
  evalId: string;         // references data/evals/evaluations/{evalId}/config.json
  createdAt: string;
  completedAt?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Cached score snapshot — populated by ExecutionService after aggregate() */
  scoreSummary?: {
    promptAScore?: number;    // avg composite score across prompt A cells
    promptBScore?: number;    // avg composite score across prompt B cells
    scoreDelta?: number;      // promptBScore - promptAScore (positive = B wins)
    totalCells: number;
    completedCells: number;
    failedCells: number;
  };
  notes?: string;             // human annotation added after review
  committedAt?: string;       // set when a git commit was made for this run
  commitHash?: string;        // git commit hash
}

/**
 * An LLM-generated suggestion for improving a prompt.
 * Produced by RefinementService; reviewed and applied by the user (Phase 8).
 */
export interface ImprovementSuggestion {
  id: string;
  targetSlot: 'A' | 'B';
  currentContent: string;
  revisedContent: string;
  rationale: string;
  estimatedImpact?: string;
}
```

---

## Backend: SessionService

**File: `server/services/SessionService.ts`**

Follows the same pattern as `PromptService` — a plain exported object with async methods, all I/O via `FileService` helpers.

### New constant in FileService

```typescript
export const SESSIONS_DIR = join(process.cwd(), 'data', 'sessions');
```

### Methods

| Method | Signature | Description |
|---|---|---|
| `list` | `() => SessionManifest[]` | Returns all sessions sorted by `updatedAt` desc |
| `get` | `(id: string) => SessionManifest \| null` | Find manifest by ID (scans slugs) |
| `getBySlug` | `(slug: string) => SessionManifest \| null` | Direct path read |
| `getVersion` | `(sessionId, version) => SessionVersion \| null` | Read `v{n}.json` |
| `getActiveVersion` | `(sessionId) => SessionVersion \| null` | Read `v{latestVersion}.json` |
| `create` | `(data) => SessionManifest` | Create session + v1.json; validate slots against PromptService |
| `createVersion` | `(sessionId, data) => SessionVersion` | Add new version, update manifest |
| `setLatestVersion` | `(sessionId, version) => SessionManifest \| null` | Update `latestVersion` pointer |
| `addEvalRun` | `(sessionId, sessionVersion, evalId) => EvalRun` | Create run record, append to version's `evalRunIds` |
| `getEvalRun` | `(sessionId, runId) => EvalRun \| null` | Read single run file |
| `listEvalRuns` | `(sessionId, sessionVersion?) => EvalRun[]` | List all runs, optionally filtered |
| `updateEvalRun` | `(sessionId, runId, patch) => EvalRun \| null` | Merge patch into run record |
| `delete` | `(sessionId) => boolean` | Remove entire session directory |

---

## REST API Routes

**File: `server/routes/sessions.ts`**
**Registered at: `/api/eval/sessions`**

```
GET    /api/eval/sessions
       → list all sessions

GET    /api/eval/sessions/:id
       → get session manifest by ID

GET    /api/eval/sessions/:id/active
       → get the active (latest) session version

GET    /api/eval/sessions/:id/versions/:version
       → get a specific session version

POST   /api/eval/sessions
       Body: { name, promptA: SessionSlot, promptB: SessionSlot, description? }
       Validates promptId + promptVersion exist via PromptService
       → 201 SessionManifest

POST   /api/eval/sessions/:id/versions
       Body: { promptA: SessionSlot, promptB: SessionSlot, description? }
       → 201 SessionVersion

PUT    /api/eval/sessions/:id/latest
       Body: { version: number }
       → 200 SessionManifest

GET    /api/eval/sessions/:id/runs
       Query: ?version=N (optional filter)
       → EvalRun[]

POST   /api/eval/sessions/:id/runs
       Body: { sessionVersion: number, evalId: string }
       → 201 EvalRun

PATCH  /api/eval/sessions/:id/runs/:runId
       Body: Partial<EvalRun>
       → 200 EvalRun

DELETE /api/eval/sessions/:id
       → 200 { success: true }
```

### Registration in server/index.ts

```typescript
import { sessionsRouter } from './routes/sessions';
app.route('/api/eval/sessions', sessionsRouter);
```

---

## Integration with Evaluation Engine (Phase 2)

When creating an evaluation, the client may optionally pass session context:

```
POST /api/eval/evaluations
Body: {
  ...EvaluationConfig,
  sessionId?: string,
  sessionVersion?: number
}
```

If `sessionId` is present:
1. Immediately after writing `config.json`, call `SessionService.addEvalRun(sessionId, sessionVersion, evalId)`.
2. Return `evalRunId` in the 202 response alongside the eval config.
3. After `ExecutionService.aggregate()` writes `summary.json`, extract `promptAScore` / `promptBScore` from `EvaluationSummary.promptSummaries` and call `SessionService.updateEvalRun(sessionId, runId, { status: 'completed', completedAt, scoreSummary })`.
4. On failure, call `updateEvalRun(..., { status: 'failed' })`.

### How scoreSummary is populated

After `aggregate()`, the `EvaluationSummary.promptSummaries` array contains one entry per prompt:

```typescript
[
  { promptId: "prm-abc", promptVersion: 1, avgCompositeScore: 3.8, ... },  // A
  { promptId: "prm-xyz", promptVersion: 2, avgCompositeScore: 4.2, ... },  // B
]
```

Match these to the session version's `promptA.promptId` and `promptB.promptId` to populate `scoreSummary`.

---

## Eval Retry (manual, post-completion)

Any eval run — completed or failed — can be re-run:

```
POST /api/eval/evaluations/:id/retry
Body: { sessionId?, sessionVersion?, failedCellsOnly?: boolean }
```

- Creates a new `EvaluationConfig` scoped to failed cells only (if `failedCellsOnly: true`), or a full re-run.
- Calls `SessionService.addEvalRun()` to link the new eval to the same session version.
- Returns a new `{ evalId, evalRunId }` — the client polls/listens to this new ID.
- The session accumulates `evalRunIds: [run1, run2, run3]`; the UI shows a run selector.

---

## Real-Time Progress Data

The `EvalRun` record is the source of truth for timing in the UI:

| Field | Source | UI use |
|---|---|---|
| `EvalRun.createdAt` | Set when run is created | "Started at HH:MM:SS" |
| Elapsed (computed) | `Date.now() - new Date(createdAt)` | Live `HH:MM:SS` counter |
| `EvalRun.completedAt` | Set by `updateEvalRun` | "Finished at HH:MM:SS" |
| Running token total | Accumulated from `cell:completed` WS events | Live token counter |

The existing `EvalStreamEvent` type already carries `durationMs` and token counts on `cell:completed` — the frontend accumulates these into a running total.

---

## Failure Feedback

The `EvalMatrixCell` type should be extended to preserve failure context:

```typescript
// Additions to EvalMatrixCell in src/types/eval.ts:
retryAttempts?: {
  attemptNumber: number;
  error: string;
  timestamp: string;
}[];
```

```typescript
// Addition to JudgeResult in src/types/eval.ts:
rawJudgeResponse?: string;   // unparsed judge output before the fallback parse chain
```

The failure detail view surfaces:
- Full raw model response (monospace, scrollable)
- Error type (timeout, malformed JSON, model refusal, judge parse failure)
- Judge's unparsed output (the 4-step fallback chain captures this — store and expose it)
- Deterministic check breakdown (which keywords failed, which JSON schema paths failed)
- Per-attempt retry history with timestamps and error messages
