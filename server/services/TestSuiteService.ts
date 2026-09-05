import { join } from 'path';
import {
  readJson, writeJson, deleteFile, listDir, generateId, slugify, ensureDir,
  TEST_SUITES_DIR, CUSTOM_TEST_SUITES_DIR, BUILT_IN_TEST_SUITES_DIR,
} from './FileService';
import type { TestSuite, TestCase } from '../../src/types/eval';
import { validateBuiltInSuite } from './MemoryBenchmarkService';

export class BuiltInSuiteImmutableError extends Error {
  readonly code = 'BUILT_IN_SUITE_IMMUTABLE';
  constructor(id: string) {
    super(`Built-in test suite cannot be modified: ${id}`);
  }
}

type SuiteLocation = { suite: TestSuite; path: string; owner: 'built-in' | 'custom' | 'legacy' };

function normalizeLegacySuite(raw: TestSuite): TestSuite {
  return { ...raw, builtIn: raw.builtIn === true, version: raw.version || 'legacy' };
}

function readDirectory(dir: string, owner: SuiteLocation['owner']): SuiteLocation[] {
  if (owner !== 'built-in') ensureDir(dir);
  const entries: SuiteLocation[] = [];
  for (const file of listDir(dir)) {
    if (!file.endsWith('.json')) continue;
    const raw = readJson<TestSuite>(join(dir, file));
    if (raw) entries.push({ suite: normalizeLegacySuite(raw), path: join(dir, file), owner });
  }
  return entries;
}

function locations(): SuiteLocation[] {
  const entries = [
    ...readDirectory(BUILT_IN_TEST_SUITES_DIR, 'built-in'),
    ...readDirectory(CUSTOM_TEST_SUITES_DIR, 'custom'),
    ...readDirectory(TEST_SUITES_DIR, 'legacy'),
  ];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.suite.id)) throw new Error(`Duplicate test suite id across storage sources: ${entry.suite.id}`);
    seen.add(entry.suite.id);
  }
  return entries;
}

function findLocation(id: string): SuiteLocation | null {
  return locations().find(entry => entry.suite.id === id) ?? null;
}

export const TestSuiteService = {
  list(): TestSuite[] {
    return locations().map(entry => entry.suite).sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  },

  get(id: string): TestSuite | null {
    return findLocation(id)?.suite ?? null;
  },

  create(data: { name: string; description?: string; testCases?: Omit<TestCase, 'id'>[] }): TestSuite {
    ensureDir(CUSTOM_TEST_SUITES_DIR);
    const now = new Date().toISOString();
    const slug = slugify(data.name);
    const suite: TestSuite = {
      id: generateId('ts'), slug, name: data.name, description: data.description,
      testCases: (data.testCases ?? []).map(tc => ({ ...tc, id: generateId('tc'), tags: undefined })),
      builtIn: false, purposeCategory: 'custom', version: '1', createdAt: now, updatedAt: now,
    };
    writeJson(join(CUSTOM_TEST_SUITES_DIR, `${slug}.json`), suite);
    return suite;
  },

  update(id: string, data: Partial<Omit<TestSuite, 'id' | 'slug' | 'createdAt' | 'builtIn' | 'provenance'>>): TestSuite | null {
    const location = findLocation(id);
    if (!location) return null;
    if (location.owner === 'built-in' || location.suite.builtIn) throw new BuiltInSuiteImmutableError(id);
    const updated: TestSuite = {
      ...location.suite,
      name: data.name ?? location.suite.name,
      description: data.description ?? location.suite.description,
      testCases: (data.testCases ?? location.suite.testCases).map(tc => ({ ...tc, id: tc.id ?? generateId('tc'), tags: undefined })),
      purposeCategory: data.purposeCategory ?? location.suite.purposeCategory,
      version: data.version ?? location.suite.version,
      builtIn: false,
      provenance: undefined,
      updatedAt: new Date().toISOString(),
    };
    writeJson(location.path, updated);
    return updated;
  },

  delete(id: string): boolean {
    const location = findLocation(id);
    if (!location) return false;
    if (location.owner === 'built-in' || location.suite.builtIn) throw new BuiltInSuiteImmutableError(id);
    return deleteFile(location.path);
  },

  seedBuiltIns(): void {
    const builtIns = readDirectory(BUILT_IN_TEST_SUITES_DIR, 'built-in');
    if (builtIns.length !== 3) throw new Error(`Expected 3 built-in benchmark suites, found ${builtIns.length}`);
    for (const { suite } of builtIns) {
      if (!suite.builtIn || !suite.version || !suite.provenance) throw new Error(`Built-in test suite ${suite.id} has incomplete provenance`);
      const errors = validateBuiltInSuite(suite);
      if (errors.length) throw new Error(errors.join('\n'));
    }
    locations();
  },
};
