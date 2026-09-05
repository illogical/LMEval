import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { configurePaths } from '../FileService';
import { LatencyBudgetService } from '../LatencyBudgetService';

describe('LatencyBudgetService', () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-latency-budget-'));
    configurePaths({ dataRoot, repoRoot: process.cwd() });
  });

  afterEach(() => {
    configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('returns null when no budgets have been set', () => {
    expect(LatencyBudgetService.get()).toBeNull();
  });

  it('round-trips a set budgets record', () => {
    const budgets = { classification: 500, tagging: 500, summarization: 2000 };
    LatencyBudgetService.set(budgets);
    expect(LatencyBudgetService.get()).toEqual(budgets);
  });
});
