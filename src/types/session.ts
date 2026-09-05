export interface SessionSlot {
  promptId: string;
  promptVersion: number;
}

export interface SessionVersionMeta {
  version: number;
  createdAt: string;
  description?: string;
  promptA: SessionSlot;
  promptB: SessionSlot;
}

export interface SessionVersion {
  sessionId: string;
  version: number;
  createdAt: string;
  description?: string;
  promptA: SessionSlot;
  promptB: SessionSlot;
  evalRunIds: string[];
}

export interface SessionManifest {
  id: string;
  slug: string;
  name: string;
  description?: string;
  latestVersion: number;
  versions: SessionVersionMeta[];
  createdAt: string;
  updatedAt: string;
}

export interface EvalRun {
  id: string;
  sessionId: string;
  sessionVersion: number;
  evalId: string;
  createdAt: string;
  completedAt?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  scoreSummary?: {
    promptAScore?: number;
    promptBScore?: number;
    scoreDelta?: number;
    totalCells: number;
    completedCells: number;
    failedCells: number;
  };
  notes?: string;
  committedAt?: string;
  commitHash?: string;
}

export interface ImprovementSuggestion {
  id: string;
  targetSlot: 'A' | 'B';
  currentContent: string;
  revisedContent: string;
  rationale: string;
  estimatedImpact?: string;
}

/** B3: cached result of POST /api/eval/evaluations/:id/summary-analysis. */
export interface SummaryAnalysis {
  evalId: string;
  generatedAt: string;
  refinementModel: string;
  overview: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: ImprovementSuggestion[];
}
