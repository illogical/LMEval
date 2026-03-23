# Prepare Wizard + Summary Intelligence — Future Iterations Plan

> **Status**: Future (do not implement in the current Prepare UX sprint)
> **Primary focus right now**: Improve Step 2 Prepare/Config frontend UX.
> **This document's purpose**: Capture the next layers so a separate coding assistant can implement them later without re-discovery.

---

## 1. Why This Exists

LMEval already supports strong baseline evaluation features (templates, test suites, judge config, runs-per-cell, presets, matrix execution, scoring, exports). The next iteration should turn evaluation setup into a more reliable decision system:

- More deterministic/reproducible setup controls
- Better visibility into variance and failure modes
- Better "ship/no-ship" summary outcomes after runs
- Better model recommendations for local Ollama usage where speed and accuracy trade off

This plan is intentionally scoped as a **future extension**, not a blocker for current Prepare UX improvements.

---

## 2. Current Integration Baseline (as of this plan)

### Frontend
- `src/pages/ConfigPage.tsx` currently owns Step 2 sections:
  - Template selection
  - Test case configuration
  - Judge settings
  - Execution preview
  - Presets
- `src/contexts/EvalWizardContext.tsx` stores wizard state and persistence
- `src/types/eval.ts` defines `EvaluationConfig`, summary types, and preset types
- `src/pages/SummaryPage.tsx` exists but is still a placeholder

### Backend
- `server/routes/evaluations.ts` handles evaluation create/read/summary/export/baseline
- `server/services/ExecutionService.ts` builds matrix and runs completion + judging pipeline
- `server/services/MetricsService.ts` handles deterministic checks (keywords/schema/tool calls)
- `server/services/SummaryService.ts` computes aggregate model/prompt summary and baseline regression

Use these as the extension anchors; avoid introducing a second parallel eval architecture.

---

## 3. Market-Informed Feature Themes (for inspiration only)

The following themes are repeatedly present across current eval products (Promptfoo, LangSmith, Braintrust, Langfuse, Phoenix, Weave, DeepEval, Ragas, TruLens):

1. Deterministic assertions + rubric scoring in one pipeline
2. Dataset versioning + slice/tag analysis
3. Blind/pairwise comparison workflows
4. CI-style regression gates (hard pass/fail thresholds)
5. Online + offline evaluation modes
6. Strong summary/recommendation layer for decision making

Interpretation for LMEval: prioritize reproducibility and reviewable decisions over adding more "black-box" scores.

---

## 4. Future Workstream A — Prepare Wizard v2 (Configuration Reliability)

## Goal
Upgrade Step 2 from "set parameters" into "define an evaluation contract."

## Proposed UX Modules (future)

### A1. Evaluation Profile
- Add a profile selector at top of Step 2:
  - `Strict JSON extraction`
  - `Tool-calling`
  - `Instruction following`
  - `Code generation`
  - `Custom`
- Profile pre-populates:
  - Deterministic gate defaults
  - Rubric weights
  - Runs-per-cell defaults
  - Summary weighting (accuracy vs latency)

### A2. Determinism & Variance Controls
- New panel fields:
  - `temperature`, `top_p`, `seed` (if model supports)
  - `runsPerCell`
  - `shuffleOrder` toggle
  - `warmupRuns` count (excluded from scoring)
- Show warning when variance is likely too high to trust winner selection.

### A3. Hard Gates vs Soft Scores
- Split checks into:
  - **Hard gates**: schema validity, forbidden terms, required tool-call shape
  - **Soft scores**: judge rubric dimensions
- Candidate is ineligible for "winner" if hard gate pass rate is below threshold.

### A4. Test Case Slicing
- Add optional tags/slices per test case:
  - Example: `long_context`, `format_strict`, `tool_required`
- Step 2 preview should show matrix counts by slice, not only total cells.

### A5. Budget & Runtime Estimator
- Extend execution preview:
  - total cells
  - estimated wall-clock range based on recent model latency history
  - warning for large evals
- This is especially useful for local model throughput constraints.

### A6. Judge Reliability Controls
- Add configurable:
  - judge model version
  - judge run count
  - optional "dual-judge agreement" mode (future)
- Surface agreement score in results confidence.

## Integration points
- Frontend:
  - `src/pages/ConfigPage.tsx`
  - `src/components/config/JudgeConfig.tsx`
  - `src/components/config/ExecutionPreview.tsx`
  - `src/components/config/TestCaseEditor.tsx`
  - new components under `src/components/config/` for profile/determinism/gates/slices
- State:
  - `src/contexts/EvalWizardContext.tsx`
  - `src/types/eval.ts` (`EvaluationConfig` extension)
- Backend:
  - `server/routes/evaluations.ts` request validation
  - `server/services/ExecutionService.ts` run orchestration updates
  - `server/services/MetricsService.ts` gate evaluation helpers
  - `server/services/SummaryService.ts` winner eligibility logic

## Suggested type additions (future)

```ts
interface DeterminismConfig {
  temperature?: number;
  topP?: number;
  seed?: number;
  shuffleOrder?: boolean;
  warmupRuns?: number;
}

interface GateThresholds {
  minHardGatePassRate: number; // 0..1
  requiredSchemaValid?: boolean;
  maxForbiddenHits?: number;
}

interface EvaluationProfile {
  id: string;
  name: string;
  summaryWeights: {
    accuracy: number;
    latency: number;
    consistency: number;
  };
}
```

## Acceptance criteria
- A completed config JSON is sufficient to re-run the same eval with comparable behavior.
- Wizard preview explains whether a run is statistically meaningful (based on runs/variance config).
- Winner selection can reject high-score but gate-failing candidates.

---

## 5. Future Workstream B — Summary Intelligence (Step 5)

## Goal
Replace placeholder summary page with a decision surface:
"Which prompt+model should I ship for this use case, and why?"

## Required summary outputs

1. **Winner card**
- Best candidate by configured weights
- Confidence indicator (based on variance + sample size)
- Hard-gate pass status

2. **Tradeoff frontier**
- Accuracy vs latency plot (Pareto candidates highlighted)
- Optional consistency shown as third metric

3. **Per-slice results**
- Top candidate by slice tag
- Detect "global winner but slice-specific failure"

4. **Regression block**
- Compare to baseline snapshot:
  - score delta
  - latency delta
  - gate-pass delta

5. **Failure digest**
- Most frequent failures
- top failing test cases
- direct links back to detailed cells in Results tab

6. **Action recommendations**
- "Promote Prompt B over A" (when confidence/gates satisfy threshold)
- "Keep A, revise B with targeted fixes"
- "Model recommendation by objective" (fastest acceptable vs highest quality)

## Integration points
- Frontend:
  - `src/pages/SummaryPage.tsx` (full implementation)
  - likely new summary components under `src/components/results/` or `src/components/summary/`
- Backend:
  - `server/services/SummaryService.ts` extend payload
  - optional new `SummaryInsightsService.ts` for recommendation synthesis
  - `server/routes/evaluations.ts` summary endpoint contract extension
- Types:
  - `src/types/eval.ts` add summary insight structures

## Acceptance criteria
- A user can pick a ship candidate from Summary without manual spreadsheet work.
- Summary always includes "why this won" and "where this loses."
- Summary reflects profile weights from Prepare configuration.

---

## 6. Future Workstream C — Continuous Regression Mode

## Goal
Enable recurring eval presets for drift/regression detection across prompt or model changes.

## Scope
- Add scheduled re-run mode (manual trigger first, automation second)
- Compare against chosen baseline
- Emit compact regression status for quick triage

## Integration points
- Existing `presets` + `baselines` storage
- `server/services/SummaryService.ts` regression extensions
- future scheduler integration can run `ExecutionService.run(evalId)` from a generated config

## Acceptance criteria
- Teams can track "did this get better or worse?" over time with stable criteria.

---

## 7. Execution/Data Changes Required Across Workstreams

## Storage model additions
- Persist full configuration snapshot (profile, determinism, gates, weights, slice metadata)
- Persist per-cell gate status and exclusion reason (if removed from winner ranking)
- Persist variance/confidence statistics at model and prompt summary levels

## API compatibility approach
- Add fields as optional first to avoid breaking existing runs
- Keep old summaries readable
- Version summary payload if shape changes become large (`summaryVersion`)

## Migration strategy
1. Introduce new optional fields in types and backend writers
2. Backfill defaults when reading old files
3. Render fallback UI for legacy evals with missing metrics

---

## 8. Suggested Delivery Phases (Post-Prepare UX Sprint)

### Phase F1 — Configuration Contract
- Add profile + determinism + gates in Prepare step
- Persist config and show upgraded execution preview

### Phase F2 — Summary Implementation
- Replace placeholder Step 5
- Add winner confidence, tradeoff frontier, failure digest

### Phase F3 — Slice + Confidence Analytics
- Add per-slice results and confidence calculations
- Improve recommendation quality

### Phase F4 — Continuous Regression
- Add recurring/batch comparison workflows
- Expand baseline and trend reporting

---

## 9. Guardrails for the Future Coding Assistant

1. Do not change current Prepare UX sprint scope unless explicitly requested.
2. Extend existing services/components; do not duplicate evaluation pipelines.
3. Keep all new config fields serializable to JSON for reproducibility.
4. Maintain local-first assumptions (no mandatory cloud dependency).
5. Prefer deterministic checks before LLM-judge scores in ranking logic.
6. Add tests for:
   - config serialization
   - gating logic
   - summary winner selection
   - legacy eval compatibility

---

## 10. Research Links Used for This Plan

- Promptfoo assertions/providers/red-team/pricing
  - https://www.promptfoo.dev/docs/configuration/expected-outputs/
  - https://www.promptfoo.dev/docs/providers/ollama/
  - https://www.promptfoo.dev/docs/red-team/
  - https://www.promptfoo.dev/pricing/
- OpenAI acquisition announcement (Promptfoo)
  - https://openai.com/index/openai-to-acquire-promptfoo/
- LangSmith
  - https://docs.langchain.com/langsmith/evaluation
  - https://docs.langchain.com/langsmith/annotation-queues
  - https://www.langchain.com/pricing
- Braintrust
  - https://www.braintrust.dev/docs/evaluate/run-evaluations
  - https://www.braintrust.dev/docs/annotate/datasets
  - https://www.braintrust.dev/pricing
- Langfuse
  - https://langfuse.com/docs/evaluation/overview
  - https://langfuse.com/pricing
  - https://github.com/langfuse/langfuse-docs/blob/main/pages/faq/all/self-hosting-langfuse.mdx
- Weights & Biases Weave
  - https://wandb.ai/site/evaluations/
  - https://wandb.ai/site/pricing/
- Arize Phoenix
  - https://arize.com/docs/phoenix
  - https://arize.com/docs/phoenix/self-hosting
  - https://arize.com/docs/phoenix/self-hosting/license
- DeepEval / Confident AI
  - https://github.com/confident-ai/deepeval
  - https://www.confident-ai.com/pricing
- Ragas
  - https://github.com/vibrantlabsai/ragas
  - https://docs.ragas.io/en/v0.2.14/getstarted/rag_testset_generation/
- TruLens
  - https://www.trulens.org/component_guides/evaluation/
  - https://www.trulens.org/getting_started/dashboard/

