import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configurePaths } from '../FileService';
import { BuiltInSuiteImmutableError, TestSuiteService } from '../TestSuiteService';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-suites-'));
  configurePaths({ dataRoot, repoRoot: process.cwd() });
});

afterEach(() => {
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('TestSuiteService ownership', () => {
  it('merges repository built-ins, data-root custom suites, and legacy files deterministically', () => {
    const custom = TestSuiteService.create({ name: 'Custom suite', testCases: [{ userMessage: 'custom' }] });
    const legacyDir = join(dataRoot, 'evals', 'test-suites');
    writeFileSync(join(legacyDir, 'legacy.json'), JSON.stringify({
      id: 'legacy-suite', slug: 'legacy', name: 'Legacy', testCases: [], createdAt: '2020-01-01', updatedAt: '2020-01-01',
    }));

    const suites = TestSuiteService.list();
    expect(suites.slice(0, 3).map(suite => suite.id)).toEqual([
      'memory-classification-v1', 'memory-summarization-v1', 'memory-tagging-v1',
    ]);
    expect(suites.find(suite => suite.id === custom.id)).toMatchObject({ builtIn: false, version: '1' });
    expect(suites.find(suite => suite.id === 'legacy-suite')).toMatchObject({ builtIn: false, version: 'legacy' });
  });

  it('rejects writes and deletes for repository built-ins', () => {
    expect(() => TestSuiteService.update('memory-classification-v1', { name: 'Changed' })).toThrow(BuiltInSuiteImmutableError);
    expect(() => TestSuiteService.delete('memory-classification-v1')).toThrow(BuiltInSuiteImmutableError);
  });

  it('allowlists custom creation fields and never persists the tags alias', () => {
    const suite = TestSuiteService.create({
      name: 'Allowed',
      testCases: [{ userMessage: 'x', tags: ['legacy'], expectedLabels: ['canonical'] }],
    });
    expect(suite).toMatchObject({ builtIn: false, purposeCategory: 'custom', version: '1' });
    expect(suite.testCases[0]).not.toHaveProperty('tags', expect.any(Array));
    expect(suite.testCases[0].expectedLabels).toEqual(['canonical']);
  });

  it('fails startup validation on an ID collision across ownership roots', () => {
    const legacyDir = join(dataRoot, 'evals', 'test-suites');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'collision.json'), JSON.stringify({
      id: 'memory-tagging-v1', slug: 'collision', name: 'Collision', testCases: [], createdAt: '2020-01-01', updatedAt: '2020-01-01',
    }));
    expect(() => TestSuiteService.seedBuiltIns()).toThrow('Duplicate test suite id');
  });
});
