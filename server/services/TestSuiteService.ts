import { join } from 'path';
import { FileService } from './FileService.ts';
import type { TestSuite, TestCase } from '../../src/types/eval.ts';

export class TestSuiteService {
  private static suitesDir(): string {
    return join(FileService.evalsDir(), 'test-suites');
  }

  static list(): TestSuite[] {
    FileService.ensureDir(TestSuiteService.suitesDir());
    return FileService.listJsonFiles(TestSuiteService.suitesDir())
      .map(f => FileService.readJson<TestSuite>(f))
      .filter((s): s is TestSuite => s !== null);
  }

  static get(id: string): TestSuite | null {
    FileService.ensureDir(TestSuiteService.suitesDir());
    const suites = TestSuiteService.list();
    return suites.find(s => s.id === id || s.slug === id) ?? null;
  }

  static create(data: { name: string; description?: string; testCases: TestCase[] }): TestSuite {
    FileService.ensureDir(TestSuiteService.suitesDir());
    const now = new Date().toISOString();
    const slug = FileService.generateSlug(data.name);
    const suite: TestSuite = {
      id: FileService.generateId(),
      slug,
      name: data.name,
      description: data.description,
      testCases: data.testCases.map(tc => ({
        ...tc,
        id: tc.id || FileService.generateId()
      })),
      createdAt: now,
      updatedAt: now
    };
    FileService.writeJson(join(TestSuiteService.suitesDir(), `${suite.id}.json`), suite);
    return suite;
  }

  static update(id: string, data: Partial<Pick<TestSuite, 'name' | 'description' | 'testCases'>>): TestSuite {
    const existing = TestSuiteService.get(id);
    if (!existing) throw new Error(`Test suite not found: ${id}`);

    const updated: TestSuite = {
      ...existing,
      ...data,
      testCases: data.testCases
        ? data.testCases.map(tc => ({ ...tc, id: tc.id || FileService.generateId() }))
        : existing.testCases,
      updatedAt: new Date().toISOString()
    };

    FileService.writeJson(join(TestSuiteService.suitesDir(), `${existing.id}.json`), updated);
    return updated;
  }

  static delete(id: string): void {
    const suite = TestSuiteService.get(id);
    if (!suite) throw new Error(`Test suite not found: ${id}`);
    FileService.deleteFile(join(TestSuiteService.suitesDir(), `${suite.id}.json`));
  }
}
