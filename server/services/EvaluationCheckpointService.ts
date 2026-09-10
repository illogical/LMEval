import { join } from 'node:path';
import { EVALUATIONS_DIR, ensureDir, listDir, readJsonSafe, writeJsonAtomic } from './FileService';
import type { CellResultCheckpoint, EvalMatrixCell, EvaluationWorkPlan } from '../../src/types/eval';

const SUPPORTED_CHECKPOINT_SCHEMA_VERSIONS = [1];

export interface CheckpointScan {
  checkpoints: CellResultCheckpoint[];
  committedIds: Set<string>;
  remaining: number;
  terminalFailed: number;
  errors: Array<{ code: 'CHECKPOINT_CORRUPT' | 'CHECKPOINT_SCHEMA_UNSUPPORTED'; file: string; message: string }>;
}

export const EvaluationCheckpointService = {
  commit(evalId: string, plan: EvaluationWorkPlan, itemId: string, cell: EvalMatrixCell, attemptId: string): CellResultCheckpoint {
    const item = plan.items.find(candidate => candidate.cellId === itemId);
    if (!item) throw Object.assign(new Error(`Unknown work item ${itemId}`), { code: 'CHECKPOINT_CORRUPT' });
    const checkpoint: CellResultCheckpoint = {
      schemaVersion: 1,
      evalId,
      planSha256: plan.planSha256,
      cellId: item.cellId,
      cellKey: item.cellKey,
      attemptId,
      committedAt: new Date().toISOString(),
      cell: { ...cell, id: item.cellId, cellKey: item.cellKey, attemptId },
    };
    const dir = join(EVALUATIONS_DIR, evalId, 'cell-results');
    ensureDir(dir);
    writeJsonAtomic(join(dir, `${item.cellId}.json`), checkpoint);
    return checkpoint;
  },

  scan(evalId: string, plan: EvaluationWorkPlan): CheckpointScan {
    const dir = join(EVALUATIONS_DIR, evalId, 'cell-results');
    const byId = new Map(plan.items.map(item => [item.cellId, item]));
    const checkpoints: CellResultCheckpoint[] = [];
    const errors: CheckpointScan['errors'] = [];
    const keys = new Set<string>();
    for (const file of listDir(dir).filter(name => name.endsWith('.json'))) {
      const result = readJsonSafe<CellResultCheckpoint>(join(dir, file));
      if (result.state !== 'valid') {
        errors.push({ code: 'CHECKPOINT_CORRUPT', file, message: result.state === 'corrupt' ? result.error : 'Missing checkpoint' });
        continue;
      }
      const checkpoint = result.value;
      if (!SUPPORTED_CHECKPOINT_SCHEMA_VERSIONS.includes(checkpoint.schemaVersion)) {
        errors.push({ code: 'CHECKPOINT_SCHEMA_UNSUPPORTED', file, message: `Checkpoint schema version ${checkpoint.schemaVersion} is not supported by this reader` });
        continue;
      }
      const item = byId.get(checkpoint.cellId);
      const invalid = checkpoint.evalId !== evalId
        || checkpoint.planSha256 !== plan.planSha256 || !item
        || checkpoint.cellKey !== item.cellKey || file !== `${checkpoint.cellId}.json`
        || keys.has(checkpoint.cellKey);
      if (invalid) {
        errors.push({ code: 'CHECKPOINT_CORRUPT', file, message: 'Checkpoint identity or plan hash is invalid' });
        continue;
      }
      keys.add(checkpoint.cellKey);
      checkpoints.push(checkpoint);
    }
    const committedIds = new Set(checkpoints.map(checkpoint => checkpoint.cellId));
    return {
      checkpoints,
      committedIds,
      remaining: Math.max(0, plan.items.length - committedIds.size),
      terminalFailed: checkpoints.filter(checkpoint => checkpoint.cell.status === 'failed').length,
      errors,
    };
  },

  orderedCells(plan: EvaluationWorkPlan, scan: CheckpointScan): EvalMatrixCell[] {
    const byId = new Map(scan.checkpoints.map(checkpoint => [checkpoint.cellId, checkpoint.cell]));
    return plan.items.map(item => byId.get(item.cellId)).filter((cell): cell is EvalMatrixCell => !!cell);
  },
};
