import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVALUATIONS_DIR, ensureDir, generateId, writeJsonAtomic } from './FileService';
import type { EvaluationFailure } from '../../src/types/eval';

const SECRET_PATTERN = /(authorization|api[-_ ]?key|token|password|prompt|response|request body)/gi;
function sanitize(message: string): string {
  const withoutUrls = message.replace(/https?:\/\/[^\s]+/gi, '[url redacted]');
  return withoutUrls.replace(SECRET_PATTERN, '[redacted]').slice(0, 1000);
}

export const EvaluationFailureService = {
  record(input: Omit<EvaluationFailure, 'schemaVersion' | 'failureId' | 'timestamp' | 'message'> & { message: string }): EvaluationFailure {
    const failure: EvaluationFailure = {
      ...input,
      schemaVersion: 1,
      failureId: generateId('failure'),
      timestamp: new Date().toISOString(),
      message: sanitize(input.message),
    };
    const dir = join(EVALUATIONS_DIR, failure.evaluationId);
    ensureDir(dir);
    appendFileSync(join(dir, 'failures.jsonl'), `${JSON.stringify(failure)}\n`, 'utf-8');
    return failure;
  },

  terminalSummary(evalId: string, failure: EvaluationFailure): void {
    writeJsonAtomic(join(EVALUATIONS_DIR, evalId, 'error.json'), {
      error: failure.message,
      code: failure.code,
      failureId: failure.failureId,
      updatedAt: failure.timestamp,
    });
  },
};
