# Promptfoo Adoption + Purpose Templates + Evaluation Mode

## Background

`C:\LocalDev\Projects\promptfoo-poc\` (see [`2026-09-02-promptfoo-poc-evaluation.md`](2026-09-02-promptfoo-poc-evaluation.md) for the original spike plan) ran four real evaluation scenarios against MemoryAPI's actual classification/tagging prompts, first on bare Ollama and then against LMApi/HomeBase, and wrote up a decision log in that POC's `README.md`. The short version:

1. **The Ollama → LMApi provider swap is genuinely config-only** — only the `providers:` block changed between `promptfooconfig.models.yaml` and `promptfooconfig.models.lmapi.yaml`, and LMApi was ~10x faster for the same 66 requests (31s vs 4m56s).
2. **`progressCallback` can drive a live dashboard**, with two gotchas worth designing around: `evalStep.provider.id` is a method, not a resolved string, and the `metrics` argument is the *cumulative* run total, not the current cell's own result — per-cell pass/fail only exists in the final `results` array.
3. **Multi-label scoring (tagging) has no built-in Promptfoo assertion type** — a ~25-line custom `javascript` assertion (Jaccard overlap) was needed, but it composed cleanly with everything else Promptfoo already provides for free (results table, `promptfoo view`, export).
4. **The eval caught a real, pre-existing bug** in MemoryAPI's shipped `categorization.txt`: its few-shot example says `Category: Code snippet`, but the actual label set (`allCategories.json`) has `Snippet`. Running the eval surfaced this immediately; a lenient `icontains` assertion would have hidden it, which is itself a finding about assertion-strictness tradeoffs.
5. **Dynamic label lists (MemoryAPI's `{{categories}}`/`{{tags}}`, rendered from JSON at request time) aren't a first-class Promptfoo concept** — the POC worked around this by inlining the label lists as static text in the prompt files, which is fine for a fixed label set but doesn't generalize to labels that change per-run.
6. **No new information on the OpenAI/Promptfoo acquisition risk** beyond what was already known: MIT-licensed, existing customers supported, standard "folded into a bigger roadmap" risk on a multi-month horizon — not a blocker.

This session's follow-up conversation confirmed the next step: **adopt Promptfoo as LMEval's execution engine**, and design two new wizard concepts the user described more precisely than in earlier docs — an explicit **Evaluation Mode** (model comparison vs. prompt regression) and a **purpose-based template gallery** (Classification / Tagging / Summarization, seeded from MemoryAPI's real prompts) as the entry point to a new evaluation.

**Dependency footprint, confirmed against the POC's actual `package-lock.json`:** Promptfoo is a pure npm package. Node ≥22 and `npm install` is the entire install footprint — no Python, no separate service to run. The only packages in the dependency tree with native install scripts are for optional features the POC never used (`playwright`/`@playwright/browser-chromium` for the browser provider; `onnxruntime-node`/`@huggingface/transformers`/`sharp` for local embedding-based `similar`/moderation assertions) — all prebuilt Node addons, not external toolchains.

---

## Decision: Adopt Promptfoo as the execution engine

`ExecutionService.run()` will build a Promptfoo `TestSuite` from an `EvaluationConfig` (prompts, models, test cases, assertion config) and call Promptfoo's Node API directly:

```ts
import { evaluate } from 'promptfoo';

const results = await evaluate(testSuite, {
  maxConcurrency: EVAL_CONCURRENCY,
  progressCallback: (completed, total, index, evalStep, metrics) => {
    const providerId = typeof evalStep.provider?.id === 'function'
      ? evalStep.provider.id()   // NOTE: method, not a string property (POC finding #2)
      : evalStep.provider;
    // emit cell:started / cell:completed WebSocket events from here,
    // but do NOT trust `metrics` for this cell's own pass/fail — it's
    // the cumulative run total. Per-cell results only exist in the
    // resolved `results` array below.
  },
});
```

This replaces:
- **`MetricsService`'s ad hoc checks** (`checkKeywords`, `validateJsonSchema`, `validateToolCalls`) → Promptfoo assertion types (`icontains`, `equals`, `contains-json`, `javascript`, `llm-rubric`, etc.), configured per test case or per template.
- **`JudgeService`'s custom rubric/pairwise prompt-building** → Promptfoo's native `llm-rubric` assertion (and, for A/B style comparisons, Promptfoo's `select-best` assertion — **needs confirming against current Promptfoo docs before implementation**, flagged as an open question below rather than assumed).

`SummaryService`, `ReportService`, the WebSocket event contract, and the entire Step 3/4/5 frontend keep working largely unchanged — they consume `EvalMatrixCell[]`/`EvaluationSummary`, and the plan is to keep populating those same shapes from Promptfoo's results rather than exposing Promptfoo's own result format directly to the frontend. The one shape that does need to change is `EvalMatrixCell.deterministicMetrics` (see below).

---

## New concept: Evaluation Mode

A new axis, orthogonal to "what kind of task is this" (that's the purpose template, below). It answers: **is the user varying the model, or varying the prompt?**

Added to Step 1 (`PromptsPage.tsx`), as a strip above the prompt editors — before they even render, since it determines whether one or two prompt slots are shown:

| Mode | Prompt slots | Model selector | Use case |
|---|---|---|---|
| **Model Comparison** | 1 (Prompt B hidden) | Requires ≥2 models | "Which model is best for this fixed prompt?" |
| **Prompt Comparison (Regression)** | 2 (A/B, as today) | Allows 1+, UI nudges toward 2+ ("add another model to see if this holds up across models too") | "Did my prompt edit actually make it better — on this model, or every model I have?" |
| **Full Matrix (Advanced)** | N (power-user escape hatch) | Unrestricted | Both axes vary freely — structurally already supported by `EvaluationConfig.promptIds[]`/`modelIds[]`, just never exposed in the UI beyond 2 prompt slots. **Lowest priority — can ship after the first two modes.** |

Persisted as a new field:

```ts
// src/types/eval.ts — EvaluationConfig
comparisonMode: 'model' | 'prompt' | 'matrix';
```

This is purely a UI-affordance field. The matrix-building logic in `ExecutionService.buildMatrix()` doesn't need to branch on it — `promptIds[] × modelIds[] × testCases[] × runsPerCell` already works for all three modes. What changes is which UI is shown and what's validated before "Next" is enabled (e.g. Model Comparison mode blocks "Next" until ≥2 models are selected).

---

## New concept: Purpose Templates

Richer than today's `EvalTemplate` (which is judge-rubric-only: perspectives + weights + a handful of deterministic-check fields). A new top-level entity:

```ts
interface EvalPurposeTemplate {
  id: string;
  name: string;
  description: string;
  purposeCategory: 'classification' | 'tagging' | 'summarization' | 'custom';
  builtIn: boolean;

  seedPromptContent?: string;        // starter system prompt text
  defaultComparisonMode: 'model' | 'prompt' | 'matrix';

  assertionStrategy: {
    type: 'exact-label' | 'label-overlap' | 'llm-rubric' | 'custom';
    config: Record<string, unknown>; // shape depends on `type`, see below
  };

  starterTestCases: TestCase[];      // copied into inlineTestCases on selection,
                                      // never mutates the template itself

  createdAt: string;
  updatedAt: string;
}
```

### The 3 default templates, seeded from MemoryAPI

Source files: `C:\LocalDev\Projects\MemoryAPI\src\prompts\{categorization,tagging,memory_summary}.txt` and `src\samples\{allCategories,allTags}.json`.

| Template | `purposeCategory` | `seedPromptContent` source | `assertionStrategy` | Notes |
|---|---|---|---|---|
| **Classification** | `classification` | `categorization.txt`, with `{{categories}}` statically rendered from `allCategories.json` (same static-rendering approach the POC used — MemoryAPI's dynamic JSON-driven rendering isn't reproducible in a static prompt file, per POC finding #5) | `exact-label` — maps to a Promptfoo `equals` (or `icontains`, tunable) assertion against the 8-category list | **Seed the fixed version, not verbatim.** The POC deliberately preserved MemoryAPI's real `"Code snippet"` vs. `"Snippet"` label mismatch to prove the eval catches it — but a *template* meant to help users going forward should ship the corrected label list, matching MemoryAPI's actual `allCategories.json` values, so users aren't inheriting a known bug by default. |
| **Tagging** | `tagging` | `tagging.txt`, with `{{tags}}` statically rendered from `allTags.json`'s ~60 tags | `label-overlap` — a bundled `javascript` assertion, ported near-verbatim from the POC's `scripts/tag-overlap-assert.js` (Jaccard overlap, threshold 0.5, `config.vars.expectedTags` comma-separated) | POC's tagging.txt example #16 references tag `"Personal"`, which doesn't exist in `allTags.json` — fix this in the seeded template too, same reasoning as above. |
| **Summarization** | `summarization` | `memory_summary.txt` | `llm-rubric` — Promptfoo's built-in model-graded assertion, rubric dimensions: conciseness, faithfulness (no hallucinated facts), coverage (key points retained) | Explicitly **not** deterministic — the original POC plan correctly deferred this as needing rubric/LLM-judge scoring, a fundamentally different (subjective) evaluation mode from the other two. This template is where the wizard's Judge Configuration card becomes required rather than optional. |

**Manual-refresh caveat**: these templates are static snapshots of MemoryAPI's prompts/label lists at seed time. If MemoryAPI's `allCategories.json`/`allTags.json` change later (the user has said they plan to refine these), the LMEval template needs manual re-seeding — there's no live sync between the two separate repos/services. Worth a "Refresh from source" affordance in a later iteration if this becomes a recurring annoyance, but not required for v1.

### `starterTestCases` content

Each built-in template ships with a small set of example cases (5-10), reusing/extending the same real-world-flavored examples used in the POC's `tests/classification-cases.yaml` and `tests/tagging-cases.yaml` (not literally copy-pasted, but same spirit — plain-language inputs spanning the label space plus a couple of deliberately ambiguous edge cases). These seed `inlineTestCases` on template selection; users edit/add/remove from there exactly like today's Suite mode.

---

## Wizard flow changes

### New entry point: Template Gallery

```
Session Hub (/)
  └─ "New Evaluation" → Template Gallery (NEW)
       ├─ Purpose template cards: Classification | Tagging | Summarization | [any user-saved templates]
       └─ "Start Blank" card → today's flow, unchanged
```

Selecting a template pre-fills the wizard context (`EvalWizardContext`) before landing on Step 1:
- `comparisonMode` ← `template.defaultComparisonMode` (Classification/Tagging/Summarization all default to `'prompt'` — the primary refinement loop is "did my prompt edit help")
- Prompt A content ← `template.seedPromptContent`
- `inlineTestCases` ← copy of `template.starterTestCases`
- Assertion config + (if `llm-rubric`) judge config ← `template.assertionStrategy`

"Start Blank" skips all of this and behaves exactly like the current wizard.

### Step 1 (`PromptsPage.tsx`) changes
- New Evaluation Mode strip above the prompt editors (see table above); determines whether Prompt B slot renders at all.
- If arrived via a template: Prompt A pre-filled and shown with a small "from template: Classification" provenance badge (editable — this is a starting point, not a lock).
- Model selector validation becomes mode-aware: Model Comparison requires ≥2 before "Next" enables; Prompt Comparison allows 1+ with a soft nudge (not a hard block) toward 2+.

### Step 2 (`ConfigPage.tsx`) changes
- If arrived via a template, the assertion/success-criteria card (today's deterministic-checks section, reframed around Promptfoo assertion types) is pre-populated from `template.assertionStrategy` and the test case table starts with `starterTestCases` already loaded — both editable.
- Judge Configuration card becomes required (not just available) when `assertionStrategy.type === 'llm-rubric'`.
- "Save as Template" — new action alongside today's "Save as Preset", capturing the current config (prompt content, assertion config, test cases) as a new `EvalPurposeTemplate` with `purposeCategory: 'custom'` and `builtIn: false`. This is how a user's own refined MemoryAPI prompts (or any other prompt) becomes a reusable starting point.

### Step 3/4 changes (data shape, not necessarily UI in this pass)
- `EvalMatrixCell.deterministicMetrics`'s fixed named fields (`keywordsFound`, `keywordsMissing`, `jsonSchemaValid`, `toolCallResults`, etc.) are replaced by a generic shape matching Promptfoo's own `GradingResult`:
  ```ts
  assertionResults: Array<{
    type: string;       // e.g. 'icontains', 'javascript', 'llm-rubric'
    pass: boolean;
    score?: number;
    reason?: string;
  }>;
  ```
- Detail/Compare/heatmap-tooltip rendering iterates this array instead of the old fixed field set. This is a real UI change but a mechanical one — the existing "pass/fail badge list" pattern in `DetailView.tsx` already renders a similar shape for tool calls; it generalizes.
- Step 5 (Summary) has no material design change from this work — richer `assertionResults` data just gives it more to summarize whenever it's eventually built (Phase 9 per the existing `docs/prompt-eval-system/TASK.md`).

---

## Phased task breakdown

Numbered to slot after the existing phases in `docs/prompt-eval-system/TASK.md` (which currently runs through Phase 9, plus the standalone Phase F5). These are **new phases**, not edits to existing checked-off work.

### Phase 10 — Promptfoo Engine Migration

- [ ] Add `promptfoo` as a dependency (`npm install promptfoo`, pin the version validated in the POC)
- [ ] Create `server/services/PromptfooAdapter.ts` — translates `EvaluationConfig` + prompt content + `TestCase[]` into a Promptfoo `TestSuite` object (prompts array, providers array from `modelIds` via LMApi's OpenAI-compatible endpoint, `tests` array with per-case `assert` blocks built from the template's `assertionStrategy` or from ad hoc per-test-case checks for non-template evals)
- [ ] Rewrite `ExecutionService.run()` to call `evaluate(testSuite, { progressCallback, maxConcurrency })` instead of the current `runCompletions()`/`Semaphore` dispatch loop; map Promptfoo's per-cell results back into `EvalMatrixCell[]`
- [ ] Update `EvalMatrixCell.deterministicMetrics` → `assertionResults: AssertionResult[]` in `src/types/eval.ts`; update `DetailView.tsx`, `CompareView.tsx`, `HeatmapMatrix.tsx` tooltip rendering to iterate the new shape
- [ ] Retire `MetricsService.ts` (its logic moves into `PromptfooAdapter`'s assertion-building, expressed as Promptfoo assertion configs rather than hand-rolled checks)
- [ ] Retire `JudgeService.ts`'s rubric/pairwise prompt construction in favor of Promptfoo's `llm-rubric` assertion type with a judge-provider override; confirm whether Promptfoo's `select-best` assertion is the right mapping for today's pairwise-comparison toggle (open question, verify against current Promptfoo docs)
- [ ] Decide and implement the historical-eval-data question (see Open Questions) — either a migration script for `data/evals/evaluations/*/results.json` or documented graceful-degradation for pre-migration evals in the new Detail view
- [ ] Update `scripts/test-execution.ts` for the new engine
- [ ] **Verification**: re-run the existing eval flow end-to-end (1 prompt × 1 model × 1 test case, and a multi-cell matrix) and confirm `results.json`/`summary.json` populate correctly, WebSocket events still arrive in the expected `cell:started → cell:completed → eval:progress → eval:completed` sequence, and per-cell `assertionResults` render in the Results tabs

### Phase 11 — Evaluation Mode

- [ ] Add `comparisonMode: 'model' | 'prompt' | 'matrix'` to `EvaluationConfig` in `src/types/eval.ts` and `EvalWizardContext.tsx` state
- [ ] Add the Evaluation Mode strip component to `PromptsPage.tsx`, above the prompt editors
- [ ] Wire mode-aware conditional rendering: hide Prompt B slot in Model Comparison mode; mode-aware "Next" button validation (≥2 models required for Model Comparison)
- [ ] Full Matrix mode (N prompt slots) — lowest priority within this phase, can follow the first two
- [ ] **Verification**: select Model Comparison → only one prompt editor renders, "Next" stays disabled until 2+ models chosen; select Prompt Comparison → both editors render as today, 1 model is enough to proceed but the UI shows a nudge toward adding more

### Phase 12 — Purpose Templates

- [ ] Add `EvalPurposeTemplate` type to `src/types/eval.ts`
- [ ] Create `server/services/PurposeTemplateService.ts` — list/get/create/delete (mirrors `TemplateService.ts`'s pattern); `data/evals/purpose-templates/` for storage, built-ins seeded like today's `data/evals/templates/*.json`
- [ ] Create `server/routes/purposeTemplates.ts` — CRUD at `/api/eval/purpose-templates`
- [ ] Seed the 3 built-in templates (Classification, Tagging, Summarization) with content pulled fresh from MemoryAPI's `src/prompts/` and `src/samples/` (with the label-mismatch fixes noted above, not verbatim)
- [ ] Create `TemplateGalleryPage.tsx` (or a modal off the Session Hub) — card grid of purpose templates + "Start Blank"; selecting a card pre-fills `EvalWizardContext` and navigates to `/eval/prompts`
- [ ] Wire "Save as Template" action on `ConfigPage.tsx`
- [ ] **Verification**: Session Hub → New Evaluation → gallery shows 3 built-ins + Start Blank → selecting Classification lands on Step 1 with Prompt A pre-filled, Prompt Comparison mode selected, and Step 2's assertion card + test cases already populated from the template → Start Blank behaves exactly like today's wizard

---

## Open questions (not resolved in this plan — flag before implementing)

1. **Historical eval compatibility.** Existing `data/evals/evaluations/*/results.json` files predate `assertionResults` and use the old `deterministicMetrics` shape. Migration script vs. accept degraded rendering for old evals — needs a decision before Phase 10 ships.
2. **Pairwise → Promptfoo mapping.** Whether Promptfoo's `select-best` assertion is the right replacement for today's `enablePairwise` toggle and `JudgeService.buildPairwisePrompt()`/`parsePairwiseResponse()` needs confirming against current Promptfoo docs, not assumed from this plan alone.
3. **Full Matrix mode scope.** Whether it ships in the same pass as Phase 11's other two modes or is deferred to a later phase — flagged as lowest priority above but not explicitly cut.
