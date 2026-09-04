# Fix: Results page blank / crashes with `Cannot read properties of undefined (reading 'length')`

## Symptom

Navigating to `/eval/results/:id` (Step 4 of the eval wizard) rendered only the page background — no content — with this browser console error:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'length')
    at s3 (index-C_Rx6uQr.js:29:8859)
    ...
```

The stack trace pointed into React's render/commit internals rather than app code, since the bundle was minified for production.

## Root cause

A response-shape mismatch between backend and frontend for the evaluation results endpoint:

- `GET /api/eval/evaluations/:id/results` (`server/routes/evaluations.ts`) read `results.json` and returned it **as-is** — a bare `EvalMatrixCell[]` array. This matched how it was written (`writeJson(join(evalDir, 'results.json'), cells)` in `server/services/ExecutionService.ts`) and how `ReportService.ts` already read it back for HTML/Markdown export (`readJson<EvalMatrixCell[]>(...)`).
- The frontend client (`getEvaluationResults` in `src/api/eval.ts`) declared the return type as `{ cells: EvalMatrixCell[] }` — a wrapper object that never actually existed on the wire.
- `ResultsPage.tsx` trusted that type and destructured accordingly: `setCells(resultsData.cells)`. Since the real response was the array itself, `resultsData.cells` was always `undefined`.
- The default active tab is `'scoreboard'`, which renders `Scoreboard` → `HeatmapMatrix`, whose first line is `if (cells.length === 0) ...`. With `cells` undefined, this threw immediately on mount — matching the observed error and the "blank page" symptom (an uncaught render error with no error boundary unmounts the whole tree).

This reproduced on every completed evaluation, 100% of the time — not a stale-data or missing-field issue.

## Fix

Aligned the frontend to the backend's real (and already-established) response shape, rather than changing the backend/on-disk format (which would have required also touching `ReportService.ts` and the on-disk `results.json` format):

1. **`src/api/eval.ts`** — `getEvaluationResults` now returns `Promise<EvalMatrixCell[]>` directly instead of `Promise<{ cells: EvalMatrixCell[] }>`.
2. **`src/pages/ResultsPage.tsx`** — `.then(([resultsData, summaryData]) => { setCells(resultsData); ... })` now uses `resultsData` directly instead of `resultsData.cells`.
3. **`src/test/pages/ResultsPage.test.tsx`** — updated the `getEvaluationResults` mock to resolve `[]` instead of `{ cells: [] }`.

`src/pages/DashboardPage.tsx` already defensively handled both shapes (`Array.isArray(r) ? r : (r as { cells?: EvalMatrixCell[] }).cells ?? []`), so it required no change — likely a prior workaround for this same bug in a different code path.

## Verification

- `npx vitest run` — all 122 tests pass (18 files).
- Manually confirm in the browser: run `npm run dev`, navigate to `/eval/results/:id` for a completed evaluation, and verify the Scoreboard tab (heatmap + leaderboards) renders instead of a blank page, with no console errors. Click through Compare, Detail, Metrics, and Timeline tabs to confirm `cells` populates correctly everywhere.
