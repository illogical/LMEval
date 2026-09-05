import type { PromptManifest, TestCase, EvalComparisonMode } from '../types/eval';

export interface SelectedModel {
  serverName: string;
  modelName: string;
}

export interface PromptSlot {
  id: string | null;
  version: number;
  content: string;
  manifest: PromptManifest | null;
}

export interface EvalWizardState {
  promptA: PromptSlot;
  promptB: PromptSlot;
  selectedModels: SelectedModel[];
  comparisonMode: EvalComparisonMode;
  templateId: string | null;
  testSuiteId: string | null;
  benchmarkMode: 'calibration' | 'promotion-check';
  inlineTestCases: TestCase[];
  userMessage: string;
  judgeModelId: string | null;
  enablePairwise: boolean;
  runsPerCell: number;
  evalId: string | null;
  sessionId: string | null;
  currentStep: 1 | 2 | 3 | 4 | 5;
  maxVisitedStep: number;
  isDirty: boolean;
  purposeTemplateId: string | null;
  purposeTemplateName: string | null;
}

export const defaultPromptSlot = (): PromptSlot => ({
  id: null,
  version: 1,
  content: '',
  manifest: null,
});

export const initialState: EvalWizardState = {
  promptA: defaultPromptSlot(),
  promptB: defaultPromptSlot(),
  selectedModels: [],
  comparisonMode: 'prompt',
  templateId: null,
  testSuiteId: null,
  benchmarkMode: 'calibration',
  inlineTestCases: [],
  userMessage: '',
  judgeModelId: null,
  enablePairwise: false,
  runsPerCell: 1,
  evalId: null,
  sessionId: null,
  currentStep: 1,
  maxVisitedStep: 1,
  isDirty: false,
  purposeTemplateId: null,
  purposeTemplateName: null,
};

export const STORAGE_KEY = 'lmeval:wizard:state';

export function loadFromStorage(): EvalWizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    return { ...initialState, ...JSON.parse(raw) };
  } catch {
    return initialState;
  }
}
