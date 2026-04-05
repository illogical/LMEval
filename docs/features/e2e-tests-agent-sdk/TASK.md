# E2E Testing & Agent SDK — Task Tracker

Full plan: [E2E_TESTING_AND_AGENT_SDK.md](../E2E_TESTING_AND_AGENT_SDK.md)

## Phase 1 — API Endpoint Gaps

- [x] **1a** — Add `POST /api/eval/test-suites/parse` (server-side CSV/JSON parsing)
- [x] **1b** — Add `DELETE /api/eval/prompts/:id`
- [x] **1b** — Fix `DELETE /api/eval/evaluations/:id` to actually delete files; add `FileService.deleteDir`; add `PromptService.delete`
- [x] **1b** — Sessions `DELETE` already existed — verified ✓
- [x] **1c** — Add `POST /api/eval/evaluations/:id/cancel` (cancel without delete); add cancel-tracking to `ExecutionService`
- [x] **1d** — Add `deletePrompt`, `deleteEvaluation`, `cancelEvaluation`, `deleteSession`, `parseTestCases` to `src/api/eval.ts`

## Phase 2 — Typed Agent SDK

- [x] **2** — Create `scripts/lib/LMEvalClient.ts` with full typed API surface + `waitForCompletion` + `cleanupTestResources`

## Phase 3 — API End-to-End Test Script

- [x] **3** — Create `scripts/e2e-api.ts` covering all 12 test scenarios with cleanup

## Phase 4 — Playwright Browser Tests

- [x] **4a** — Install `@playwright/test` devDependency + create `playwright.config.ts`
- [x] **4b** — `tests/e2e/wizard-happy-path.spec.ts` — full 4-step wizard flow
- [x] **4c** — `tests/e2e/step1-prompts.spec.ts` — prompt editing, version selector, drag-drop, model gating
- [x] **4d** — `tests/e2e/step2-config.spec.ts` — template generate, sliders, preset load, matrix preview
- [x] **4e** — `tests/e2e/step2-testcases.spec.ts` — CSV/JSON import, export, tags, save-as-suite
- [x] **4f** — `tests/e2e/step3-run.spec.ts` — WebSocket indicator, live feed, error panel
- [x] **4g** — `tests/e2e/step4-results.spec.ts` — all tabs, cell drill-down, export, baseline
- [x] **4h** — Exclude `tests/e2e/**` from Vitest config so unit tests don't conflict

## Phase 5 — CI Wiring

- [x] **5** — Add `test:e2e-api`, `test:e2e-ui`, `test:e2e-ui:headed`, `test:all` to `package.json`
