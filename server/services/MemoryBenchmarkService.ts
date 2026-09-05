import { createHash } from 'crypto';
import type { TestCase, TestSuite } from '../../src/types/eval';

export const MEMORY_BENCHMARK_IDS = {
  classification: 'memory-classification-v1',
  tagging: 'memory-tagging-v1',
  summarization: 'memory-summarization-v1',
} as const;

export const MEMORY_CATEGORIES = ['Preference', 'Reminder', 'Snippet', 'Event', 'Note', 'Prompt', 'Idea', 'History'] as const;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeSuiteHash(suite: Pick<TestSuite, 'id' | 'version' | 'purposeCategory' | 'testCases'>): string {
  return sha256(canonicalJson({
    id: suite.id,
    version: suite.version,
    purposeCategory: suite.purposeCategory,
    testCases: suite.testCases,
  }));
}

export function splitOf(testCase: TestCase): 'calibration' | 'regression' | null {
  const splitTags = (testCase.caseTags ?? []).filter(tag => tag.startsWith('split:'));
  if (splitTags.length !== 1) return null;
  if (splitTags[0] === 'split:calibration') return 'calibration';
  if (splitTags[0] === 'split:regression') return 'regression';
  return null;
}

export function unwrapMemory(userMessage: string): string | null {
  const match = /^<memory>\n([\s\S]*)\n<\/memory>$/.exec(userMessage);
  return match?.[1] ?? null;
}

export function validateBuiltInSuite(suite: TestSuite, tagVocabulary?: readonly string[]): string[] {
  const errors: string[] = [];
  if (!suite.builtIn) errors.push(`${suite.id}: builtIn must be true`);
  if (!suite.version) errors.push(`${suite.id}: version is required`);
  if (!suite.provenance) errors.push(`${suite.id}: provenance is required`);
  if (suite.provenance && computeSuiteHash(suite) !== suite.provenance.datasetSha256) errors.push(`${suite.id}: datasetSha256 mismatch`);

  const ids = new Set<string>();
  const normalizedInputs = new Set<string>();
  for (const testCase of suite.testCases) {
    if (ids.has(testCase.id)) errors.push(`${suite.id}: duplicate case id ${testCase.id}`);
    ids.add(testCase.id);
    const content = unwrapMemory(testCase.userMessage);
    if (content == null) errors.push(`${testCase.id}: malformed <memory> wrapper`);
    if (content && /<\/memory\s*>/i.test(content)) errors.push(`${testCase.id}: unescaped closing memory delimiter`);
    const normalized = (content ?? testCase.userMessage).replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalizedInputs.has(normalized)) errors.push(`${suite.id}: duplicate normalized input at ${testCase.id}`);
    normalizedInputs.add(normalized);
    if (!splitOf(testCase)) errors.push(`${testCase.id}: exactly one canonical split tag is required`);
    for (const tag of testCase.caseTags ?? []) {
      if (!/^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/.test(tag)) errors.push(`${testCase.id}: malformed case tag ${tag}`);
    }
  }

  const calibration = suite.testCases.filter(tc => splitOf(tc) === 'calibration').length;
  const regression = suite.testCases.filter(tc => splitOf(tc) === 'regression').length;
  if (suite.id === MEMORY_BENCHMARK_IDS.classification) {
    if (suite.testCases.length !== 64 || calibration !== 48 || regression !== 16) errors.push(`${suite.id}: expected 64 cases split 48/16`);
    for (const category of MEMORY_CATEGORIES) {
      const count = suite.testCases.filter(tc => tc.expectedOutput === category).length;
      if (count !== 8) errors.push(`${suite.id}: ${category} must have exactly 8 cases`);
    }
  }
  if (suite.id === MEMORY_BENCHMARK_IDS.tagging) {
    if (suite.testCases.length !== 72 || calibration !== 54 || regression !== 18) errors.push(`${suite.id}: expected 72 cases split 54/18`);
    if (tagVocabulary) {
      for (const tag of tagVocabulary) {
        const positives = suite.testCases.filter(tc => tc.expectedLabels?.includes(tag));
        if (positives.length < 2) errors.push(`${suite.id}: ${tag} needs at least 2 positives`);
        if (!positives.some(tc => splitOf(tc) === 'calibration')) errors.push(`${suite.id}: ${tag} needs a calibration positive`);
      }
      for (const testCase of suite.testCases) {
        for (const tag of testCase.expectedLabels ?? []) if (!tagVocabulary.includes(tag)) errors.push(`${testCase.id}: unknown tag ${tag}`);
      }
    }
  }
  if (suite.id === MEMORY_BENCHMARK_IDS.summarization) {
    if (suite.testCases.length !== 36 || calibration !== 27 || regression !== 9) errors.push(`${suite.id}: expected 36 cases split 27/9`);
    for (const band of ['short', 'medium', 'long']) {
      const cases = suite.testCases.filter(tc => tc.caseTags?.includes(`length:${band}`));
      if (cases.length !== 12 || cases.filter(tc => splitOf(tc) === 'regression').length !== 3) errors.push(`${suite.id}: ${band} must have 12 cases with 3 regression`);
    }
    for (const testCase of suite.testCases) {
      if (!testCase.referenceAnswer?.trim() || !testCase.requiredFacts?.length) errors.push(`${testCase.id}: summary reference and requiredFacts are required`);
    }
  }
  return errors;
}
