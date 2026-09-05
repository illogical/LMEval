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
  /**
   * Minimal grounding fields added to support R6's deterministic summarization
   * checks. Full grounding-field support (expectedLabels/caseTags/requiredFacts,
   * CSV/JSON import wiring, deprecation of `tags`) is TASK.md Track A4, not this
   * pass — these two fields exist only so summarization has something concrete
   * to check "preserved" / "not claimed" against.
   */
  protectedTokens?: string[];
  forbiddenClaims?: string[];
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

export interface InferenceParams {
  temperature: number;
  maxTokens: number;
  seed?: number;
}

export interface ResolvedInferenceParams extends InferenceParams {
  source: 'config' | 'purposeTemplate' | 'default';
}

export interface TransportProvenance {
  /** Distinct LMApi endpoint paths actually used by this evaluation's model ids. */
  endpointPaths: string[];
  /**
   * LMEval always sends structured system+user chat messages. The 'flattened-prompt'
   * value exists only so an imported MemoryApi snapshot's declared shape can be compared
   * against this one using the same vocabulary (see TASK.md Track A10).
   */
  messageShape: 'chat-messages' | 'flattened-prompt';
  /** False until LMApi's chat-completions schema accepts and forwards `seed`. */
  seedHonored: boolean;
}

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
  /** Per-run inference override; takes precedence over the purpose template's default. */
  inference?: InferenceParams;
  /**
   * Resolved once at run start (config -> purpose template -> none) and persisted so the
   * value used is never re-derived. Absence on an evaluation predating this field, or on one
   * where neither tier declared parameters, is itself the "unspecified" signal.
   */
  resolvedInference?: ResolvedInferenceParams;
  /** True when resolution found nothing at either tier — result is unusable as a baseline or promotion input. */
  inferenceParametersUnspecified?: boolean;
  transportProvenance?: TransportProvenance;
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
  /** Fraction of completed cells with a captured finishReason other than 'stop'; undefined when unmeasured. */
  truncationRate?: number;
  /** Mirrors EvaluationConfig.resolvedInference for display without a second fetch. */
  resolvedInference?: ResolvedInferenceParams;
  /** Mirrors EvaluationConfig.transportProvenance for display without a second fetch. */
  transportProvenance?: TransportProvenance;
  /** R4-R7: task-specific metrics + gate verdict. Present only when the eval used a built-in purpose template. */
  taskMetrics?: TaskMetrics;
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

export type AssertionStrategyType = 'exact-label' | 'label-overlap' | 'grounded-summary' | 'custom';

/** R1: classification — the response must equal one of the declared labels exactly. */
export interface ExactLabelConfig {
  labels: string[];
}

/** R5 (tagging): the predicted tag set must overlap the expected set by at least `minimumCaseF1`. */
export interface LabelOverlapConfig {
  vocabulary: string[];
  minimumCaseF1: number;
}

/** R6 (summarization): deterministic guards + rubric grading template. */
export interface GroundedSummaryConfig {
  templateId: string;
  dimensions?: string[];
  /** [min, max] fraction of input length the summary must fall within. */
  compressionRange?: [number, number];
}

/**
 * 'custom' is intentionally NOT a plugin point (see plan Key Decisions/Scope
 * Boundaries — a generalized custom task-type system is explicitly deferred).
 * This shape exists only so R2's "invalid custom config is a 400, not a silent
 * no-op" has something concrete to validate: a custom strategy must at least
 * describe itself.
 */
export interface CustomAssertionConfig {
  description: string;
}

export type AssertionStrategy =
  | { type: 'exact-label'; config: ExactLabelConfig }
  | { type: 'label-overlap'; config: LabelOverlapConfig }
  | { type: 'grounded-summary'; config: GroundedSummaryConfig }
  | { type: 'custom'; config: CustomAssertionConfig };

// --- R4/R5/R6/R7: task-appropriate scoring -------------------------------

export interface PerClassMetric {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface GateResult {
  pass: boolean;
  failures: string[];
}

export interface ClassificationTaskMetrics {
  taskType: 'classification';
  accuracy: number;
  macroF1: number;
  perClass: Record<string, PerClassMetric>;
  invalidLabelRate: number;
  formatComplianceRate: number;
  /** confusionMatrix[expectedLabel][predictedLabel] = count. 'INVALID' buckets predictions outside the label set. */
  confusionMatrix: Record<string, Record<string, number>>;
  /** Fraction of repeated-run groups (runsPerCell > 1) where every run predicted the same label. Undefined when runsPerCell === 1. */
  runToRunAgreement?: number;
  gate: GateResult;
}

export interface TaggingTaskMetrics {
  taskType: 'tagging';
  microPrecision: number;
  microRecall: number;
  microF1: number;
  macroLabelF1: number;
  jaccardMean: number;
  exactSetMatchRate: number;
  unknownTagRate: number;
  duplicateTagRate: number;
  formatComplianceRate: number;
  perLabel: Record<string, PerClassMetric>;
  gate: GateResult;
}

export interface SummarizationDeterministicChecks {
  noPreambleRate: number;
  noHeadingRate: number;
  noFenceRate: number;
  compressionInRangeRate: number;
  protectedTokensPreservedRate: number;
  noForbiddenClaimsRate: number;
}

export interface SummarizationRubricScores {
  faithfulness: number;
  salientCoverage: number;
  retrievalUtility: number;
  concision: number;
  weighted: number;
}

export interface SummarizationTaskMetrics {
  taskType: 'summarization';
  deterministic: SummarizationDeterministicChecks;
  /** Median across cases of each case's median-of-3-judge-passes rubric scores. */
  medianRubric: SummarizationRubricScores;
  criticalUnsupportedClaimRate: number;
  /** True when the judge model is also one of the models under evaluation — scores are advisory only. */
  selfJudgeGuardViolated: boolean;
  gate: GateResult;
}

export type TaskMetrics = ClassificationTaskMetrics | TaggingTaskMetrics | SummarizationTaskMetrics;

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
  /** Default inference parameters for evaluations using this template, absent per-run override. */
  inference?: InferenceParams;
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
