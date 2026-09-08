import { join } from 'path';
import { ensureDir, EVALUATIONS_DIR, generateId, readJson, writeJson } from './FileService';
import { PromptService } from './PromptService';
import { SessionService } from './SessionService';
import { EvaluationValidationService, validateEvaluationInputShape } from './EvaluationValidationService';
import type { EvaluationConfig, EvaluationInput, EvaluationValidationResult } from '../../src/types/eval';

// startDraft performs asynchronous validation before persisting the pending
// transition. Reserve the ID across that await so concurrent callers cannot
// both dispatch the same evaluation in this process.
const startingDrafts = new Set<string>();

export function browserPaths(evalId: string, appBasePath = '/') {
  const base = `/${appBasePath.split('/').filter(Boolean).join('/')}`;
  const prefix = base === '/' ? '' : base;
  return {
    config: `${prefix}/eval/config/${evalId}`,
    run: `${prefix}/eval/run/${evalId}`,
    results: `${prefix}/eval/results/${evalId}`,
    summary: `${prefix}/eval/summary/${evalId}`,
  };
}

function currentPins(promptIds: string[]): Array<{ promptId: string; version: number }> {
  return promptIds.map(promptId => ({
    promptId,
    version: PromptService.get(promptId)?.versions.at(-1)?.version ?? 0,
  }));
}

export function normalizeEvaluationInput(input: EvaluationInput): EvaluationInput {
  const promptIds = [...(input.promptIds ?? [])];
  return {
    name: input.name?.trim() ?? '',
    promptIds,
    promptVersions: input.promptVersions?.map(pin => ({ ...pin })) ?? currentPins(promptIds),
    modelIds: [...(input.modelIds ?? [])],
    comparisonMode: input.comparisonMode ?? 'matrix',
    purposeTemplateId: input.purposeTemplateId,
    testSuiteId: input.testSuiteId,
    userMessage: input.userMessage?.trim() || undefined,
    inlineTestCases: input.inlineTestCases?.length ? input.inlineTestCases : undefined,
    templateId: input.templateId,
    judgeModelId: input.judgeModelId,
    enablePairwise: input.enablePairwise ?? false,
    runsPerCell: input.runsPerCell ?? 1,
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion,
    inference: input.inference ? { ...input.inference } : undefined,
    benchmarkMode: input.benchmarkMode,
    campaignId: input.campaignId,
    campaignRole: input.campaignRole,
  };
}

function toConfig(input: EvaluationInput, status: EvaluationConfig['status'], existing?: EvaluationConfig): EvaluationConfig {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? generateId('eval'),
    ...input,
    status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export const EvaluationService = {
  get(id: string): EvaluationConfig | null {
    return readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
  },

  async validate(input: EvaluationInput): Promise<{ input: EvaluationInput; validation: EvaluationValidationResult }> {
    const shapeFailure = validateEvaluationInputShape(input);
    if (shapeFailure) return { input, validation: shapeFailure };
    const normalized = normalizeEvaluationInput(input);
    return { input: normalized, validation: await EvaluationValidationService.validate(normalized) };
  },

  async create(input: EvaluationInput, status: 'draft' | 'pending'): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult; evalRunId?: string }> {
    const checked = await this.validate(input);
    if (!checked.validation.valid) throw Object.assign(new Error('Evaluation configuration is invalid'), { validation: checked.validation });
    const evaluation = toConfig(checked.input, status);
    ensureDir(join(EVALUATIONS_DIR, evaluation.id));
    writeJson(join(EVALUATIONS_DIR, evaluation.id, 'config.json'), evaluation);
    let evalRunId: string | undefined;
    if (status === 'pending' && evaluation.sessionId && evaluation.sessionVersion != null) {
      evalRunId = SessionService.addEvalRun(evaluation.sessionId, evaluation.sessionVersion, evaluation.id)?.id;
    }
    return { evaluation, validation: checked.validation, evalRunId };
  },

  async patchDraft(id: string, patch: Partial<EvaluationInput>): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult }> {
    const existing = this.get(id);
    if (!existing) throw Object.assign(new Error('Evaluation not found'), { code: 'EVALUATION_NOT_FOUND' });
    if (existing.status !== 'draft') throw Object.assign(new Error('Only draft evaluations can be edited'), { code: 'EVALUATION_NOT_DRAFT' });
    const merged = { ...existing, ...patch } as EvaluationInput;
    if (patch.promptIds && !patch.promptVersions) merged.promptVersions = undefined;
    const checked = await this.validate(merged);
    if (!checked.validation.valid) throw Object.assign(new Error('Evaluation configuration is invalid'), { validation: checked.validation });
    const evaluation = toConfig(checked.input, 'draft', existing);
    writeJson(join(EVALUATIONS_DIR, id, 'config.json'), evaluation);
    return { evaluation, validation: checked.validation };
  },

  async startDraft(id: string): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult; evalRunId?: string }> {
    const existing = this.get(id);
    if (!existing) throw Object.assign(new Error('Evaluation not found'), { code: 'EVALUATION_NOT_FOUND' });
    if (existing.status !== 'draft' || startingDrafts.has(id)) {
      throw Object.assign(new Error('Evaluation has already been started'), { code: 'EVALUATION_ALREADY_STARTED' });
    }

    startingDrafts.add(id);
    try {
      const checked = await this.validate(existing);
      if (!checked.validation.valid) throw Object.assign(new Error('Evaluation configuration is invalid'), { validation: checked.validation });
      const evaluation = toConfig(checked.input, 'pending', existing);
      writeJson(join(EVALUATIONS_DIR, id, 'config.json'), evaluation);
      const evalRunId = evaluation.sessionId && evaluation.sessionVersion != null
        ? SessionService.addEvalRun(evaluation.sessionId, evaluation.sessionVersion, evaluation.id)?.id
        : undefined;
      return { evaluation, validation: checked.validation, evalRunId };
    } finally {
      startingDrafts.delete(id);
    }
  },
};
