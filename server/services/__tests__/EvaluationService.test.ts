import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePaths } from '../FileService';
import { PromptService } from '../PromptService';
import { LmapiClient } from '../LmapiClient';
import { EvaluationService } from '../EvaluationService';
import { EvaluationFeedbackService } from '../EvaluationFeedbackService';
import { ExecutionService } from '../ExecutionService';
import type { EvaluationInput } from '../../../src/types/eval';

let dataRoot: string;

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  const prompt = PromptService.create({ name: `Prompt ${Math.random()}`, content: 'System prompt' });
  return {
    name: 'Agent draft',
    promptIds: [prompt.id],
    modelIds: ['local::model-a'],
    comparisonMode: 'matrix',
    inlineTestCases: [{ id: 'case-1', userMessage: 'hello' }],
    inference: { temperature: 0.3, maxTokens: 1000, seed: 1 },
    runsPerCell: 1,
    ...overrides,
  };
}

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-evaluation-service-'));
  configurePaths({ dataRoot, repoRoot: process.cwd() });
  vi.spyOn(LmapiClient, 'getServers').mockResolvedValue([{ config: { name: 'local' }, isOnline: true, models: ['model-a', 'model-b'] } as never]);
});

afterEach(() => {
  vi.restoreAllMocks();
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('EvaluationService', () => {
  it('pins the current prompt version and preserves inference in a draft', async () => {
    const candidate = input();
    const promptId = candidate.promptIds[0];
    PromptService.addVersion(promptId, 'Changed after draft creation');
    candidate.promptVersions = [{ promptId, version: 1 }];
    const created = await EvaluationService.create(candidate, 'draft');
    expect(created.evaluation.status).toBe('draft');
    expect(created.evaluation.promptVersions).toEqual([{ promptId: created.evaluation.promptIds[0], version: 1 }]);
    expect(created.evaluation.inference).toEqual({ temperature: 0.3, maxTokens: 1000, seed: 1 });
    expect(ExecutionService.buildMatrix(created.evaluation, candidate.inlineTestCases!)[0].promptVersion).toBe(1);
  });

  it('rejects comparison cardinality, invalid inference, conflicting test sources, and pairwise', async () => {
    const candidate = input({
      comparisonMode: 'model',
      modelIds: ['local::model-a'],
      userMessage: 'also selected',
      inference: { temperature: 3, maxTokens: 0 },
      enablePairwise: true,
    });
    const result = await EvaluationService.validate(candidate);
    expect(result.validation.errors.map(error => error.code)).toEqual(expect.arrayContaining([
      'MODEL_COMPARISON_REQUIRES_TWO_MODELS', 'TEST_SOURCE_REQUIRED', 'INVALID_TEMPERATURE', 'INVALID_MAX_TOKENS', 'PAIRWISE_UNSUPPORTED',
    ]));
  });

  it('re-pins when promptIds change in a partial patch and refuses post-start mutation', async () => {
    const created = await EvaluationService.create(input(), 'draft');
    const replacement = PromptService.create({ name: 'Replacement', content: 'New prompt' });
    const patched = await EvaluationService.patchDraft(created.evaluation.id, { promptIds: [replacement.id] });
    expect(patched.evaluation.promptVersions).toEqual([{ promptId: replacement.id, version: 1 }]);
    await EvaluationService.startDraft(created.evaluation.id);
    await expect(EvaluationService.patchDraft(created.evaluation.id, { name: 'too late' })).rejects.toMatchObject({ code: 'EVALUATION_NOT_DRAFT' });
    await expect(EvaluationService.startDraft(created.evaluation.id)).rejects.toMatchObject({ code: 'EVALUATION_ALREADY_STARTED' });
  });

  it('builds a base-path-aware feedback snapshot before execution artifacts exist', async () => {
    const created = await EvaluationService.create(input(), 'draft');
    const feedback = await EvaluationFeedbackService.get(created.evaluation.id, '/lmeval/');
    expect(feedback).toMatchObject({
      status: 'draft',
      progress: { total: 0, completed: 0, failed: 0 },
      readiness: { results: false, summary: false },
      appBasePath: '/lmeval/',
      browserPaths: { config: `/lmeval/eval/config/${created.evaluation.id}` },
    });
  });
});
