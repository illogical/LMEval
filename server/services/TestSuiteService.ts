import { join } from 'path';
import {
  readJson,
  writeJson,
  deleteFile,
  listDir,
  generateId,
  slugify,
  ensureDir,
  TEST_SUITES_DIR,
} from './FileService';
import type { TestSuite, TestCase } from '../../src/types/eval';

export const TestSuiteService = {
  list(): TestSuite[] {
    ensureDir(TEST_SUITES_DIR);
    const suites: TestSuite[] = [];
    for (const file of listDir(TEST_SUITES_DIR)) {
      if (!file.endsWith('.json')) continue;
      const s = readJson<TestSuite>(join(TEST_SUITES_DIR, file));
      if (s) suites.push(s);
    }
    return suites.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  get(id: string): TestSuite | null {
    for (const file of listDir(TEST_SUITES_DIR)) {
      if (!file.endsWith('.json')) continue;
      const s = readJson<TestSuite>(join(TEST_SUITES_DIR, file));
      if (s?.id === id) return s;
    }
    return null;
  },

  create(data: { name: string; description?: string; testCases?: Omit<TestCase, 'id'>[] }): TestSuite {
    ensureDir(TEST_SUITES_DIR);
    const now = new Date().toISOString();
    const slug = slugify(data.name);

    const suite: TestSuite = {
      id: generateId('ts'),
      slug,
      name: data.name,
      description: data.description,
      testCases: (data.testCases ?? []).map(tc => ({ ...tc, id: generateId('tc') })),
      createdAt: now,
      updatedAt: now,
    };

    writeJson(join(TEST_SUITES_DIR, `${slug}.json`), suite);
    return suite;
  },

  update(id: string, data: Partial<Omit<TestSuite, 'id' | 'slug' | 'createdAt'>>): TestSuite | null {
    const existing = this.get(id);
    if (!existing) return null;

    const updated: TestSuite = {
      ...existing,
      ...data,
      id,
      testCases: (data.testCases ?? existing.testCases).map(tc => ({
        ...tc,
        id: tc.id ?? generateId('tc'),
      })),
      updatedAt: new Date().toISOString(),
    };

    writeJson(join(TEST_SUITES_DIR, `${existing.slug}.json`), updated);
    return updated;
  },

  delete(id: string): boolean {
    const suite = this.get(id);
    if (!suite) return false;
    return deleteFile(join(TEST_SUITES_DIR, `${suite.slug}.json`));
  },
};
