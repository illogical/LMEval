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
  expectedOutput?: string;
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

export type EvalComparisonMode = 'model' | 'prompt' | 'matrix';

export interface EvaluationConfig {
  id: string;
  name: string;
  promptIds: string[];
  modelIds: string[];
  comparisonMode?: EvalComparisonMode;
  purposeTemplateId?: string;
  testSuiteId?: string;
  userMessage?: string;
  inlineTestCases?: TestCase[];
  templateId?: string;
  judgeModelId?: string;
  enablePairwise?: boolean;
  runsPerCell?: number;
  sessionId?: string;
  sessionVersion?: number;
  baselineId?: string;
  status: EvalStatus;
  startedAt?: string;
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
  assertionResults?: Array<{
    type: string;
    pass: boolean;
    score?: number;
    reason?: string;
    metric?: string;
  }>;
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

export interface TestCaseModelResult {
  avgCompositeScore?: number;
  passRate: number;
  completedRuns: number;
  totalRuns: number;
}

export interface TestCaseSummary {
  testCaseId: string;
  totalRuns: number;
  passRate: number;
  avgCompositeScore?: number;
  byModel: Record<string, TestCaseModelResult>;
}

export interface AssertionSummary {
  type: string;
  metric?: string;
  total: number;
  passed: number;
  failed: number;
  sampleReason?: string;
  sampleCellId?: string;
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
  testCaseSummaries?: TestCaseSummary[];
  assertionSummary?: AssertionSummary[];
  consistency?: Record<string, number>;
  perspectiveIds?: string[];
}

export interface EvaluationHistoryEntry {
  evalId: string;
  date: string;
  modelScores: Record<string, number>;
  promptScores: Record<string, number>;
}

export interface BaselineSummary {
  slug: string;
  evalId: string;
  savedAt: string;
  modelIds: string[];
  avgCompositeScore?: number;
}

export interface EvalStreamEvent {
  type: 'cell:started' | 'cell:completed' | 'cell:failed' | 'eval:progress' | 'eval:completed' | 'eval:cancelled' | 'eval:failed' | 'judge:started' | 'judge:completed';
  evalId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export type PurposeCategory = 'classification' | 'tagging' | 'summarization' | 'custom';

export type AssertionStrategyType = 'exact-label' | 'label-overlap' | 'llm-rubric' | 'custom';

export interface AssertionStrategy {
  type: AssertionStrategyType;
  config: Record<string, unknown>;
}

export interface EvalPurposeTemplate {
  id: string;
  name: string;
  description: string;
  purposeCategory: PurposeCategory;
  builtIn: boolean;
  seedPromptContent?: string;
  defaultComparisonMode: EvalComparisonMode;
  assertionStrategy: AssertionStrategy;
  starterTestCases: TestCase[];
  createdAt: string;
  updatedAt: string;
}

export interface EvalPreset {
  id: string;
  name: string;
  description?: string;
  modelIds: string[];
  comparisonMode?: EvalComparisonMode;
  templateId?: string;
  testSuiteId?: string;
  judgeModelId?: string;
  enablePairwise: boolean;
  runsPerCell: number;
  createdAt: string;
  updatedAt: string;
}
