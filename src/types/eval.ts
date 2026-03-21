export type EvalStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JudgePerspective {
  id: string;
  name: string;
  description: string;
  weight: number;
  criteria: string;
  scoringGuide: string;
}

export interface EvalTemplate {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  perspectives: JudgePerspective[];
  deterministicChecks?: {
    requiredKeywords?: string[];
    forbiddenKeywords?: string[];
    jsonSchema?: Record<string, unknown>;
    maxTokens?: number;
  };
  suggestedTestCases?: Array<{
    userMessage: string;
    description?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface PromptVersionMeta {
  version: number;
  createdAt: string;
  description?: string;
  tokensEstimate?: number;
}

export interface PromptManifest {
  id: string;
  slug: string;
  name: string;
  description?: string;
  versions: PromptVersionMeta[];
  tools?: ToolDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface TestCase {
  id: string;
  userMessage: string;
  description?: string;
  expectedKeywords?: string[];
  forbiddenKeywords?: string[];
  expectedToolCalls?: Array<{
    functionName: string;
    argumentMatchers?: Record<string, unknown>;
  }>;
  referenceAnswer?: string;
  jsonSchema?: Record<string, unknown>;
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
  promptIds: string[];
  modelIds: string[];
  testSuiteId?: string;
  userMessage?: string;
  templateId?: string;
  judgeModelId?: string;
  enablePairwise?: boolean;
  runsPerCell?: number;
  sessionId?: string;
  sessionVersion?: number;
  baselineId?: string;
  status: EvalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallResult {
  functionName: string;
  arguments: Record<string, unknown>;
  matched: boolean;
}

export interface JudgeResult {
  perspectiveId: string;
  score: number;
  justification: string;
  rawResponse?: string;
}

export interface PairwiseRanking {
  cellIdA: string;
  cellIdB: string;
  winner: 'A' | 'B' | 'tie';
  justification: string;
}

export interface EvalMatrixCell {
  id: string;
  evalId: string;
  promptId: string;
  promptVersion: number;
  modelId: string;
  testCaseId: string;
  run: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  request?: {
    systemPrompt: string;
    userMessage: string;
    model: string;
  };
  response?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  tokensPerSecond?: number;
  serverName?: string;
  deterministicMetrics?: {
    keywordsFound: string[];
    keywordsMissing: string[];
    forbiddenFound: string[];
    jsonSchemaValid?: boolean;
    jsonSchemaErrors?: string[];
    toolCallResults?: ToolCallResult[];
  };
  judgeResults?: JudgeResult[];
  compositeScore?: number;
  error?: string;
  retryAttempts?: Array<{
    attemptNumber: number;
    error: string;
    timestamp: string;
  }>;
  errorType?: string;
}

export interface EvalModelSummary {
  modelId: string;
  avgCompositeScore?: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTokensPerSecond: number;
  successRate: number;
  rank?: number;
  perspectiveScores?: Record<string, number>;
}

export interface EvalPromptSummary {
  promptId: string;
  promptVersion: number;
  avgCompositeScore?: number;
  avgDurationMs: number;
  successRate: number;
}

export interface MetricRegression {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  status: 'improved' | 'regressed' | 'unchanged';
}

export interface RegressionResult {
  metrics: MetricRegression[];
  hasRegressions: boolean;
  hasImprovements: boolean;
}

export interface EvaluationSummary {
  evalId: string;
  totalCells: number;
  completedCells: number;
  failedCells: number;
  modelSummaries: EvalModelSummary[];
  promptSummaries: EvalPromptSummary[];
  pairwiseRankings?: PairwiseRanking[];
  completedAt?: string;
  regression?: RegressionResult;
}

export interface EvalStreamEvent {
  type: 'cell:started' | 'cell:completed' | 'cell:failed' | 'eval:progress' | 'eval:completed' | 'eval:failed' | 'judge:started' | 'judge:completed';
  evalId: string;
  data: Record<string, unknown>;
  timestamp: number;
}
