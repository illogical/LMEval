import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import type { PromptManifest, TestCase, EvalPreset } from '../types/eval';

export interface SelectedModel {
  serverName: string;
  modelName: string;
}

interface PromptSlot {
  id: string | null;
  version: number;
  content: string;
  manifest: PromptManifest | null;
}

export interface EvalWizardState {
  promptA: PromptSlot;
  promptB: PromptSlot;
  selectedModels: SelectedModel[];
  templateId: string | null;
  testSuiteId: string | null;
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
}

const defaultPromptSlot = (): PromptSlot => ({
  id: null,
  version: 1,
  content: '',
  manifest: null,
});

const initialState: EvalWizardState = {
  promptA: defaultPromptSlot(),
  promptB: defaultPromptSlot(),
  selectedModels: [],
  templateId: null,
  testSuiteId: null,
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
};

type Action =
  | { type: 'SET_PROMPT_A'; payload: Partial<PromptSlot> }
  | { type: 'SET_PROMPT_B'; payload: Partial<PromptSlot> }
  | { type: 'SET_MODELS'; payload: SelectedModel[] }
  | { type: 'SET_CONFIG'; payload: Partial<Pick<EvalWizardState, 'templateId' | 'testSuiteId' | 'inlineTestCases' | 'userMessage' | 'judgeModelId' | 'enablePairwise' | 'runsPerCell'>> }
  | { type: 'START_EVAL'; payload: { evalId: string } }
  | { type: 'LOAD_PRESET'; payload: EvalPreset }
  | { type: 'RESET' }
  | { type: 'SET_STEP'; payload: 1 | 2 | 3 | 4 | 5 };

function reducer(state: EvalWizardState, action: Action): EvalWizardState {
  switch (action.type) {
    case 'SET_PROMPT_A':
      return { ...state, promptA: { ...state.promptA, ...action.payload }, isDirty: true };
    case 'SET_PROMPT_B':
      return { ...state, promptB: { ...state.promptB, ...action.payload }, isDirty: true };
    case 'SET_MODELS':
      return { ...state, selectedModels: action.payload, isDirty: true };
    case 'SET_CONFIG':
      return { ...state, ...action.payload, isDirty: true };
    case 'START_EVAL':
      return { ...state, evalId: action.payload.evalId, currentStep: 3, maxVisitedStep: Math.max(state.maxVisitedStep, 3), isDirty: false };
    case 'LOAD_PRESET':
      return {
        ...state,
        templateId: action.payload.templateId ?? null,
        testSuiteId: action.payload.testSuiteId ?? null,
        judgeModelId: action.payload.judgeModelId ?? null,
        enablePairwise: action.payload.enablePairwise,
        runsPerCell: action.payload.runsPerCell,
        isDirty: true,
      };
    case 'RESET':
      return { ...initialState };
    case 'SET_STEP': {
      const step = action.payload;
      return { ...state, currentStep: step, maxVisitedStep: Math.max(state.maxVisitedStep, step) };
    }
    default:
      return state;
  }
}

const STORAGE_KEY = 'lmeval:wizard:state';

function loadFromStorage(): EvalWizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    return { ...initialState, ...JSON.parse(raw) };
  } catch {
    return initialState;
  }
}

interface EvalWizardContextValue {
  state: EvalWizardState;
  dispatch: React.Dispatch<Action>;
}

const EvalWizardContext = createContext<EvalWizardContextValue | null>(null);

export function EvalWizardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadFromStorage);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // storage quota exceeded or unavailable
      }
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [state]);

  return (
    <EvalWizardContext.Provider value={{ state, dispatch }}>
      {children}
    </EvalWizardContext.Provider>
  );
}

export function useEvalWizard(): EvalWizardContextValue {
  const ctx = useContext(EvalWizardContext);
  if (!ctx) throw new Error('useEvalWizard must be used within EvalWizardProvider');
  return ctx;
}
