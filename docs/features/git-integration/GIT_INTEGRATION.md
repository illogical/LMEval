# Git Integration for Prompt Versioning

> **Phase**: 2.5 — implement after Phase 2 (Evaluation Engine), before Phase 3 (LLM Judge)
>
> **Purpose**: Use git to track prompt improvements over time. Each time a prompt change produces a measurable score improvement, it can be committed with a structured message. Regressions can be reverted instantly. The history becomes a log of what actually improved your prompts and by how much.

---

## Concept

The `data/` directory contains everything that LMEval produces: prompts, sessions, eval results, templates. By initializing a git repository there, every file write becomes a candidate for versioning.

This is **human-confirmed** in Phase 2.5. The user reviews eval results and clicks "Commit Improvement" or "Revert to Previous." Automation comes later in Phase 8 (Automated Refinement Loop).

### Conventional Commit Format

All commits use structured messages so the history is machine-parseable for the automated loop:

```
feat(prompt): improve {session-name} (+{delta} score)
fix(prompt): revert {session-name} - score regressed
chore(session): create session {session-name}
```

Examples:
```
feat(prompt): improve customer-support-refine (+0.4 score)
fix(prompt): revert customer-support-refine - score regressed (-0.2)
```

---

## Folder Scope

Git is initialized in `data/` only — **not** in the project root. This keeps prompt/eval versioning separate from application code versioning.

```
data/
├── .git/              ← git repo for eval data
├── evals/
│   └── prompts/
│       └── {slug}/
│           └── v1.md, v2.md ...
└── sessions/
    └── {slug}/
        └── manifest.json, v1.json, v2.json ...
```

The project's root `.gitignore` should include `data/.git/` to prevent nesting git repos if the project is already in git.

---

## Backend: GitService

**File: `server/services/GitService.ts`**

All git operations are scoped to `DATA_ROOT = join(process.cwd(), 'data')`.

Uses `child_process.execFile` (not `exec`) to prevent shell injection. All arguments are passed as a string array.

```typescript
export const DATA_ROOT = join(process.cwd(), 'data');

interface GitLogEntry {
  hash: string;
  subject: string;
  date: string;   // ISO 8601
}

const GitService = {
  /**
   * Check if data/ is already a git repo.
   */
  isInitialized(): boolean,

  /**
   * Run `git init` in the data/ directory.
   * Safe to call if already initialized (git init is idempotent).
   */
  async init(): Promise<void>,

  /**
   * Return short git status output.
   * Returns empty string if repo is clean.
   */
  async status(): Promise<string>,

  /**
   * Stage all changes and commit with the provided message.
   * Returns the short commit hash.
   * Throws if working tree is clean (nothing to commit).
   */
  async commit(message: string): Promise<{ hash: string }>,

  /**
   * Return the last N commits as structured log entries.
   */
  async log(limit?: number): Promise<GitLogEntry[]>,

  /**
   * Revert a specific commit by hash using `git revert --no-edit`.
   * Creates a new revert commit — does not discard history.
   */
  async revert(hash: string): Promise<void>,
};
```

### Shell injection prevention

```typescript
// CORRECT — execFile with arg array
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Example: git commit
await execFileAsync('git', ['-C', DATA_ROOT, 'commit', '-m', message]);

// NEVER do this:
// exec(`git -C ${DATA_ROOT} commit -m ${message}`)  ← shell injection risk
```

---

## REST API Routes

**File: `server/routes/git.ts`**
**Registered at: `/api/eval/git`**

```
GET  /api/eval/git/status
     → { initialized: boolean, status: string, log: GitLogEntry[] }
     log contains last 10 commits (or empty array if not initialized)

POST /api/eval/git/init
     → { success: true }
     Idempotent — safe to call multiple times

POST /api/eval/git/commit
     Body: {
       message: string,          // full commit message
       sessionId?: string,       // optional — link commit to a session run
       runId?: string
     }
     Validates message matches pattern: /^(feat|fix|chore)\(prompt\):/
     Calls GitService.commit(message)
     If sessionId + runId provided: calls SessionService.updateEvalRun() to set
       committedAt and commitHash on the EvalRun
     → { hash: string }

POST /api/eval/git/revert
     Body: { hash: string }
     Validates hash is non-empty, alphanumeric+hyphen only (no shell chars)
     Calls GitService.revert(hash)
     → { success: true }

GET  /api/eval/git/log
     Query: ?limit=N (default 10, max 100)
     → GitLogEntry[]
```

**Registration in server/index.ts:**
```typescript
import { gitRouter } from './routes/git';
app.route('/api/eval/git', gitRouter);
```

**Startup check:**
On server start, check `GitService.isInitialized()`. Log a warning if not initialized:
```
[git] data/ is not a git repo. Run POST /api/eval/git/init to enable prompt versioning.
```
Git routes remain functional regardless — the user initializes on demand.

---

## Frontend Integration

### "Commit Improvement" Button

Shown in the results area after an eval run completes with a positive `scoreDelta`.

```
┌─────────────────────────────────────────────────────┐
│  Prompt B scored +0.4 over Prompt A                 │
│                                                     │
│  [✓ Commit Improvement]  [↩ Revert to Previous]    │
└─────────────────────────────────────────────────────┘
```

Clicking "Commit Improvement":
1. Pre-fills a commit message: `feat(prompt): improve {session.name} (+{delta} score)`
2. Shows an inline text field so the user can edit the message before committing
3. Calls `POST /api/eval/git/commit` with `{ message, sessionId, runId }`
4. On success: shows the short commit hash with a brief "Committed" toast
5. The button changes to a disabled "Committed ✓" state for this run

### "Revert to Previous" Button

Shown when `GET /api/eval/git/log` returns at least 1 commit.

Clicking "Revert to Previous":
1. Shows a confirmation dialog: "This will revert commit: {last commit subject} ({date}). Continue?"
2. Calls `POST /api/eval/git/revert` with `{ hash: lastCommit.hash }`
3. On success: toast "Reverted — prompt content restored to previous state"
4. Prompts the user to reload prompt content (or auto-reloads from backend)

### Git Status Indicator (optional, header)

A small indicator in the header (or settings sidebar) showing:
- `●` green dot + "Git enabled" when initialized and clean
- `●` amber dot + "Uncommitted changes" when dirty
- `○` gray dot + "Git not set up" with link to initialize

---

## .gitignore for data/

When `POST /api/eval/git/init` is called, also write `data/.gitignore`:

```gitignore
# Do not version temporary or binary files
*.tmp
node_modules/
```

---

## Future: Automated Commits (Phase 8)

In Phase 8, the refinement loop will call git operations directly:

- After a successful iteration (score improved): auto-commit with `feat(prompt): ...`
- After a regression (score dropped): auto-revert with `fix(prompt): revert ...`

The `GitService` API is designed to support this without changes — Phase 8 just calls the same methods programmatically from `RefinementService`.

---

## Verification

1. `POST /api/eval/git/init` → `data/.git/` created; subsequent call returns success (idempotent)
2. Create a prompt + session → `POST /api/eval/git/commit` with valid message → `data/.git/` shows one commit
3. `GET /api/eval/git/log` returns the commit with correct hash/subject/date
4. `POST /api/eval/git/commit` with invalid message (doesn't match pattern) → 400 error
5. `POST /api/eval/git/revert` with last commit hash → changes undone; `git log` shows revert commit
6. Attempt `POST /api/eval/git/commit` with shell metacharacter in message → blocked by validation (message sanitized or rejected)
7. UI: "Commit Improvement" button pre-fills correct message, hash shown after commit
