import type { TestCase } from '../../src/types/eval';

const PREAMBLE_PATTERNS = [
  /^here('?s| is)\b/i,
  /^this (is|summary)\b/i,
  /^summary:/i,
  /^sure[,!]/i,
  /^certainly[,!]/i,
];

export interface SummaryDeterministicResult {
  pass: boolean;
  noPreamble: boolean;
  noHeading: boolean;
  noFence: boolean;
  compressionInRange: boolean;
  protectedTokensPreserved: boolean;
  noForbiddenClaims: boolean;
  failures: string[];
}

/**
 * R6 deterministic guards. Shared by PromptfooAdapter (per-cell pass/fail
 * assertion during the run) and SummaryService (aggregate rates for
 * taskMetrics) so the two never drift on what "passes" means.
 */
export function checkSummaryDeterministics(
  output: string,
  testCase: Pick<TestCase, 'userMessage' | 'protectedTokens' | 'forbiddenClaims'>,
  compressionRange: [number, number]
): SummaryDeterministicResult {
  const trimmed = output.trim();
  const inputLength = testCase.userMessage.length || 1;
  const [minRatio, maxRatio] = compressionRange;
  const protectedTokens = testCase.protectedTokens ?? [];
  const forbiddenClaims = testCase.forbiddenClaims ?? [];
  const failures: string[] = [];

  const noPreamble = !PREAMBLE_PATTERNS.some(re => re.test(trimmed));
  if (!noPreamble) failures.push('has a preamble');

  const noHeading = !/^#{1,6}\s/.test(trimmed);
  if (!noHeading) failures.push('starts with a markdown heading');

  const noFence = !trimmed.includes('```');
  if (!noFence) failures.push('contains a code fence');

  const ratio = trimmed.length / inputLength;
  const compressionInRange = ratio >= minRatio && ratio <= maxRatio;
  if (!compressionInRange) failures.push(`compression ratio ${ratio.toFixed(2)} outside [${minRatio}, ${maxRatio}]`);

  const missingTokens = protectedTokens.filter(t => !trimmed.includes(t));
  const protectedTokensPreserved = missingTokens.length === 0;
  if (!protectedTokensPreserved) failures.push(`missing protected token(s): ${missingTokens.join(', ')}`);

  const presentForbidden = forbiddenClaims.filter(c => trimmed.toLowerCase().includes(c.toLowerCase()));
  const noForbiddenClaims = presentForbidden.length === 0;
  if (!noForbiddenClaims) failures.push(`contains forbidden claim(s): ${presentForbidden.join(', ')}`);

  return {
    pass: failures.length === 0,
    noPreamble,
    noHeading,
    noFence,
    compressionInRange,
    protectedTokensPreserved,
    noForbiddenClaims,
    failures,
  };
}

export const DEFAULT_COMPRESSION_RANGE: [number, number] = [0.05, 0.6];
