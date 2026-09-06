import type {
  EvalMatrixCell,
  EvaluationSummary,
  EvalModelSummary,
  EvalPromptSummary,
  RegressionResult,
  MetricRegression,
  PairwiseRanking,
  TestCaseSummary,
  TestCaseModelResult,
  AssertionSummary,
  TestCase,
  AssertionStrategy,
  PurposeCategory,
  TaskMetrics,
  ClassificationTaskMetrics,
  TaggingTaskMetrics,
  SummarizationTaskMetrics,
  PerClassMetric,
  EvalComparisonMode,
} from '../../src/types/eval';
import { checkSummaryDeterministics, DEFAULT_COMPRESSION_RANGE } from './summarizationChecks';
import { bootstrapCI, mcNemarTest, caseCountGate } from './StatisticsService';

// Minimum relative change required before a metric is considered regressed or improved
const SCORE_REGRESSION_THRESHOLD = 0.02; // 2% change in composite score
const LATENCY_REGRESSION_THRESHOLD = 0.05; // 5% change in latency

function f1(precision: number, recall: number): number {
  return (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * R4: classification metrics. Accuracy/exact-match uses a trimmed exact-string
 * comparison to expectedOutput — deliberately not case- or punctuation-folded,
 * since that leniency is exactly what R1 removed (expectedKeywords prose
 * matching). A response outside the declared label set buckets into 'INVALID'
 * in the confusion matrix rather than being silently dropped.
 */
export function computeClassificationMetrics(
  cells: EvalMatrixCell[],
  testCaseById: Map<string, TestCase>,
  labels: string[],
  runsPerCell: number,
  baselineCells?: EvalMatrixCell[]
): ClassificationTaskMetrics {
  const labelSet = new Set(labels);
  const completed = cells.filter(c => c.status === 'completed');
  const scoredCells = completed
    .map(cell => {
      const tc = testCaseById.get(cell.testCaseId);
      const expected = tc?.expectedOutput?.trim() || tc?.expectedKeywords?.[0]?.trim();
      if (!expected) return null;
      const predicted = (cell.response ?? '').trim();
      return { cell, expected, predicted };
    })
    .filter((x): x is { cell: EvalMatrixCell; expected: string; predicted: string } => x != null);

  const confusionMatrix: Record<string, Record<string, number>> = {};
  let exactCount = 0;
  let invalidCount = 0;
  let formatCompliantCount = 0;

  for (const { expected, predicted } of scoredCells) {
    const validLabel = labelSet.has(predicted);
    const bucket = validLabel ? predicted : 'INVALID';
    confusionMatrix[expected] ??= {};
    confusionMatrix[expected][bucket] = (confusionMatrix[expected][bucket] ?? 0) + 1;
    if (predicted === expected) exactCount++;
    if (!validLabel) invalidCount++;
    if (validLabel) formatCompliantCount++; // format-compliant == exactly one declared label, no wrapper text
  }

  const total = scoredCells.length || 1;
  const perClass: Record<string, PerClassMetric> = {};
  for (const label of labels) {
    let tp = 0, fp = 0, support = 0;
    for (const [expected, predictions] of Object.entries(confusionMatrix)) {
      const count = predictions[label] ?? 0;
      if (expected === label) { tp += count; support += Object.values(predictions).reduce((a, b) => a + b, 0); }
      else fp += count;
    }
    const fn = support - tp;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = support > 0 ? tp / (tp + fn) : 0;
    perClass[label] = { precision, recall, f1: f1(precision, recall), support };
  }

  const withSupport = Object.values(perClass).filter(c => c.support > 0);
  const macroF1 = withSupport.length > 0 ? withSupport.reduce((s, c) => s + c.f1, 0) / withSupport.length : 0;

  let runToRunAgreement: number | undefined;
  if (runsPerCell > 1) {
    const groups = new Map<string, string[]>();
    for (const { cell, predicted } of scoredCells) {
      const key = `${cell.promptId}::${cell.modelId}::${cell.testCaseId}`;
      const arr = groups.get(key) ?? [];
      arr.push(predicted);
      groups.set(key, arr);
    }
    const multi = [...groups.values()].filter(arr => arr.length > 1);
    if (multi.length > 0) {
      const agreeing = multi.filter(arr => arr.every(p => p === arr[0])).length;
      runToRunAgreement = agreeing / multi.length;
    }
  }

  const invalidLabelRate = invalidCount / total;
  const formatComplianceRate = formatCompliantCount / total;
  const failures: string[] = [];
  const lowRecallClasses = withSupport.filter(c => c.recall < 0.80);
  if (lowRecallClasses.length > 0) failures.push(`${lowRecallClasses.length} class(es) below 0.80 recall`);
  if (invalidLabelRate > 0) failures.push(`invalid-label rate ${(invalidLabelRate * 100).toFixed(1)}% > 0`);
  if (formatComplianceRate < 1) failures.push(`format-compliance rate ${(formatComplianceRate * 100).toFixed(1)}% < 100%`);

  // A7: bootstrap CI over per-case exact-match, standing in for macro-F1's gate
  // threshold — the two correlate tightly at the case level and per-class
  // bootstrapping isn't worth the complexity for a point-in-time gate check.
  const exactMatches = scoredCells.map(({ expected, predicted }) => (predicted === expected ? 1 : 0));
  const accuracyCI = bootstrapCI(exactMatches);
  const caseCount = scoredCells.length;
  const { verdict: ciVerdict, neededCases } = caseCountGate(accuracyCI, 0.90, caseCount);
  if (ciVerdict === 'fail') failures.push(`macro-F1 ${macroF1.toFixed(2)} < 0.90 (95% CI ${accuracyCI.lower.toFixed(2)}-${accuracyCI.upper.toFixed(2)})`);
  else if (ciVerdict === 'inconclusive') failures.push(`gate inconclusive at ${caseCount} cases (95% CI ${accuracyCI.lower.toFixed(2)}-${accuracyCI.upper.toFixed(2)} straddles 0.90) — need ~${neededCases} more cases`);

  const otherFail = failures.some(f => !f.startsWith('gate inconclusive'));
  const verdict: 'pass' | 'fail' | 'inconclusive' = otherFail ? 'fail' : ciVerdict === 'pass' ? 'pass' : ciVerdict;

  // A7: McNemar test vs. a baseline's per-case exact-match, aligned by testCaseId.
  let mcNemar: ClassificationTaskMetrics['mcNemar'];
  if (baselineCells && baselineCells.length > 0) {
    const baselineByCase = new Map<string, boolean>();
    for (const cell of baselineCells.filter(c => c.status === 'completed')) {
      const tc = testCaseById.get(cell.testCaseId);
      const expected = tc?.expectedOutput?.trim() || tc?.expectedKeywords?.[0]?.trim();
      if (!expected) continue;
      baselineByCase.set(cell.testCaseId, (cell.response ?? '').trim() === expected);
    }
    const candidateByCase = new Map<string, boolean>();
    for (const { cell, expected, predicted } of scoredCells) {
      candidateByCase.set(cell.testCaseId, predicted === expected);
    }
    const sharedIds = [...candidateByCase.keys()].filter(id => baselineByCase.has(id));
    if (sharedIds.length > 0) {
      mcNemar = mcNemarTest(
        sharedIds.map(id => baselineByCase.get(id)!),
        sharedIds.map(id => candidateByCase.get(id)!)
      );
    }
  }

  return {
    taskType: 'classification',
    accuracy: exactCount / total,
    macroF1,
    perClass,
    invalidLabelRate,
    formatComplianceRate,
    confusionMatrix,
    runToRunAgreement,
    accuracyCI,
    mcNemar,
    gate: { pass: verdict === 'pass', failures, verdict, caseCount, neededCases: verdict === 'inconclusive' ? neededCases : undefined },
  };
}

/**
 * R5: tagging metrics. Raw output is split on commas and trimmed — nothing is
 * "repaired" (no fuzzy-matching a near-miss token onto the vocabulary, no
 * dropping obviously-wrong tokens before scoring) so unknown-tag and
 * duplicate-tag rates reflect exactly what the model emitted.
 */
export function computeTaggingMetrics(
  cells: EvalMatrixCell[],
  testCaseById: Map<string, TestCase>,
  vocabulary: string[]
): TaggingTaskMetrics {
  const vocabSet = new Set(vocabulary);
  const completed = cells.filter(c => c.status === 'completed');

  let sumTP = 0, sumFP = 0, sumFN = 0;
  let jaccardSum = 0;
  const perCaseJaccard: number[] = [];
  let exactSetMatches = 0;
  let unknownTokens = 0, duplicateTokens = 0, totalTokens = 0;
  let formatCompliantCount = 0;
  let caseCount = 0;
  const perLabelCounts = new Map<string, { tp: number; fp: number; fn: number }>();

  for (const cell of completed) {
    const tc = testCaseById.get(cell.testCaseId);
    const expectedLabels = tc?.expectedLabels ?? tc?.tags;
    if (!expectedLabels) continue;
    caseCount++;

    const rawTokens = (cell.response ?? '').split(',').map(t => t.trim()).filter(Boolean);
    totalTokens += rawTokens.length;
    const seen = new Set<string>();
    for (const t of rawTokens) {
      if (seen.has(t)) duplicateTokens++;
      seen.add(t);
      if (!vocabSet.has(t)) unknownTokens++;
    }
    const predictedSet = new Set(rawTokens);
    const expectedSet = new Set(expectedLabels);

    const formatCompliant = !/[[\]{}]/.test(cell.response ?? '') && !(cell.response ?? '').includes('\n');
    if (formatCompliant) formatCompliantCount++;

    const intersection = [...expectedSet].filter(t => predictedSet.has(t));
    const union = new Set([...expectedSet, ...predictedSet]);
    const tp = intersection.length;
    const fp = predictedSet.size - tp;
    const fn = expectedSet.size - tp;
    sumTP += tp; sumFP += fp; sumFN += fn;
    const caseJaccard = union.size > 0 ? tp / union.size : 1;
    jaccardSum += caseJaccard;
    perCaseJaccard.push(caseJaccard);
    if (predictedSet.size === expectedSet.size && intersection.length === expectedSet.size) exactSetMatches++;

    const labelsInvolved = new Set([...expectedSet, ...predictedSet]);
    for (const label of labelsInvolved) {
      const entry = perLabelCounts.get(label) ?? { tp: 0, fp: 0, fn: 0 };
      const inExpected = expectedSet.has(label);
      const inPredicted = predictedSet.has(label);
      if (inExpected && inPredicted) entry.tp++;
      else if (inPredicted && !inExpected) entry.fp++;
      else if (inExpected && !inPredicted) entry.fn++;
      perLabelCounts.set(label, entry);
    }
  }

  const total = caseCount || 1;
  const microPrecision = (sumTP + sumFP) > 0 ? sumTP / (sumTP + sumFP) : 0;
  const microRecall = (sumTP + sumFN) > 0 ? sumTP / (sumTP + sumFN) : 0;
  const microF1 = f1(microPrecision, microRecall);

  const perLabel: Record<string, PerClassMetric> = {};
  for (const [label, { tp, fp, fn }] of perLabelCounts) {
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    perLabel[label] = { precision, recall, f1: f1(precision, recall), support: tp + fn };
  }
  const labelF1s = Object.values(perLabel).map(l => l.f1);
  const macroLabelF1 = labelF1s.length > 0 ? labelF1s.reduce((a, b) => a + b, 0) / labelF1s.length : 0;

  const jaccardMean = jaccardSum / total;
  const exactSetMatchRate = exactSetMatches / total;
  const unknownTagRate = totalTokens > 0 ? unknownTokens / totalTokens : 0;
  const duplicateTagRate = totalTokens > 0 ? duplicateTokens / totalTokens : 0;
  const formatComplianceRate = formatCompliantCount / total;

  const failures: string[] = [];
  if (macroLabelF1 < 0.70) failures.push(`macro label-F1 ${macroLabelF1.toFixed(2)} < 0.70`);
  if (exactSetMatchRate < 0.60) failures.push(`exact-set match rate ${(exactSetMatchRate * 100).toFixed(1)}% < 60%`);
  if (unknownTagRate > 0) failures.push(`unknown-tag rate ${(unknownTagRate * 100).toFixed(1)}% > 0`);

  // A7: bootstrap CI over per-case Jaccard, standing in for micro-F1's gate
  // threshold (both derive from the same TP/FP/FN counts at the case level).
  const jaccardCI = bootstrapCI(perCaseJaccard);
  const { verdict: ciVerdict, neededCases } = caseCountGate(jaccardCI, 0.85, caseCount);
  if (ciVerdict === 'fail') failures.push(`micro-F1 ${microF1.toFixed(2)} < 0.85 (95% CI ${jaccardCI.lower.toFixed(2)}-${jaccardCI.upper.toFixed(2)})`);
  else if (ciVerdict === 'inconclusive') failures.push(`gate inconclusive at ${caseCount} cases (95% CI ${jaccardCI.lower.toFixed(2)}-${jaccardCI.upper.toFixed(2)} straddles 0.85) — need ~${neededCases} more cases`);

  const otherFail = failures.some(f => !f.startsWith('gate inconclusive'));
  const verdict: 'pass' | 'fail' | 'inconclusive' = otherFail ? 'fail' : ciVerdict === 'pass' ? 'pass' : ciVerdict;

  return {
    taskType: 'tagging',
    microPrecision,
    microRecall,
    microF1,
    macroLabelF1,
    jaccardMean,
    exactSetMatchRate,
    unknownTagRate,
    duplicateTagRate,
    formatComplianceRate,
    perLabel,
    jaccardCI,
    gate: { pass: verdict === 'pass', failures, verdict, caseCount, neededCases: verdict === 'inconclusive' ? neededCases : undefined },
  };
}

/**
 * R6: summarization metrics. Deterministic checks reuse
 * `checkSummaryDeterministics` (shared with PromptfooAdapter's per-cell
 * assertion) so aggregate rates and per-cell pass/fail can never disagree.
 * Judge scores come from the 3-pass llm-rubric assertions PromptfooAdapter
 * emits per perspective (metric `${perspectiveName}#1..3`); this groups by the
 * base perspective name, medians the 3 rescaled (1-5) scores per case, then
 * medians across cases — "three independent judge passes...aggregated by
 * median" applied at both levels the plan's language could mean.
 */
export function computeSummarizationMetrics(
  cells: EvalMatrixCell[],
  testCaseById: Map<string, TestCase>,
  compressionRange: [number, number],
  selfJudgeGuardViolated: boolean,
  judgeQualified?: boolean
): SummarizationTaskMetrics {
  const completed = cells.filter(c => c.status === 'completed');
  const total = completed.length || 1;

  let noPreambleCount = 0, noHeadingCount = 0, noFenceCount = 0;
  let compressionOkCount = 0, protectedOkCount = 0, noForbiddenCount = 0;

  // perspectiveBase -> caseKey -> [rescaled scores from the 3 passes]
  const perPerspectiveCaseScores = new Map<string, Map<string, number[]>>();

  for (const cell of completed) {
    const tc = testCaseById.get(cell.testCaseId);
    if (tc) {
      const det = checkSummaryDeterministics(cell.response ?? '', tc, compressionRange);
      if (det.noPreamble) noPreambleCount++;
      if (det.noHeading) noHeadingCount++;
      if (det.noFence) noFenceCount++;
      if (det.compressionInRange) compressionOkCount++;
      if (det.protectedTokensPreserved) protectedOkCount++;
      if (det.noForbiddenClaims) noForbiddenCount++;
    }

    const caseKey = `${cell.promptId}::${cell.modelId}::${cell.testCaseId}::${cell.run}`;
    for (const ar of cell.assertionResults ?? []) {
      if (ar.type !== 'llm-rubric' || ar.score == null || !ar.metric) continue;
      const hashIdx = ar.metric.lastIndexOf('#');
      const base = hashIdx > -1 ? ar.metric.slice(0, hashIdx) : ar.metric;
      const rescaled = 1 + Math.max(0, Math.min(1, ar.score)) * 4;
      const byCase = perPerspectiveCaseScores.get(base) ?? new Map<string, number[]>();
      const arr = byCase.get(caseKey) ?? [];
      arr.push(rescaled);
      byCase.set(caseKey, arr);
      perPerspectiveCaseScores.set(base, byCase);
    }
  }

  // Median-of-3-passes per case, then median across cases, per perspective.
  const perspectiveMedians: Record<string, number> = {};
  for (const [perspective, byCase] of perPerspectiveCaseScores) {
    const caseMedians = [...byCase.values()].map(median);
    perspectiveMedians[perspective] = median(caseMedians);
  }

  const faithfulness = perspectiveMedians['Faithfulness'] ?? 0;
  const salientCoverage = perspectiveMedians['Salient Coverage'] ?? 0;
  const retrievalUtility = perspectiveMedians['Retrieval Utility'] ?? 0;
  const concision = perspectiveMedians['Concision'] ?? 0;
  const weighted = faithfulness * 0.40 + salientCoverage * 0.30 + retrievalUtility * 0.20 + concision * 0.10;

  // A7: per-case weighted score for bootstrapping — each case's own
  // per-perspective median (0 when a perspective didn't fire for that case).
  const allCaseKeys = new Set<string>();
  for (const byCase of perPerspectiveCaseScores.values()) {
    for (const key of byCase.keys()) allCaseKeys.add(key);
  }
  const caseMedianFor = (perspective: string, caseKey: string): number => {
    const scores = perPerspectiveCaseScores.get(perspective)?.get(caseKey);
    return scores ? median(scores) : 0;
  };
  const perCaseWeighted = [...allCaseKeys].map(key =>
    caseMedianFor('Faithfulness', key) * 0.40 +
    caseMedianFor('Salient Coverage', key) * 0.30 +
    caseMedianFor('Retrieval Utility', key) * 0.20 +
    caseMedianFor('Concision', key) * 0.10
  );
  const weightedCI = bootstrapCI(perCaseWeighted);
  const caseCount = allCaseKeys.size;

  // A "critical unsupported claim" is a faithfulness score of 1 (the rubric's
  // "multiple fabrications" floor) on any individual case — no per-dimension
  // finding-level judge output exists yet (that's A8/A11 territory), so this
  // is the coarsest honest signal available from the 1-5 scale today.
  const faithfulnessByCase = perPerspectiveCaseScores.get('Faithfulness');
  let criticalCount = 0;
  if (faithfulnessByCase) {
    for (const scores of faithfulnessByCase.values()) {
      if (median(scores) <= 1) criticalCount++;
    }
  }
  const criticalUnsupportedClaimRate = faithfulnessByCase && faithfulnessByCase.size > 0
    ? criticalCount / faithfulnessByCase.size
    : 0;

  const deterministic = {
    noPreambleRate: noPreambleCount / total,
    noHeadingRate: noHeadingCount / total,
    noFenceRate: noFenceCount / total,
    compressionInRangeRate: compressionOkCount / total,
    protectedTokensPreservedRate: protectedOkCount / total,
    noForbiddenClaimsRate: noForbiddenCount / total,
  };

  const failures: string[] = [];
  if (selfJudgeGuardViolated) failures.push('judge model is also under evaluation — result is advisory only');
  if (faithfulness < 4.5) failures.push(`median Faithfulness ${faithfulness.toFixed(2)} < 4.5`);
  if (criticalUnsupportedClaimRate > 0) failures.push(`${(criticalUnsupportedClaimRate * 100).toFixed(1)}% of cases have a critical unsupported claim`);
  if (deterministic.protectedTokensPreservedRate < 1) failures.push('protected tokens not preserved in all cases');
  if (deterministic.noForbiddenClaimsRate < 1) failures.push('forbidden claim present in at least one case');

  const { verdict: ciVerdict, neededCases } = caseCountGate(weightedCI, 4.2, caseCount);
  if (ciVerdict === 'fail') failures.push(`median weighted score ${weighted.toFixed(2)} < 4.2 (95% CI ${weightedCI.lower.toFixed(2)}-${weightedCI.upper.toFixed(2)})`);
  else if (ciVerdict === 'inconclusive') failures.push(`gate inconclusive at ${caseCount} cases (95% CI ${weightedCI.lower.toFixed(2)}-${weightedCI.upper.toFixed(2)} straddles 4.2) — need ~${neededCases} more cases`);

  // A8: an unqualified (or not-yet-qualified) judge means the result can never
  // clear the gate outright — it's advisory regardless of how the scores look.
  const judgeUnqualified = judgeQualified === false || judgeQualified === undefined;
  const otherFail = failures.some(f => !f.startsWith('gate inconclusive') && !f.startsWith('judge model is also'));
  let verdict: 'pass' | 'fail' | 'inconclusive' | 'advisory';
  if (selfJudgeGuardViolated || judgeUnqualified) verdict = 'advisory';
  else if (otherFail) verdict = 'fail';
  else verdict = ciVerdict === 'pass' ? 'pass' : ciVerdict;
  if (judgeUnqualified && !failures.some(f => f.includes('judge not qualified'))) {
    failures.push('judge not qualified against a calibration set — result is advisory only');
  }

  return {
    taskType: 'summarization',
    deterministic,
    medianRubric: { faithfulness, salientCoverage, retrievalUtility, concision, weighted },
    criticalUnsupportedClaimRate,
    selfJudgeGuardViolated,
    weightedCI,
    judgeQualified,
    gate: { pass: verdict === 'pass', failures, verdict, caseCount, neededCases: verdict === 'inconclusive' ? neededCases : undefined },
  };
}

function computeTaskMetrics(
  cells: EvalMatrixCell[],
  testCases: TestCase[] | undefined,
  purposeCategory: PurposeCategory | undefined,
  assertionStrategy: AssertionStrategy | null | undefined,
  runsPerCell: number,
  selfJudgeGuardViolated: boolean,
  baselineCells?: EvalMatrixCell[],
  judgeQualified?: boolean
): TaskMetrics | undefined {
  if (!testCases || testCases.length === 0 || !purposeCategory) return undefined;
  const testCaseById = new Map(testCases.map(tc => [tc.id, tc]));

  if (purposeCategory === 'classification' && assertionStrategy?.type === 'exact-label') {
    return computeClassificationMetrics(cells, testCaseById, assertionStrategy.config.labels, runsPerCell, baselineCells);
  }
  if (purposeCategory === 'tagging' && assertionStrategy?.type === 'label-overlap') {
    return computeTaggingMetrics(cells, testCaseById, assertionStrategy.config.vocabulary);
  }
  if (purposeCategory === 'summarization' && assertionStrategy?.type === 'grounded-summary') {
    return computeSummarizationMetrics(
      cells,
      testCaseById,
      assertionStrategy.config.compressionRange ?? DEFAULT_COMPRESSION_RANGE,
      selfJudgeGuardViolated,
      judgeQualified
    );
  }
  return undefined;
}

export const SummaryService = {
  computeSummary(
    evalId: string,
    cells: EvalMatrixCell[],
    pairwiseRankings?: PairwiseRanking[],
    options?: {
      runsPerCell?: number;
      perspectiveOrder?: string[];
      resolvedInference?: EvaluationSummary['resolvedInference'];
      transportProvenance?: EvaluationSummary['transportProvenance'];
      testCases?: TestCase[];
      purposeCategory?: PurposeCategory;
      assertionStrategy?: AssertionStrategy | null;
      selfJudgeGuardViolated?: boolean;
      baselineCells?: EvalMatrixCell[];
      judgeQualified?: boolean;
      benchmarkProvenance?: EvaluationSummary['benchmarkProvenance'];
      comparisonMode?: EvalComparisonMode;
    }
  ): EvaluationSummary {
    const completed = cells.filter(c => c.status === 'completed');
    const failed = cells.filter(c => c.status === 'failed');

    // Truncation rate: cells with no captured finishReason (failed cells, or
    // results from a run predating truncation capture) are excluded from both
    // the numerator and denominator rather than counted as truncated.
    const withFinishReason = completed.filter(c => c.finishReason);
    const truncated = withFinishReason.filter(c => c.finishReason !== 'stop');
    const truncationRate = withFinishReason.length > 0
      ? truncated.length / withFinishReason.length
      : undefined;

    const modelMap = new Map<string, EvalMatrixCell[]>();
    for (const cell of completed) {
      const list = modelMap.get(cell.modelId) ?? [];
      list.push(cell);
      modelMap.set(cell.modelId, list);
    }

    const modelSummaries: EvalModelSummary[] = [];
    for (const [modelId, modelCells] of modelMap) {
      const n = modelCells.length;
      const totalCellsForModel = cells.filter(c => c.modelId === modelId).length;
      const avgDurationMs = modelCells.reduce((s, c) => s + (c.durationMs ?? 0), 0) / n;
      const avgInputTokens = modelCells.reduce((s, c) => s + (c.inputTokens ?? 0), 0) / n;
      const avgOutputTokens = modelCells.reduce((s, c) => s + (c.outputTokens ?? 0), 0) / n;
      const avgTokensPerSecond = modelCells.reduce((s, c) => s + (c.tokensPerSecond ?? 0), 0) / n;
      const successRate = n / totalCellsForModel;

      const hasScores = modelCells.some(c => c.compositeScore != null);
      const avgCompositeScore = hasScores
        ? modelCells.reduce((s, c) => s + (c.compositeScore ?? 0), 0) / n
        : undefined;

      const perspectiveScores: Record<string, number> = {};
      const perspectiveCounts: Record<string, number> = {};
      for (const cell of modelCells) {
        for (const jr of cell.judgeResults ?? []) {
          perspectiveScores[jr.perspectiveId] = (perspectiveScores[jr.perspectiveId] ?? 0) + jr.score;
          perspectiveCounts[jr.perspectiveId] = (perspectiveCounts[jr.perspectiveId] ?? 0) + 1;
        }
        // New engine: llm-rubric assertionResults carry a 0-1 score under `metric`
        // (the perspective name) — rescale to the same 1-5 scale judgeResults used
        // so old and new evals aggregate onto one comparable range.
        for (const ar of cell.assertionResults ?? []) {
          if (ar.type !== 'llm-rubric' || ar.score == null || !ar.metric) continue;
          const rescaled = 1 + Math.max(0, Math.min(1, ar.score)) * 4;
          perspectiveScores[ar.metric] = (perspectiveScores[ar.metric] ?? 0) + rescaled;
          perspectiveCounts[ar.metric] = (perspectiveCounts[ar.metric] ?? 0) + 1;
        }
      }
      const avgPerspectiveScores: Record<string, number> = {};
      for (const [id, total] of Object.entries(perspectiveScores)) {
        avgPerspectiveScores[id] = total / perspectiveCounts[id];
      }

      modelSummaries.push({
        modelId,
        avgCompositeScore,
        avgDurationMs,
        avgInputTokens,
        avgOutputTokens,
        avgTokensPerSecond,
        successRate,
        perspectiveScores: Object.keys(avgPerspectiveScores).length > 0 ? avgPerspectiveScores : undefined,
      });
    }

    modelSummaries.sort((a, b) => {
      if (a.avgCompositeScore != null && b.avgCompositeScore != null) {
        return b.avgCompositeScore - a.avgCompositeScore;
      }
      return b.successRate - a.successRate;
    });
    modelSummaries.forEach((m, i) => { m.rank = i + 1; });

    const promptMap = new Map<string, EvalMatrixCell[]>();
    for (const cell of completed) {
      const key = `${cell.promptId}:${cell.promptVersion}`;
      const list = promptMap.get(key) ?? [];
      list.push(cell);
      promptMap.set(key, list);
    }

    const promptSummaries: EvalPromptSummary[] = [];
    for (const [, promptCells] of promptMap) {
      const n = promptCells.length;
      const first = promptCells[0];
      const totalCellsForPrompt = cells.filter(
        c => c.promptId === first.promptId && c.promptVersion === first.promptVersion
      ).length;
      const avgDurationMs = promptCells.reduce((s, c) => s + (c.durationMs ?? 0), 0) / n;
      const successRate = n / totalCellsForPrompt;

      const hasScores = promptCells.some(c => c.compositeScore != null);
      const avgCompositeScore = hasScores
        ? promptCells.reduce((s, c) => s + (c.compositeScore ?? 0), 0) / n
        : undefined;

      promptSummaries.push({
        promptId: first.promptId,
        promptVersion: first.promptVersion,
        avgCompositeScore,
        avgDurationMs,
        successRate,
      });
    }

    // Per-test-case pass rate and per-model breakdown — answers "which inputs
    // break this prompt" (surfaced in the Breakdown tab's "Hardest test cases").
    const testCaseMap = new Map<string, EvalMatrixCell[]>();
    for (const cell of cells) {
      const list = testCaseMap.get(cell.testCaseId) ?? [];
      list.push(cell);
      testCaseMap.set(cell.testCaseId, list);
    }
    const testCaseSummaries: TestCaseSummary[] = [];
    for (const [testCaseId, tcCells] of testCaseMap) {
      const byModel: Record<string, TestCaseModelResult> = {};
      const modelIdsForTc = [...new Set(tcCells.map(c => c.modelId))];
      for (const modelId of modelIdsForTc) {
        const modelCells = tcCells.filter(c => c.modelId === modelId);
        const completedModelCells = modelCells.filter(c => c.status === 'completed');
        const passedModelCells = completedModelCells.filter(
          c => c.assertionResults == null || c.assertionResults.every(a => a.pass)
        );
        const scored = completedModelCells.filter(c => c.compositeScore != null);
        byModel[modelId] = {
          avgCompositeScore: scored.length > 0
            ? scored.reduce((s, c) => s + (c.compositeScore ?? 0), 0) / scored.length
            : undefined,
          passRate: modelCells.length > 0 ? passedModelCells.length / modelCells.length : 0,
          completedRuns: completedModelCells.length,
          totalRuns: modelCells.length,
        };
      }
      const allCompleted = tcCells.filter(c => c.status === 'completed');
      const allPassed = allCompleted.filter(
        c => c.assertionResults == null || c.assertionResults.every(a => a.pass)
      );
      const scoredTc = allCompleted.filter(c => c.compositeScore != null);
      testCaseSummaries.push({
        testCaseId,
        totalRuns: tcCells.length,
        passRate: tcCells.length > 0 ? allPassed.length / tcCells.length : 0,
        avgCompositeScore: scoredTc.length > 0
          ? scoredTc.reduce((s, c) => s + (c.compositeScore ?? 0), 0) / scoredTc.length
          : undefined,
        byModel,
      });
    }
    testCaseSummaries.sort((a, b) => a.passRate - b.passRate);

    // Assertion-type failure breakdown — the most directly actionable prompt
    // feedback: which checks fail most often, with one concrete example each.
    const assertionMap = new Map<string, AssertionSummary>();
    for (const cell of cells) {
      for (const ar of cell.assertionResults ?? []) {
        const key = `${ar.type}::${ar.metric ?? ''}`;
        const entry = assertionMap.get(key) ?? {
          type: ar.type,
          metric: ar.metric,
          total: 0,
          passed: 0,
          failed: 0,
        };
        entry.total++;
        if (ar.pass) entry.passed++;
        else {
          entry.failed++;
          if (!entry.sampleReason && ar.reason) {
            entry.sampleReason = ar.reason;
            entry.sampleCellId = cell.id;
          }
        }
        assertionMap.set(key, entry);
      }
    }
    const assertionSummary = [...assertionMap.values()].sort((a, b) => b.failed - a.failed);

    // Perspective axis order — prefer the template's declared order so the
    // Breakdown tab's grouped-bar chart matches the rubric, not object-key order.
    const seenPerspectives = new Set<string>();
    const perspectiveIds: string[] = [];
    for (const id of options?.perspectiveOrder ?? []) {
      if (!seenPerspectives.has(id)) { seenPerspectives.add(id); perspectiveIds.push(id); }
    }
    for (const m of modelSummaries) {
      for (const id of Object.keys(m.perspectiveScores ?? {})) {
        if (!seenPerspectives.has(id)) { seenPerspectives.add(id); perspectiveIds.push(id); }
      }
    }

    // Consistency (run-to-run std-dev) is only meaningful with repeated runs.
    const consistency = (options?.runsPerCell ?? 1) > 1
      ? this.computeConsistency(cells)
      : undefined;

    let taskMetrics = computeTaskMetrics(
      cells,
      options?.testCases,
      options?.purposeCategory,
      options?.assertionStrategy,
      options?.runsPerCell ?? 1,
      options?.selfJudgeGuardViolated ?? false,
      options?.baselineCells,
      options?.judgeQualified
    );

    if (taskMetrics && options?.benchmarkProvenance?.reviewStatus === 'pending-human-review') {
      taskMetrics = {
        ...taskMetrics,
        gate: {
          ...taskMetrics.gate,
          pass: false,
          verdict: 'advisory',
          failures: [
            ...taskMetrics.gate.failures,
            'Benchmark ground truth is pending human review.',
          ],
        },
      };
    }

    // A9: per-model breakdown for comparisonMode: 'model' runs with more than
    // one candidate — additive alongside the whole-run taskMetrics above,
    // which is computed the same way it always has been.
    let perModelTaskMetrics: Record<string, TaskMetrics> | undefined;
    const distinctModelIds = [...new Set(cells.map(c => c.modelId))];
    if (options?.comparisonMode === 'model' && distinctModelIds.length > 1
      && options?.testCases && options.testCases.length > 0 && options?.purposeCategory) {
      perModelTaskMetrics = {};
      for (const modelId of distinctModelIds) {
        const modelCells = cells.filter(c => c.modelId === modelId);
        const modelTaskMetrics = computeTaskMetrics(
          modelCells,
          options.testCases,
          options.purposeCategory,
          options.assertionStrategy,
          options.runsPerCell ?? 1,
          options.selfJudgeGuardViolated ?? false,
          undefined,
          options.judgeQualified
        );
        if (modelTaskMetrics) perModelTaskMetrics[modelId] = modelTaskMetrics;
      }
    }

    return {
      evalId,
      totalCells: cells.length,
      completedCells: completed.length,
      failedCells: failed.length,
      modelSummaries,
      promptSummaries,
      pairwiseRankings: pairwiseRankings && pairwiseRankings.length > 0 ? pairwiseRankings : undefined,
      completedAt: new Date().toISOString(),
      testCaseSummaries: testCaseSummaries.length > 0 ? testCaseSummaries : undefined,
      assertionSummary: assertionSummary.length > 0 ? assertionSummary : undefined,
      consistency,
      perspectiveIds: perspectiveIds.length > 0 ? perspectiveIds : undefined,
      truncationRate,
      resolvedInference: options?.resolvedInference,
      transportProvenance: options?.transportProvenance,
      benchmarkProvenance: options?.benchmarkProvenance,
      taskMetrics,
      perModelTaskMetrics,
    };
  },

  computeConsistency(cells: EvalMatrixCell[]): Record<string, number> {
    const byModel = new Map<string, number[]>();
    for (const cell of cells) {
      if (cell.compositeScore == null) continue;
      const list = byModel.get(cell.modelId) ?? [];
      list.push(cell.compositeScore);
      byModel.set(cell.modelId, list);
    }
    const result: Record<string, number> = {};
    for (const [modelId, scores] of byModel) {
      if (scores.length < 2) { result[modelId] = 0; continue; }
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
      result[modelId] = Math.sqrt(variance);
    }
    return result;
  },

  computeRegression(
    current: EvaluationSummary,
    baseline: EvaluationSummary,
    totalCases?: number
  ): RegressionResult {
    const metrics: MetricRegression[] = [];

    function addMetric(
      name: string,
      currentVal: number,
      baselineVal: number,
      threshold: number
    ) {
      const delta = currentVal - baselineVal;
      const pct = baselineVal !== 0 ? Math.abs(delta) / Math.abs(baselineVal) : 0;
      let status: 'improved' | 'regressed' | 'unchanged' = 'unchanged';
      if (pct >= threshold) {
        status = delta > 0 ? 'improved' : 'regressed';
      }
      // A7: state regression-slice gates in cases, not raw points — a 16-case
      // slice moves in 6.25pp steps, so a bare threshold in points can silently
      // reduce to "any single case flipped".
      const onCaseMovementPct = totalCases && totalCases > 0 ? 100 / totalCases : undefined;
      metrics.push({ metric: name, baseline: baselineVal, current: currentVal, delta, status, onCaseMovementPct });
    }

    const currentAvgScore = current.modelSummaries
      .filter(m => m.avgCompositeScore != null)
      .reduce((s, m) => s + (m.avgCompositeScore ?? 0), 0) / (current.modelSummaries.length || 1);

    const baselineAvgScore = baseline.modelSummaries
      .filter(m => m.avgCompositeScore != null)
      .reduce((s, m) => s + (m.avgCompositeScore ?? 0), 0) / (baseline.modelSummaries.length || 1);

    if (currentAvgScore > 0 || baselineAvgScore > 0) {
      addMetric('compositeScore', currentAvgScore, baselineAvgScore, SCORE_REGRESSION_THRESHOLD);
    }

    const currentAvgLatency = current.modelSummaries
      .reduce((s, m) => s + m.avgDurationMs, 0) / (current.modelSummaries.length || 1);
    const baselineAvgLatency = baseline.modelSummaries
      .reduce((s, m) => s + m.avgDurationMs, 0) / (baseline.modelSummaries.length || 1);

    if (currentAvgLatency > 0 || baselineAvgLatency > 0) {
      const latencyDelta = currentAvgLatency - baselineAvgLatency;
      const pct = baselineAvgLatency !== 0 ? Math.abs(latencyDelta) / baselineAvgLatency : 0;
      let status: 'improved' | 'regressed' | 'unchanged' = 'unchanged';
      if (pct >= LATENCY_REGRESSION_THRESHOLD) {
        status = latencyDelta < 0 ? 'improved' : 'regressed';
      }
      metrics.push({
        metric: 'avgLatencyMs',
        baseline: baselineAvgLatency,
        current: currentAvgLatency,
        delta: latencyDelta,
        status,
      });
    }

    return {
      metrics,
      hasRegressions: metrics.some(m => m.status === 'regressed'),
      hasImprovements: metrics.some(m => m.status === 'improved'),
    };
  },
};
