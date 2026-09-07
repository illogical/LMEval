# G7-G9 Classification-First Verification

**Status:** Steps 1-5 complete (non-GUI gate, classification live run, browser handoff). Step 6 (tagging, summarization, skill gate) remains, so G7, G8, and G9 stay open until it passes.

## Goal

Verify the agent-driven workflow from the API outward, starting with MemoryApi classification. Run GUI handoff checks only after the API path is trustworthy. Classification is the first G8 milestone; tagging and summarization remain required before G8 or G9 can close.

## Plan

1. Reconcile the classification purpose prompt with MemoryApi revision `c7ecb9e292947f88199c16548b88dc4fc8557a60`, including taxonomy injection, wrapper escaping, and production inference settings.
2. Add deterministic source-drift checks and extend `test:agent-workflow` with prompt reuse, explicit model lists, stratified calibration sampling, configurable inference/repetitions, persisted readback checks, result inspection, and JSON evidence output.
3. Run the non-GUI G7 gate: benchmark checks, focused tests, full unit tests, lint, standalone build, hosted frontend build, host adapter build, and API integration scripts.
4. Run a retained classification model comparison using one pinned prompt, `Localhost::qwen3.5:9b` and `Localhost::gemma3:12b`, eight stratified calibration cases, three repetitions, temperature `0.3`, and `maxTokens: 50` (48 candidate calls).
5. After the API run passes, execute focused and broader Playwright coverage plus manual standalone/hosted path checks.
6. Repeat the API-first workflow for tagging and summarization. Only then validate and behavior-test the existing workflow skill and update G7-G9 status.

## Findings Before Implementation

- The checked-in classification purpose prompt was not byte-equivalent to MemoryApi's pinned `categorization.txt` rendered with `src/samples/allCategories.json`; it lacked the current untrusted-`<memory>` instruction and contained different examples/instructions.
- The existing agent harness selected the first three calibration cases, which were all `Preference`, forced one repetition, used `maxTokens: 1000`, created a new timestamped prompt on every run, and did not inspect results or emit durable evidence.
- The previous classification evaluation therefore established mechanics only despite returning a `pass` verdict: it had three same-class cases and could not support representative quality or promotion conclusions.
- All `shape:injection` classification cases are in the sealed regression split. The requested bounded calibration run can cover every category plus clear/boundary/noisy shapes, but it must not claim adversarial-injection coverage without exposing regression data. This plan resolves that conflict in favor of regression-split protection.
- The benchmark and review ledger remain `pending-human-review`, so no result is promotion-ready.
- MemoryApi's consumed source files are clean at the pinned revision. Unrelated edits exist only in two MemoryApi planning documents and must be preserved.

## Evidence Log

This section is updated as commands and live runs complete. Automated, live-model, browser, and skill evidence are recorded separately.

### Automated and API gate

Complete, all green:
- `npm run benchmarks:check --memory-api-root=<MemoryApi checkout>` — verified classification=64, tagging=72, summarization=36 (no drift from the pinned MemoryApi revision).
- `npm run lint` — clean.
- `npx vitest run` — 297/297 passed (43 files). This run first surfaced 4 failing tests in `src/test/pages/ResultsPage.test.tsx`; see bug fix below.
- `npm run build`, `npm run build:hosted`, `npm run build:host` — all succeeded.
- `npm run test:api` (20 checks), `npm run test:sessions` (10 checks), `npm run test:e2e-api` (64 checks, including one full live evaluation run through completion) — all passed.

**Bug found and fixed:** `src/pages/ResultsPage.tsx`'s loading effect had been changed (in this round of staged work) from a synchronous `setLoading(true)` to `setTimeout(() => setLoading(true), 0)` with a cleanup. Because the API calls it awaits resolve as microtasks (both in mocked tests and in practice against a fast local server), `.finally(() => setLoading(false))` fired before the deferred timer callback, which then flipped `loading` back to `true` immediately after real data had loaded — permanently re-entering the loading skeleton. This caused both the 4 vitest failures and (see below) the recorded Playwright navigation-timeout symptom. Fixed by reverting to the synchronous `setLoading(true)`. All 297 unit tests pass after the fix.

### Classification live run

Complete (from `docs/plans/2026-09-06-g7-g9-classification-first-evidence.json`): 48 candidate calls (8 stratified calibration cases × `Localhost::qwen3.5:9b` and `Localhost::gemma3:12b` × 3 repetitions, temperature 0.3, maxTokens 50). `gemma3:12b` reached 87.5% accuracy; `qwen3.5:9b` returned empty responses with `finishReason: "length"` on every call. Prompt reuse confirmed via SHA256, readback/inspection checks all passed. The qwen failure looks like a token-budget artifact of `maxTokens: 50` rather than a genuine classification failure — **not yet re-verified with a larger `maxTokens`**, so the model comparison should not be treated as a final verdict on qwen until that's rerun.

### Browser handoff

Complete, all 30 Playwright specs pass (`npx playwright test`), including `wizard-happy-path.spec.ts` end-to-end.

Two more issues were found and fixed getting here:
1. **Same root cause as the ResultsPage bug above** — the wizard test originally timed out waiting for `/eval/results/...` navigation after eval completion. This is not a separate bug; fixing `ResultsPage.tsx`'s loading race was part of it, but the deeper cause was:
2. **`wizard-happy-path.spec.ts` had a stale expectation.** The app deliberately does not auto-navigate from the run page to results on `eval:completed` (auto-navigate was intentionally removed in favor of a manual "View Results" button — confirmed via `git log -p` showing a commented-out `setTimeout(() => navigate(...))`). The test's comment ("eval:completed navigates to results") no longer matched the product's actual behavior. Fixed the test to wait for and click "View Results" rather than waiting on an automatic URL change.
3. **Three test files hardcoded `http://localhost:3200`** (`agent-draft-handoff.spec.ts`, `step3-run.spec.ts`, `step4-results.spec.ts`) instead of using relative paths through the Playwright `baseURL` proxy. This is pre-existing, not part of this round's staged diff, but it meant `agent-draft-handoff.spec.ts` silently self-skipped (`test.skip(!modelsResponse.ok(), ...)`) whenever the real server wasn't also listening on the wrong port 3200 — which happened to be true only by coincidence of stray leftover processes during this session. Fixed by switching all six occurrences to relative paths so they go through the configured server (this repo's `.env` sets `PORT=17105`).

**Environment note:** the backend depends on an external LMApi instance (`LMAPI_BASE_URL`, see README) for model discovery. Neither `.env` values (`PORT`, `LMAPI_BASE_URL`) nor Node's env loading applied automatically when starting `npx tsx server/index.ts` or `npm run dev` directly in this session — they had to be exported into the shell explicitly before starting the server for `gemma3:12b` (served by the user's LMApi instance) to be discoverable. Worth confirming with the user whether their normal shell profile exports these, since the repo itself has no dotenv wiring.

### Tagging, summarization, and skill gate

Pending. These remain blockers for G8 and G9 completion.
