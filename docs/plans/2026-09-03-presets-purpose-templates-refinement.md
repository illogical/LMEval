# Refine Presets vs. Purpose Templates

## Context

[`2026-09-03-promptfoo-adoption-and-purpose-templates.md`](2026-09-03-promptfoo-adoption-and-purpose-templates.md) added `EvalPurposeTemplate` ("Save as Template") as a new concept alongside the pre-existing `EvalPreset` ("Save as Preset"), without revisiting what Presets were for. On review, both now sit side-by-side on `ConfigPage.tsx`'s sidebar as two "save this as a reusable thing" buttons, and it's not obvious to a user which one to reach for.

Reviewing the original intent: **Presets are a saved, reusable set of run configuration** — model selection, judge settings, execution knobs (`modelIds`, `templateId` (judge rubric), `testSuiteId`, `judgeModelId`, `enablePairwise`, `runsPerCell`) — with no prompt content or test case content. **Purpose Templates are a starting point** — seed prompt content, starter test cases, and an assertion strategy definition, copied once into the wizard and then edited freely.

That's a clean split in principle. Two things need fixing to make it clean in practice:

1. `EvalComparisonMode` (Model/Prompt/Matrix comparison) didn't exist yet when `EvalPreset` was designed, so it's missing from what a saved configuration remembers — even though "which axis am I varying" is exactly the kind of run preference a preset should restore.
2. `LOAD_PRESET` in `EvalWizardContext.tsx` already accepts `modelIds` when saving a preset but never restores `selectedModels` on load — a preset silently forgets one of the settings it's supposed to capture.
3. The "Save as Template" UI card sits directly under "Presets" in the sidebar with no visual distinction, reinforcing the impression that they're two flavors of the same action. It belongs with the eval-definition content it actually captures (prompt + test cases + assertion config), not next to run-configuration settings.

No structural content needs to move *out* of `EvalPurposeTemplate` into `EvalPreset` — templates already only seed ordinary wizard state once at selection time (`purposeTemplateToState()` in `src/contexts/purposeTemplateStorage.ts`); there's no ongoing reference back to the template after that point, so the earlier suspicion of a persistent `templateId` coupling between the two types turned out not to hold up under closer reading. The only real gap is `comparisonMode`.

## Approach

### 1. Add `comparisonMode` to `EvalPreset` and make presets a complete saved configuration

- `src/types/eval.ts`: add `comparisonMode?: EvalComparisonMode;` to `EvalPreset` (near `runsPerCell`).
- `src/components/config/PresetSelector.tsx`:
  - `PresetSelectorProps.currentState`: add `comparisonMode: EvalComparisonMode`.
  - `handleSave()`: include `comparisonMode: currentState.comparisonMode` in the `createPreset()` call.
- `src/pages/ConfigPage.tsx`: pass `comparisonMode: state.comparisonMode` into the `currentState` prop given to `<PresetSelector>`.

### 2. Fix `LOAD_PRESET` to actually restore the saved configuration

`src/contexts/EvalWizardContext.tsx`, the `LOAD_PRESET` case (currently lines 34–43) restores `templateId`/`testSuiteId`/`judgeModelId`/`enablePairwise`/`runsPerCell` but drops `modelIds` and (once added) `comparisonMode` on the floor. Fix:

```ts
case 'LOAD_PRESET': {
  const selectedModels = (action.payload.modelIds ?? []).map(id => {
    const [serverName, modelName] = id.split('::');
    return { serverName, modelName };
  });
  return {
    ...state,
    selectedModels,
    comparisonMode: action.payload.comparisonMode ?? state.comparisonMode,
    templateId: action.payload.templateId ?? null,
    testSuiteId: action.payload.testSuiteId ?? null,
    judgeModelId: action.payload.judgeModelId ?? null,
    enablePairwise: action.payload.enablePairwise,
    runsPerCell: action.payload.runsPerCell,
    isDirty: true,
  };
}
```

The `serverName::modelName` split mirrors how `modelIds` are already constructed in `ConfigPage.tsx` (`state.selectedModels.map(m => \`${m.serverName}::${m.modelName}\`)`), so this is a straightforward inverse, not a new convention.

### 3. Relocate "Save as Template" out of the Presets sidebar

`src/pages/ConfigPage.tsx`: move the "Save as Template" card (currently lines 203–230, in `cp-sidebar` directly under the Presets card) into `cp-col` (the left column), as a new card placed after the "Judge Configuration" card. This groups it with the eval-definition content it actually captures — prompt content (from Step 1, reflected via `state.promptA.content`), test cases (`state.inlineTestCases`), and assertion/judge config (`state.templateId` + `state.judgeModelId`) — rather than beside the unrelated session-config "Presets" card. No change to `handleSaveAsTemplate()`'s logic, only where the card renders. Update `ConfigPage.css` styling as needed if the sidebar-specific class names (`cp-save-template*`) assumed sidebar width/layout.

### Not changing

- `EvalPurposeTemplate`'s shape, `PurposeTemplateService`, `TemplateGalleryPage.tsx`, and the `LOAD_PURPOSE_TEMPLATE` seeding flow — these already behave as a one-time "starting point" copy, matching the intended model. No code changes needed here; confirmed by reading `purposeTemplateToState()`.
- `EvalTemplate` (judge rubric) and its `TemplateSelector` — out of scope, unrelated to this refinement.

## Verification

1. Start the app, go to Step 2 (Prepare) with some prompt content, models, and Prompt Comparison mode selected.
2. Save as Preset with a name; confirm `data/evals/presets/<id>.json` now includes `comparisonMode` and the same `modelIds` as selected.
3. Switch to Model Comparison mode, clear model selection, reload the page (or navigate away and back) to reset wizard state, then load the saved preset from the dropdown — confirm both the models and the comparison mode you originally saved are restored (not just judge/test-suite settings).
4. Confirm the "Save as Template" card now renders in the left column below Judge Configuration, and the Presets sidebar card no longer has it beneath it; save a template and confirm it still appears correctly in the Template Gallery.
5. `npm run build` (or the project's typecheck script) to confirm the `EvalPreset` type change and reducer edit compile cleanly.
