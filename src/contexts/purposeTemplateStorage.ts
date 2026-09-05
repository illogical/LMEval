import type { EvalPurposeTemplate } from '../types/eval';
import { defaultPromptSlot, loadFromStorage, STORAGE_KEY, type EvalWizardState } from './wizardState';

export { STORAGE_KEY };

export function purposeTemplateToState(t: EvalPurposeTemplate): Pick<EvalWizardState,
  'comparisonMode' | 'promptA' | 'promptB' | 'testSuiteId' | 'benchmarkMode' | 'inlineTestCases' | 'templateId' | 'purposeTemplateId' | 'purposeTemplateName'
> {
  const templateId = t.assertionStrategy.type === 'grounded-summary'
    ? t.assertionStrategy.config.templateId
    : null;
  return {
    comparisonMode: t.defaultComparisonMode,
    promptA: { id: null, version: 1, content: t.seedPromptContent ?? '', manifest: null },
    promptB: defaultPromptSlot(),
    testSuiteId: null,
    benchmarkMode: 'calibration',
    inlineTestCases: t.starterTestCases.map(tc => ({
      ...tc,
      id: `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    })),
    templateId,
    purposeTemplateId: t.id,
    purposeTemplateName: t.name,
  };
}

/**
 * Applies a purpose template directly to persisted wizard storage, for callers
 * (the pre-wizard Template Gallery page) that navigate to /eval/prompts before
 * EvalWizardProvider mounts and can dispatch LOAD_PURPOSE_TEMPLATE itself.
 */
export function applyPurposeTemplateToStorage(template: EvalPurposeTemplate): void {
  try {
    const current = loadFromStorage();
    const next: EvalWizardState = { ...current, ...purposeTemplateToState(template), isDirty: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the gallery selection is lost, PromptsPage opens blank
  }
}
