import React, {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
} from 'react';
import type { EvalTemplate, TestCase, EvaluationResults, EvaluationSummary } from '../types/eval';

export interface PromptTab {
  id: string;
  label: string;
  content: string;
  color: string;
  mode: 'editor' | 'file' | 'saved';
  savedPromptId?: string;
  savedVersion?: number;
}

export interface LiveFeedEntry {
  cellId: string;
  modelId: string;
  testCaseName: string;
  passed: boolean | null;
  score: number | null;
  timestamp: number;
}

export interface EvalState {
  // Config phase
  prompts: PromptTab[];
  activePromptIdx: number;
  selectedModels: string[];
  testCases: TestCase[];
  template: EvalTemplate | null;
  judgeModel: string;
  pairwiseEnabled: boolean;
  runsPerCombination: number;

  // Evaluation metadata
  evalName: string;
  currentEvalId: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';

  // Execution progress
  progress: {
    phase: number;
    totalPhases: number;
    completedCells: number;
    totalCells: number;
    elapsedMs: number;
  };
  liveFeed: LiveFeedEntry[];

  // Results
  results: EvaluationResults | null;
  summary: EvaluationSummary | null;
  activeResultTab: 'scoreboard' | 'compare' | 'details' | 'metrics' | 'timeline';
}

const TAB_COLORS = ['#f59e0b', '#14b8a6', '#0ea5e9', '#a78bfa', '#f472b6', '#34d399'];

const defaultState: EvalState = {
  prompts: [
    { id: crypto.randomUUID(), label: 'Prompt A', content: '', color: TAB_COLORS[0], mode: 'editor' },
  ],
  activePromptIdx: 0,
  selectedModels: [],
  testCases: [],
  template: null,
  judgeModel: '',
  pairwiseEnabled: false,
  runsPerCombination: 1,
  evalName: 'Untitled Evaluation',
  currentEvalId: null,
  status: 'idle',
  progress: { phase: 0, totalPhases: 2, completedCells: 0, totalCells: 0, elapsedMs: 0 },
  liveFeed: [],
  results: null,
  summary: null,
  activeResultTab: 'scoreboard',
};

type Action =
  | { type: 'SET_EVAL_NAME'; name: string }
  | { type: 'ADD_PROMPT' }
  | { type: 'REMOVE_PROMPT'; idx: number }
  | { type: 'SET_ACTIVE_PROMPT'; idx: number }
  | { type: 'UPDATE_PROMPT'; idx: number; patch: Partial<PromptTab> }
  | { type: 'SET_SELECTED_MODELS'; models: string[] }
  | { type: 'TOGGLE_MODEL'; modelId: string }
  | { type: 'SET_TEST_CASES'; cases: TestCase[] }
  | { type: 'SET_TEMPLATE'; template: EvalTemplate | null }
  | { type: 'SET_JUDGE_MODEL'; model: string }
  | { type: 'SET_PAIRWISE'; enabled: boolean }
  | { type: 'SET_RUNS'; runs: number }
  | { type: 'SET_STATUS'; status: EvalState['status'] }
  | { type: 'SET_EVAL_ID'; id: string }
  | { type: 'UPDATE_PROGRESS'; progress: Partial<EvalState['progress']> }
  | { type: 'ADD_LIVE_FEED'; entry: LiveFeedEntry }
  | { type: 'SET_RESULTS'; results: EvaluationResults }
  | { type: 'SET_SUMMARY'; summary: EvaluationSummary }
  | { type: 'SET_RESULT_TAB'; tab: EvalState['activeResultTab'] }
  | { type: 'RESET' };

function reducer(state: EvalState, action: Action): EvalState {
  switch (action.type) {
    case 'SET_EVAL_NAME':
      return { ...state, evalName: action.name };

    case 'ADD_PROMPT': {
      const idx = state.prompts.length;
      const color = TAB_COLORS[idx % TAB_COLORS.length];
      const label = `Prompt ${String.fromCharCode(65 + idx)}`;
      return {
        ...state,
        prompts: [...state.prompts, { id: crypto.randomUUID(), label, content: '', color, mode: 'editor' }],
        activePromptIdx: idx,
      };
    }

    case 'REMOVE_PROMPT': {
      if (state.prompts.length <= 1) return state;
      const prompts = state.prompts.filter((_, i) => i !== action.idx);
      const activePromptIdx = Math.min(state.activePromptIdx, prompts.length - 1);
      return { ...state, prompts, activePromptIdx };
    }

    case 'SET_ACTIVE_PROMPT':
      return { ...state, activePromptIdx: action.idx };

    case 'UPDATE_PROMPT': {
      const prompts = state.prompts.map((p, i) =>
        i === action.idx ? { ...p, ...action.patch } : p
      );
      return { ...state, prompts };
    }

    case 'SET_SELECTED_MODELS':
      return { ...state, selectedModels: action.models };

    case 'TOGGLE_MODEL': {
      const has = state.selectedModels.includes(action.modelId);
      const selectedModels = has
        ? state.selectedModels.filter(m => m !== action.modelId)
        : [...state.selectedModels, action.modelId];
      return { ...state, selectedModels };
    }

    case 'SET_TEST_CASES':
      return { ...state, testCases: action.cases };

    case 'SET_TEMPLATE':
      return { ...state, template: action.template };

    case 'SET_JUDGE_MODEL':
      return { ...state, judgeModel: action.model };

    case 'SET_PAIRWISE':
      return { ...state, pairwiseEnabled: action.enabled };

    case 'SET_RUNS':
      return { ...state, runsPerCombination: action.runs };

    case 'SET_STATUS':
      return { ...state, status: action.status };

    case 'SET_EVAL_ID':
      return { ...state, currentEvalId: action.id };

    case 'UPDATE_PROGRESS':
      return { ...state, progress: { ...state.progress, ...action.progress } };

    case 'ADD_LIVE_FEED':
      return { ...state, liveFeed: [action.entry, ...state.liveFeed].slice(0, 100) };

    case 'SET_RESULTS':
      return { ...state, results: action.results };

    case 'SET_SUMMARY':
      return { ...state, summary: action.summary };

    case 'SET_RESULT_TAB':
      return { ...state, activeResultTab: action.tab };

    case 'RESET':
      return {
        ...defaultState,
        prompts: [
          { id: crypto.randomUUID(), label: 'Prompt A', content: '', color: TAB_COLORS[0], mode: 'editor' },
        ],
      };

    default:
      return state;
  }
}

interface EvalContextValue {
  state: EvalState;
  dispatch: Dispatch<Action>;
}

const EvalContext = createContext<EvalContextValue | null>(null);

export function EvalProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, defaultState);
  return (
    <EvalContext.Provider value={{ state, dispatch }}>
      {children}
    </EvalContext.Provider>
  );
}

export function useEval() {
  const ctx = useContext(EvalContext);
  if (!ctx) throw new Error('useEval must be used within EvalProvider');
  return ctx;
}
