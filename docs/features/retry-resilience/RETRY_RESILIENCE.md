# Retry Resilience

> **Phase**: Referenced in Phase 2 (Evaluation Engine) and Phase 7 (Polish). Core retry logic implemented in Phase 2 alongside LmapiClient; UI for failure display in Phase 5/6; manual re-run in Phase 5.
>
> **Purpose**: LMApi calls can fail due to model timeouts, OOM errors, 5xx responses, or network issues. Without retry logic, a single transient failure causes an entire eval cell to be marked as failed, wasting the rest of that run. With configurable retries, individual cells can recover without aborting the evaluation.

---

## Retry Configuration (.env)

Add to `.example.env`:

```env
# Number of times to retry a failed LMApi call before marking the cell as failed
# Default: 3 | Set to 0 to disable retries
LMAPI_RETRY_COUNT=3

# Milliseconds to wait before the first retry. Subsequent retries multiply this
# by the attempt number (attempt 1: 2000ms, attempt 2: 4000ms, attempt 3: 6000ms)
# Default: 2000
LMAPI_RETRY_DELAY_MS=2000
```

These are **server-level defaults** applied to all LMApi calls. The eval config UI does not expose these — they are infrastructure settings, not evaluation parameters.

---

## Where Retry Logic Lives

Retry is implemented in **`LmapiClient.ts`**, not in `ExecutionService`. This means:
- All LMApi calls retry automatically: eval cell completions, judge calls, improvement suggestion calls
- `ExecutionService` doesn't need to know about retries — it just calls `LmapiClient.chatCompletion()` and gets a result or a final error
- `JudgeService`, `RefinementService`, and any future LMApi consumers get retry for free

### LmapiClient retry wrapper

```typescript
// server/services/LmapiClient.ts

const RETRY_COUNT = parseInt(process.env.LMAPI_RETRY_COUNT ?? '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.LMAPI_RETRY_DELAY_MS ?? '2000', 10);

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = RETRY_COUNT,
  delayMs = RETRY_DELAY_MS,
  context = 'LMApi call'
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (!isRetryable(err)) throw err;  // don't retry 4xx client errors
      if (attempt < retries) {
        const wait = delayMs * (attempt + 1);  // linear backoff: 2s, 4s, 6s
        console.warn(`[retry] ${context}: attempt ${attempt + 1} failed (${(err as Error).message}), retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  throw lastError!;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof LmapiError) {
    // Retry on: 429 (rate limit), 502, 503, 504 (transient server errors), timeout
    return [429, 502, 503, 504].includes(err.statusCode) || err.isTimeout;
  }
  // Network errors (ECONNRESET, ETIMEDOUT, etc.) are retryable
  if (err instanceof Error && err.message.match(/timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/i)) {
    return true;
  }
  return false;
}
```

**Non-retryable errors** (throw immediately):
- `400 Bad Request` — malformed request, won't succeed on retry
- `401 Unauthorized` — auth issue, retry won't help
- `404 Not Found` — model not found
- `422 Unprocessable Entity` — validation error

---

## Cell-Level Failure Tracking

When a cell exhausts all retries, `ExecutionService` marks it as failed and continues with the remaining cells. The evaluation is never aborted due to individual cell failures.

### Additions to EvalMatrixCell type

```typescript
// Additions to EvalMatrixCell in src/types/eval.ts:

/** History of retry attempts before final success or failure */
retryAttempts?: {
  attemptNumber: number;
  error: string;
  timestamp: string;   // ISO 8601
}[];

/** The final error message if this cell ultimately failed */
error?: string;

/** Error category for display and diagnosis */
errorType?: 'timeout' | 'model_error' | 'parse_failure' | 'judge_parse_failure' | 'network' | 'unknown';
```

`ExecutionService` populates `retryAttempts` on each failed attempt before the final retry exhaustion. This preserves the full failure context for the failure feedback panel.

---

## Partial Evaluation Results

When some cells fail after retry exhaustion:

1. The evaluation status is still `'completed'` (not `'failed'`) — the run completed, just with some cells failed
2. `EvalRun.scoreSummary.failedCells` is populated with the count
3. `summary.json` includes a `failedCells` summary: which models, which test cases were affected
4. The evaluation UI shows a partial results banner: "24/28 cells completed — 4 cells failed (click to view)"

An evaluation is only marked `'failed'` when it cannot start or encounters an unrecoverable error before any cells complete.

---

## Manual Eval Re-Run (Post-Completion)

After an eval completes (even fully), any eval run can be re-run via the UI:

### API Endpoint

```
POST /api/eval/evaluations/:id/retry
Body: {
  sessionId?: string,
  sessionVersion?: number,
  failedCellsOnly?: boolean   // default: true when there are failed cells
}
```

Behavior:
1. Read original `config.json` from the source eval
2. If `failedCellsOnly: true`, filter `EvaluationConfig` to only the cells that have `status: 'failed'`
3. Write a new `config.json` under a new eval ID
4. Call `ExecutionService.run(newEvalId)` async
5. If `sessionId` provided: call `SessionService.addEvalRun(sessionId, sessionVersion, newEvalId)`
6. Return 202 `{ evalId: newEvalId, evalRunId? }`

The original eval is preserved — the retry creates a new eval record, not an in-place update.

### Session Eval Run Selector

When a session version has multiple eval runs, the UI shows a run selector:

```
Eval Run:  [Run 1 ✓]  [Run 2 ✓]  [Run 3 (partial ⚠)]  [+ Retry]
```

Each run shows its completion status at a glance. Clicking a run loads its results. "Retry" creates a new run pre-scoped to the failed cells of the selected run.

---

## Failure Display in the UI

### Heatmap Cell Indicators

Failed cells in the results heatmap show:
- Rose-colored background (`var(--error)` at low opacity)
- Error icon (⚠) in the cell corner
- Tooltip on hover: "Failed after 3 retries: timeout"

### Failure Detail Panel

Accessible by clicking a failed cell or the error banner. Shows:

```
┌──────────────────────────────────────────────────────────┐
│ Cell Failed: Model qwen3:32b — Test Case "Tool Selection"│
├──────────────────────────────────────────────────────────┤
│ Error Type: Timeout (3 retries exhausted)                │
│                                                          │
│ Retry History                                            │
│   Attempt 1 — 14:02:31 — "Request timeout after 30s"    │
│   Attempt 2 — 14:02:35 — "Request timeout after 30s"    │
│   Attempt 3 — 14:02:43 — "Request timeout after 30s"    │
│                                                          │
│ Partial Response (if any)                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │ {"type": "function", "name": "search_prod...     │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│ [↻ Retry this cell]                                      │
└──────────────────────────────────────────────────────────┘
```

For judge parse failures (not timeout), the panel additionally shows:
- **Judge's raw output**: the exact text the judge model returned before parse failure
- **Parse error**: which step of the fallback chain failed and why
- This context is especially useful for diagnosing eval configuration issues

---

## Real-Time Progress Display

The execution UI must show timing data live. Timing sources:

| Data | Source | Update frequency |
|---|---|---|
| Start time | `EvalRun.createdAt` | Once (on run creation) |
| Elapsed time | `Date.now() - new Date(createdAt)` | Every 1 second (frontend timer) |
| End time | `EvalRun.completedAt` (from `eval:completed` WS event) | Once |
| Per-cell duration | `cell:completed` WS event → `durationMs` | Per cell |
| Running token total | `cell:completed` WS event → `usage.total_tokens` | Per cell |
| Per-model token totals | Accumulated from `cell:completed` events | Per cell |

The frontend accumulates these from the WebSocket stream — no polling required.

Timer display format:
- Elapsed: `HH:MM:SS` (e.g. "00:03:47")
- Start/End: locale `toLocaleTimeString()` (e.g. "2:03:31 PM")
- Duration: if < 60s show seconds, otherwise `Xm Ys`

Token display:
- Running total: "1,247 tokens (↑ 842 in / ↓ 405 out)"
- Updates with each `cell:completed` event

---

## Verification

1. Set `LMAPI_RETRY_COUNT=2` and `LMAPI_RETRY_DELAY_MS=500` in `.env`
2. Simulate a transient failure (mock LMApi to return 503 twice then succeed) → cell completes after 2 retries; `retryAttempts` has 2 entries
3. Simulate persistent failure (mock LMApi always returns 503) → after 3 attempts, cell marked `status: 'failed'`; eval continues with other cells
4. Check `summary.json` has `failedCells: 1` and identifies which model/test case failed
5. `POST /api/eval/evaluations/:id/retry` with `failedCellsOnly: true` → new eval created scoped to only the failed cells; linked to same session if `sessionId` provided
6. UI: failed cells shown with rose background + ⚠ icon; clicking opens failure detail panel with retry history
7. Real-time display: start time shown immediately; elapsed counter increments every second; token count grows with each completed cell
8. 400-class errors are not retried: mock LMApi to return 400 → single attempt, immediate failure, no retries logged
