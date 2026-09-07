import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePaths, writeJson } from '../FileService';
import { JudgeQualificationService } from '../JudgeQualificationService';
import { LmapiClient } from '../LmapiClient';

let root: string;
const calibration = (suffix = '') => ({
  id: 'test-calibration',
  cases: Array.from({ length: 20 }, (_, index) => ({
    id: `case-${index}`, sourceText: `Source ${index}${suffix}`, candidateSummary: `Summary ${index}`,
    humanScores: { faithfulness: 3, salientCoverage: 3, retrievalUtility: 3, concision: 3, overall: (index % 5) + 1 },
  })),
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lmeval-qualification-'));
  configurePaths({ dataRoot: join(root, 'runtime'), repoRoot: join(root, 'repo') });
  writeJson(join(root, 'repo', 'data', 'evals', 'calibration', 'summarization-v0.json'), calibration());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(root, { recursive: true, force: true });
});

describe('JudgeQualificationService', () => {
  it('persists progress, preserves threshold failure as a completed result, and detects content changes', async () => {
    vi.spyOn(LmapiClient, 'chatCompletion').mockResolvedValue({ choices: [{ message: { role: 'assistant', content: '{"faithfulness":3,"salientCoverage":3,"retrievalUtility":3,"concision":3,"overall":3}' } }] } as never);
    let completed = 0;
    const result = await JudgeQualificationService.qualify('local::judge', 'summarization-v0', { cancelled: () => false, progress: () => completed++ });
    expect(completed).toBe(60);
    expect(result.qualified).toBe(false);
    expect(JudgeQualificationService.status('local::judge')).toMatchObject({ state: 'unqualified', current: true });

    writeJson(join(root, 'repo', 'data', 'evals', 'calibration', 'summarization-v0.json'), calibration(' edited'));
    expect(JudgeQualificationService.status('local::judge')).toMatchObject({ state: 'stale', current: false });
  });

  it('rejects a duplicate active run, accepts cancellation, and marks unfinished work interrupted', () => {
    vi.useFakeTimers();
    const run = JudgeQualificationService.startRun('local::judge');
    let duplicate: unknown;
    try { JudgeQualificationService.startRun('local::judge'); } catch (error) { duplicate = error; }
    expect(duplicate).toMatchObject({ status: 409, runId: run.id });
    expect(JudgeQualificationService.cancelRun(run.id).cancelRequestedAt).toBeTruthy();
    JudgeQualificationService.interruptRuns();
    expect(JudgeQualificationService.getRun(run.id)).toMatchObject({ status: 'interrupted' });
    vi.clearAllTimers();
  });
});
