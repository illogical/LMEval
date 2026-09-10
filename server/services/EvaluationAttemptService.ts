import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EVALUATIONS_DIR, generateId, listDir, readJson, writeJsonAtomic } from './FileService';
import { EvaluationCheckpointService } from './EvaluationCheckpointService';
import type {
  EvaluationAttempt, EvaluationAttemptStatus, EvaluationConfig,
  EvaluationRecovery, EvaluationRunState, EvaluationWorkPlan,
} from '../../src/types/eval';

const LEASE_MS = 30_000;
let instanceId = randomUUID();
const acquiring = new Set<string>();

function attemptPath(evalId: string, attemptId: string): string {
  return join(EVALUATIONS_DIR, evalId, 'attempts', `${attemptId}.json`);
}

function statePath(evalId: string): string {
  return join(EVALUATIONS_DIR, evalId, 'run-state.json');
}

export class AttemptConflictError extends Error {
  code = 'EVALUATION_ALREADY_RUNNING' as const;
}

export const EvaluationAttemptService = {
  initialize(): string {
    instanceId = randomUUID();
    return instanceId;
  },

  instanceId(): string { return instanceId; },

  loadState(evalId: string): EvaluationRunState | null {
    return readJson<EvaluationRunState>(statePath(evalId));
  },

  loadAttempt(evalId: string, attemptId?: string): EvaluationAttempt | null {
    return attemptId ? readJson<EvaluationAttempt>(attemptPath(evalId, attemptId)) : null;
  },

  list(evalId: string): EvaluationAttempt[] {
    return listDir(join(EVALUATIONS_DIR, evalId, 'attempts'))
      .filter(file => file.endsWith('.json'))
      .map(file => readJson<EvaluationAttempt>(join(EVALUATIONS_DIR, evalId, 'attempts', file)))
      .filter((attempt): attempt is EvaluationAttempt => !!attempt)
      .sort((left, right) => left.ordinal - right.ordinal);
  },

  acquire(evalId: string, plan: EvaluationWorkPlan, resumedFromAttemptId?: string): EvaluationAttempt {
    if (acquiring.has(evalId)) throw new AttemptConflictError('Evaluation acquisition already in progress');
    acquiring.add(evalId);
    try {
      const currentState = this.loadState(evalId);
      const currentAttempt = this.loadAttempt(evalId, currentState?.currentAttemptId);
      if (currentAttempt?.status === 'running' && Date.parse(currentAttempt.leaseExpiresAt) > Date.now()) {
        throw new AttemptConflictError('Evaluation already has a live owner');
      }
      const scan = EvaluationCheckpointService.scan(evalId, plan);
      if (scan.errors.length) throw Object.assign(new Error('Checkpoint integrity validation failed'), { code: 'CHECKPOINT_CORRUPT', details: scan.errors });
      const now = new Date();
      const attemptId = generateId('attempt');
      const ordinal = currentState?.nextAttemptOrdinal ?? 1;
      const attempt: EvaluationAttempt = {
        schemaVersion: 1,
        attemptId,
        evalId,
        ordinal,
        resumedFromAttemptId,
        status: 'running',
        owner: { instanceId, pid: process.pid, token: randomUUID() },
        startedAt: now.toISOString(),
        heartbeatAt: now.toISOString(),
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
        updatedAt: now.toISOString(),
        counts: {
          planned: plan.items.length,
          reused: scan.committedIds.size,
          committedByAttempt: 0,
          terminalFailed: scan.terminalFailed,
          remaining: scan.remaining,
        },
      };
      const recovery: EvaluationRecovery = {
        state: scan.remaining ? 'eligible' : 'finalization-only',
        reusedCells: scan.committedIds.size,
        remainingCells: scan.remaining,
        lastAttemptId: attemptId,
        requiresModelCalls: scan.remaining > 0,
      };
      const state: EvaluationRunState = {
        schemaVersion: 1,
        evalId,
        planSha256: plan.planSha256,
        currentAttemptId: attemptId,
        lastAttemptId: attemptId,
        nextAttemptOrdinal: ordinal + 1,
        recovery,
        updatedAt: now.toISOString(),
      };
      writeJsonAtomic(attemptPath(evalId, attemptId), attempt);
      writeJsonAtomic(statePath(evalId), state);
      return attempt;
    } finally {
      acquiring.delete(evalId);
    }
  },

  heartbeat(evalId: string, attemptId: string, plan: EvaluationWorkPlan): EvaluationAttempt {
    const attempt = this.loadAttempt(evalId, attemptId);
    if (!attempt || attempt.status !== 'running' || attempt.owner.instanceId !== instanceId) {
      throw Object.assign(new Error('Attempt ownership was lost'), { code: 'ATTEMPT_OWNERSHIP_LOST' });
    }
    const scan = EvaluationCheckpointService.scan(evalId, plan);
    const now = new Date();
    attempt.heartbeatAt = now.toISOString();
    attempt.leaseExpiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
    attempt.updatedAt = now.toISOString();
    attempt.counts.committedByAttempt = scan.checkpoints.filter(checkpoint => checkpoint.attemptId === attemptId).length;
    attempt.counts.terminalFailed = scan.terminalFailed;
    attempt.counts.remaining = scan.remaining;
    writeJsonAtomic(attemptPath(evalId, attemptId), attempt);
    return attempt;
  },

  transition(evalId: string, attemptId: string, status: EvaluationAttemptStatus, plan: EvaluationWorkPlan, terminalFailureId?: string): EvaluationAttempt {
    const attempt = this.heartbeat(evalId, attemptId, plan);
    attempt.status = status;
    attempt.updatedAt = new Date().toISOString();
    attempt.completedAt = attempt.updatedAt;
    attempt.terminalFailureId = terminalFailureId;
    writeJsonAtomic(attemptPath(evalId, attemptId), attempt);
    const state = this.loadState(evalId);
    if (state) {
      state.currentAttemptId = undefined;
      state.lastAttemptId = attemptId;
      state.recovery = {
        state: status === 'completed' ? 'not-needed' : attempt.counts.remaining === 0 ? 'finalization-only' : 'eligible',
        reusedCells: attempt.counts.planned - attempt.counts.remaining,
        remainingCells: attempt.counts.remaining,
        lastAttemptId: attemptId,
        requiresModelCalls: attempt.counts.remaining > 0,
      };
      state.updatedAt = attempt.updatedAt;
      writeJsonAtomic(statePath(evalId), state);
    }
    return attempt;
  },

  reconcileOnStartup(): string[] {
    const interrupted: string[] = [];
    for (const evalId of listDir(EVALUATIONS_DIR)) {
      const state = this.loadState(evalId);
      const attempt = this.loadAttempt(evalId, state?.currentAttemptId);
      if (!state || !attempt || attempt.status !== 'running') continue;
      const plan = readJson<EvaluationWorkPlan>(join(EVALUATIONS_DIR, evalId, 'work-plan.json'));
      const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
      if (!plan || !config) continue;
      attempt.status = 'interrupted';
      attempt.updatedAt = new Date().toISOString();
      attempt.completedAt = attempt.updatedAt;
      const scan = EvaluationCheckpointService.scan(evalId, plan);
      attempt.counts.remaining = scan.remaining;
      writeJsonAtomic(attemptPath(evalId, attempt.attemptId), attempt);
      state.currentAttemptId = undefined;
      state.lastAttemptId = attempt.attemptId;
      state.recovery = {
        state: scan.errors.length ? 'blocked' : scan.remaining === 0 ? 'finalization-only' : 'eligible',
        reasonCode: scan.errors.length
          ? (scan.errors.some(error => error.code === 'CHECKPOINT_SCHEMA_UNSUPPORTED') ? 'CHECKPOINT_SCHEMA_UNSUPPORTED' : 'CHECKPOINT_CORRUPT')
          : undefined,
        reusedCells: scan.committedIds.size,
        remainingCells: scan.remaining,
        lastAttemptId: attempt.attemptId,
        requiresModelCalls: scan.remaining > 0,
      };
      state.updatedAt = attempt.updatedAt;
      writeJsonAtomic(statePath(evalId), state);
      config.status = 'interrupted';
      config.updatedAt = attempt.updatedAt;
      writeJsonAtomic(join(EVALUATIONS_DIR, evalId, 'config.json'), config);
      interrupted.push(evalId);
    }
    return interrupted;
  },
};
