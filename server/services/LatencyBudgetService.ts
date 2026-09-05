import { readJson, writeJson, LATENCY_BUDGETS_PATH } from './FileService';
import type { PurposeCategory } from '../../src/types/eval';

export type LatencyTask = Exclude<PurposeCategory, 'custom'>;

/**
 * Each task's share (ms) of MemoryApi's whole-ingestion target. LMEval cannot
 * measure the whole-ingestion target itself (TASK.md §6: it doesn't see
 * MemoryApi's pipeline), so this is an externally-supplied constant, set once
 * and reused across campaigns rather than re-entered per run.
 */
export type LatencyBudgets = Record<LatencyTask, number>;

export const LatencyBudgetService = {
  get(): LatencyBudgets | null {
    return readJson<LatencyBudgets>(LATENCY_BUDGETS_PATH);
  },

  set(budgets: LatencyBudgets): LatencyBudgets {
    writeJson(LATENCY_BUDGETS_PATH, budgets);
    return budgets;
  },
};
