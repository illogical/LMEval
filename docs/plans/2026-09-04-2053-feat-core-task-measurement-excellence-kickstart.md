# Kickstart — Core Task Measurement Excellence (R1–R8)

> Paste this file's path into a new session ("implement docs/plans/2026-09-04-2053-feat-core-task-measurement-excellence-kickstart.md") to begin with zero prior context.

## What to read first, in order

1. `docs/plans/2026-09-04-2053-feat-core-task-measurement-excellence-plan.md` — the requirements-only plan (R1–R8). This is the actual spec for this work. Everything below is orientation, not a substitute for it.
2. `docs/TASK.md` §4 Track A, items **A3** and **A6** — the same requirements, with more granular checklists and file/behavior pointers (`AssertionStrategy`, `PromptfooAdapter`, `expectedKeywords` vs `expectedOutput`, the discriminated `taskMetrics` union, gate thresholds).
3. `docs/SPECIFICATION.md` §3–4 — data model and Promptfoo engine architecture context (`EvalPurposeTemplate`, `AssertionStrategy`, `EvalMatrixCell.assertionResults`, `server/services/ExecutionService.ts` as the Promptfoo translation layer).

## Where the current gaps actually are (verified this session, not assumed)

- `src/types/eval.ts` (~line 314–337): `PurposeCategory` and `AssertionStrategyType` unions already exist; `AssertionStrategy.config` is untyped `Record<string, unknown>` — no discriminated narrowing by `type`. No `taskMetrics` union exists yet (R7).
- `server/services/PromptfooAdapter.ts`: only `label-overlap` (tagging) is wired (lines ~279, ~288, ~194 for Jaccard). `exact-label` (classification, R1) is declared in the purpose template JSON but **never checked** — classification currently grades via `expectedKeywords` prose-matching, which is the actual bug R1 fixes. `type: 'custom'` has zero implementation (R2).
- `server/services/ExecutionService.ts`: branches on `a.type === 'llm-rubric'` (lines ~85, ~261) for composite scoring; `select-best`/pairwise branches (lines ~337–347) are dead code (promptfoo 0.122.2 bug, tracked separately in Track D — do not touch).
- `server/services/SummaryService.ts`: generic `${type}::${metric}` pass/fail counting exists (line ~188); no task-specific metrics (macro-F1, Jaccard aggregate, confusion matrix, etc.) are computed yet — this is what R4–R6 add. Regression detection (lines ~265–324) only compares `compositeScore`/`avgLatencyMs` today.
- `data/evals/purpose-templates/*.json`: `classification.json` and `summarization.json` need no schema change for R1/R6 to work (the config shapes already declare what's needed) — the fix is in the adapter/service code that reads them, not the JSON.

## Scope discipline (read this before writing code)

The plan's Key Decisions and Scope Boundaries sections are load-bearing — do not:
- Generalize the assertion/metric system into a reusable plugin architecture. Hardcode for exactly three task types (classification/tagging/summarization). That generalization is explicitly deferred.
- Touch A2 (snapshot import), A5, A7–A11, or Track B/C/D items. They're queued in `docs/TASK.md` and out of scope here.
- Design any new API surface for agent-driven config/run. Also explicitly deferred.

## Verification bar (match the project's existing standard)

Every prior pass in `docs/TASK.md`'s "Completed in this pass" sections was verified with `npx vitest run`, `tsc -b`, `npm run build`, `npm run lint` — cite the actual before/after test counts, not just "tests pass." Live model verification (a real LMApi + Ollama round trip) is separate and tracked under Track E in `docs/TASK.md` — do not claim it from unit tests alone; say explicitly if it's still owed.

## After implementation: update docs based on verified changes, not the plan

Once R1–R8 are actually implemented and verified:
1. Update `docs/TASK.md`: move A3/A6 checklist items to checked, add a dated "Completed in this pass" entry (following the existing style — exact test counts, exact files touched), update the Track A status note at the top.
2. Update `docs/SPECIFICATION.md` §3 if `EvalMatrixCell`/`EvaluationSummary` shapes materially changed (e.g., the new `taskMetrics` union) — the plan marked this **(planned)**; flip it to current-state once it ships.
3. Leave `docs/plans/2026-09-04-2053-feat-core-task-measurement-excellence-plan.md` as-is (historical requirements record) — do not edit it post-hoc; TASK.md is where completed-work status lives.

## Deferred ideas surfaced this session (not in scope, but worth remembering)

Captured in the plan's Scope Boundaries: a generalized custom task-type plugin architecture, deeper tool-calling evaluation, evaluating MemoryApi's multi-source retrieval-merge step, an agent-drivable API, and a prompt-refinement Claude Code skill (read-only API + chat-only suggestions, no auto-apply, no automated loop). None of these are this session's job — flag if a new session starts drifting toward them instead of R1–R8.
