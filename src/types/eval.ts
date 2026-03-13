// Core evaluation system types

export interface JudgePerspective {
  id: string;
  name: string;
  description: string;
  weight: number;
  systemPrompt: string;
  scoringScale: {
    min: number;
    max: number;
    labels: Record<number, string>;
  };
}

export interface EvalTemplate {
  id: string;
  name: string;
  description: string;
  deterministicChecks: {
    formatCompliance: boolean;
    jsonSchemaValidation: boolean;
    jsonSchema?: object;
    toolCallValidation: boolean;
    keywordPresence?: string[];
    keywordAbsence?: string[];
    maxTokens?: number;
    minTokens?: number;
  };
  judgeConfig: {
    enabled: boolean;
    model: string;
    perspectives: JudgePerspective[];
    pairwiseComparison: boolean;
    runsPerCombination: number;
  };
  referenceAnswer?: string;
  referenceCriteria?: string[];
  isBuiltIn?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface PromptVersionMeta {
  version: number;
  notes?: string;
  filePath: string;
  createdAt: string;
  tokenEstimate?: number;
}

export interface PromptManifest {
  id: string;
  slug: string;
  name: string;
  description?: string;
  currentVersion: number;
  versions: PromptVersionMeta[];
  toolDefinitions?: ToolDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface ExpectedToolCall {
  functionName: string;
  requiredArgs?: string[];
  argSchema?: object;
  order?: number;
}

export interface TestCase {
  id: string;
  name: string;
  userMessage: string;
  expectedToolCalls?: ExpectedToolCall[];
  referenceAnswer?: string;
  tags?: string[];
}

export interface TestSuite {
  id: string;
  slug: string;
  name: string;
  description?: string;
  testCases: TestCase[];
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationConfig {
  id: string;
  name: string;
  templateId: string;
  promptVersions: {
    promptId: string;
    version: number;
  }[];
  models: string[];
  testSuiteId?: string;
  inlineTestCases?: TestCase[];
  judgeConfig: EvalTemplate['judgeConfig'];
  toolDefinitions?: ToolDefinition[];
  createdAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  baselineId?: string;
  errorMessage?: string;
  completedAt?: string;
}

export interface ToolCallResult {
  functionName: string;
  arguments: object;
  valid: boolean;
  errors?: string[];
}

export interface EvalMatrixCell {
  id: string;
  promptId: string;
  promptVersion: number;
  modelId: string;
  testCaseId: string;
  runNumber: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  response: {
    content: string;
    toolCalls?: ToolCallResult[];
    finishReason: string;
  };
  metrics: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    tokensPerSecond: number;
    timeToFirstTokenMs?: number;
    serverName: string;
    formatCompliant: boolean | null;
    jsonSchemaValid: boolean | null;
    jsonSchemaErrors?: string[];
    toolCallsValid: boolean | null;
    toolCallErrors?: string[];
    keywordsPresent?: Record<string, boolean>;
    keywordsAbsent?: Record<string, boolean>;
    tokenCount: number;
  };
  compositeScore?: number;
}

export interface JudgeResult {
  cellId: string;
  perspectiveId: string;
  judgeModel: string;
  score: number;
  justification: string;
  durationMs: number;
}

export interface PairwiseRanking {
  cellIdA: string;
  cellIdB: string;
  winnerId: string;
  justification: string;
  judgeModel: string;
}

export interface EvaluationResults {
  evalId: string;
  matrix: EvalMatrixCell[];
  judgeResults: JudgeResult[];
  pairwiseRankings?: PairwiseRanking[];
  completedAt: string;
}

export interface ModelRanking {
  modelId: string;
  compositeScore: number;
  perspectiveScores: Record<string, number>;
  deterministicPassRate: number;
  avgLatencyMs: number;
  avgTokensPerSecond: number;
  consistencyScore?: number;
}

export interface PromptRanking {
  promptId: string;
  version: number;
  compositeScore: number;
  perspectiveScores: Record<string, number>;
}

export interface EvaluationSummary {
  evalId: string;
  modelRankings: ModelRanking[];
  promptRankings: PromptRanking[];
  regression?: {
    baselineId: string;
    improved: string[];
    regressed: string[];
    unchanged: string[];
    details: Record<string, { before: number; after: number; delta: number }>;
  };
  generatedAt: string;
}

export type EvalStreamEventType =
  | 'cell:started'
  | 'cell:completed'
  | 'cell:failed'
  | 'judge:started'
  | 'judge:completed'
  | 'eval:progress'
  | 'eval:completed'
  | 'eval:failed';

export interface EvalStreamEvent {
  type: EvalStreamEventType;
  evalId: string;
  data?: unknown;
  timestamp: string;
}
