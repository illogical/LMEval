import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TestSuite } from '../../../src/types/eval';
import {
  MEMORY_BENCHMARK_IDS,
  MEMORY_CATEGORIES,
  computeSuiteHash,
  splitOf,
  unwrapMemory,
  validateBuiltInSuite,
} from '../MemoryBenchmarkService';

function load(id: string): TestSuite {
  return JSON.parse(readFileSync(join(process.cwd(), 'data', 'evals', 'test-suites', 'built-in', `${id}.json`), 'utf8'));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe('checked-in MemoryApi benchmark suites', () => {
  it('validates exact counts, splits, classification balance, and pending review provenance', () => {
    const classification = load(MEMORY_BENCHMARK_IDS.classification);
    expect(validateBuiltInSuite(classification)).toEqual([]);
    expect(classification.testCases).toHaveLength(64);
    expect(classification.testCases.filter(tc => splitOf(tc) === 'calibration')).toHaveLength(48);
    for (const category of MEMORY_CATEGORIES) {
      expect(classification.testCases.filter(tc => tc.expectedOutput === category)).toHaveLength(8);
    }
    expect(classification.provenance?.reviewStatus).toBe('pending-human-review');
  });

  it('covers every canonical tag at least twice with a calibration positive', () => {
    const suite = load(MEMORY_BENCHMARK_IDS.tagging);
    const purpose = JSON.parse(readFileSync(join(process.cwd(), 'data', 'evals', 'purpose-templates', 'tagging.json'), 'utf8'));
    const tags: string[] = purpose.assertionStrategy.config.vocabulary;
    expect(validateBuiltInSuite(suite, tags)).toEqual([]);
    expect(tags).toHaveLength(61);
    for (const tag of tags) {
      const positives = suite.testCases.filter(tc => tc.expectedLabels?.includes(tag));
      expect(positives.length).toBeGreaterThanOrEqual(2);
      expect(positives.some(tc => splitOf(tc) === 'calibration')).toBe(true);
    }
  });

  it('has grounded summaries in three balanced length bands', () => {
    const suite = load(MEMORY_BENCHMARK_IDS.summarization);
    expect(validateBuiltInSuite(suite)).toEqual([]);
    for (const band of ['short', 'medium', 'long']) {
      const cases = suite.testCases.filter(tc => tc.caseTags?.includes(`length:${band}`));
      expect(cases).toHaveLength(12);
      expect(cases.filter(tc => splitOf(tc) === 'regression')).toHaveLength(3);
      expect(cases.every(tc => tc.referenceAnswer && tc.requiredFacts?.length)).toBe(true);
    }
  });

  it('uses exact wrapper escaping and rejects malformed, duplicate, and hash-tampered data', () => {
    const suite = clone(load(MEMORY_BENCHMARK_IDS.classification));
    expect(suite.testCases.every(tc => unwrapMemory(tc.userMessage) !== null)).toBe(true);

    suite.testCases[0].userMessage = '<memory>bad</memory>';
    suite.testCases[1].id = suite.testCases[0].id;
    suite.provenance!.datasetSha256 = computeSuiteHash(load(MEMORY_BENCHMARK_IDS.classification));
    const errors = validateBuiltInSuite(suite);
    expect(errors.some(error => error.includes('datasetSha256 mismatch'))).toBe(true);
    expect(errors.some(error => error.includes('malformed <memory> wrapper'))).toBe(true);
    expect(errors.some(error => error.includes('duplicate case id'))).toBe(true);
  });
});
