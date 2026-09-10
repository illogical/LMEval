import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePaths, ensureDir, readJson, readJsonSafe, writeJsonAtomic } from '../FileService';
import { EvaluationPlanService } from '../EvaluationPlanService';
import { EvaluationCheckpointService } from '../EvaluationCheckpointService';
import { EvaluationAttemptService } from '../EvaluationAttemptService';
import { parseServerQualifiedModel } from '../ServerQualifiedModelService';
import { DurableExecutionService } from '../DurableExecutionService';
import { ExecutionService } from '../ExecutionService';
import { LmapiClient } from '../LmapiClient';
import { PromptService } from '../PromptService';
import { JudgeQualificationService } from '../JudgeQualificationService';
import { resetForTests as resetInsightsForTests } from '../InsightsIndexService';
import type { EvaluationConfig, EvalMatrixCell, JudgeQualification, PromptManifest, TestCase } from '../../../src/types/eval';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lmeval-recovery-'));
  configurePaths({ dataRoot: root, repoRoot: process.cwd() });
  EvaluationAttemptService.initialize();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetInsightsForTests();
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const config: EvaluationConfig = {
    id: 'eval-recovery', name: 'Recovery', promptIds: ['prompt-1'], promptVersions: [{ promptId: 'prompt-1', version: 2 }],
    modelIds: ['local::model-a'], inlineTestCases: [{ id: 'case-1', userMessage: 'hello' }], runsPerCell: 2,
    status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const manifest: PromptManifest = {
    id: 'prompt-1', name: 'Prompt', slug: 'prompt', versions: [{ version: 2, createdAt: '', description: '', tokensEstimate: 1 }],
    createdAt: '', updatedAt: '',
  };
  const testCases: TestCase[] = [{ id: 'case-1', userMessage: 'hello' }];
  return EvaluationPlanService.create({ config, prompts: [{ manifest, version: 2, content: 'system' }], testCases, template: null, purposeTemplate: null });
}

function judgeFixture() {
  const config: EvaluationConfig = {
    id: 'eval-judge-recovery', name: 'Judge Recovery', promptIds: ['prompt-1'],
    promptVersions: [{ promptId: 'prompt-1', version: 2 }], modelIds: ['local::model-a'],
    judgeModelId: 'local::judge-a', inlineTestCases: [{ id: 'case-1', userMessage: 'hello' }], runsPerCell: 1,
    status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const manifest: PromptManifest = {
    id: 'prompt-1', name: 'Prompt', slug: 'prompt', versions: [{ version: 2, createdAt: '', description: '', tokensEstimate: 1 }],
    createdAt: '', updatedAt: '',
  };
  const testCases: TestCase[] = [{ id: 'case-1', userMessage: 'hello' }];
  const qualification: JudgeQualification = {
    judgeModelId: 'local::judge-a', calibrationSetHash: 'hash-1', qualifiedAt: '2026-01-01T00:00:00.000Z',
    spearman: 0.9, faithfulnessWithin1Pct: 0.9, meanInflation: 0, selfConsistencyMAD: {}, qualified: true,
    settingsSha256: 'settings-1',
  };
  const built = EvaluationPlanService.create({
    config, prompts: [{ manifest, version: 2, content: 'system' }], testCases,
    template: null, purposeTemplate: null, judgeQualification: qualification,
  });
  return { ...built, config, qualification };
}

describe('durable recovery primitives', () => {
  it('atomically replaces valid JSON and reports corruption without mutating it', () => {
    const path = join(root, 'atomic.json');
    writeJsonAtomic(path, { value: 1 });
    writeJsonAtomic(path, { value: 2 });
    expect(readJson<{ value: number }>(path)?.value).toBe(2);
    writeFileSync(path, '{broken', 'utf-8');
    expect(readJsonSafe(path).state).toBe('corrupt');
    expect(readFileSync(path, 'utf-8')).toBe('{broken');
  });

  it('pins stable cell identities including repetitions and excludes timestamps from the input hash', () => {
    const first = fixture();
    const second = fixture();
    second.inputs.createdAt = '2030-01-01T00:00:00.000Z';
    expect(EvaluationPlanService.validate(second.inputs, second.plan)).toEqual([]);
    expect(first.plan.planSha256).toBe(second.plan.planSha256);
    expect(first.plan.items).toHaveLength(2);
    expect(new Set(first.plan.items.map(item => item.cellKey)).size).toBe(2);
    expect(first.plan.items.map(item => item.repetition)).toEqual([1, 2]);
  });

  it('derives committed and remaining counts from validated checkpoint files', () => {
    const { inputs, plan } = fixture();
    EvaluationPlanService.persist('eval-recovery', inputs, plan);
    const item = plan.items[0];
    const cell: EvalMatrixCell = {
      id: item.cellId, evalId: plan.evalId, promptId: item.promptId, promptVersion: item.promptVersion,
      modelId: item.model.canonicalId, testCaseId: item.testCaseId, run: item.repetition, status: 'completed',
    };
    EvaluationCheckpointService.commit(plan.evalId, plan, item.cellId, cell, 'attempt-1');
    const scan = EvaluationCheckpointService.scan(plan.evalId, plan);
    expect(scan.committedIds.size).toBe(1);
    expect(scan.remaining).toBe(1);
    expect(scan.errors).toEqual([]);
  });

  it('detects a corrupt checkpoint and startup reconciliation interrupts a stale attempt', () => {
    const { inputs, plan } = fixture();
    EvaluationPlanService.persist(plan.evalId, inputs, plan);
    const evalDir = join(root, 'evals', 'evaluations', plan.evalId);
    ensureDir(join(evalDir, 'cell-results'));
    writeFileSync(join(evalDir, 'cell-results', 'bad.json'), '{bad', 'utf-8');
    expect(EvaluationCheckpointService.scan(plan.evalId, plan).errors).toHaveLength(1);
    rmSync(join(evalDir, 'cell-results'), { recursive: true, force: true });
    writeJsonAtomic(join(evalDir, 'config.json'), {
      id: plan.evalId, name: 'Recovery', promptIds: ['prompt-1'], modelIds: ['local::model-a'],
      status: 'running', createdAt: '', updatedAt: '',
    });
    const attempt = EvaluationAttemptService.acquire(plan.evalId, plan);
    expect(EvaluationAttemptService.reconcileOnStartup()).toEqual([plan.evalId]);
    expect(EvaluationAttemptService.loadAttempt(plan.evalId, attempt.attemptId)?.status).toBe('interrupted');
    expect(readJson<EvaluationConfig>(join(evalDir, 'config.json'))?.status).toBe('interrupted');
  });

  it('restarts and resumes without dispatching an already committed cell', async () => {
    const prompt = PromptService.create({ name: 'Resume prompt', content: 'system' });
    const evalId = 'eval-restart';
    const evalDir = join(root, 'evals', 'evaluations', evalId);
    ensureDir(evalDir);
    writeJsonAtomic(join(evalDir, 'config.json'), {
      id: evalId, name: 'Restart', promptIds: [prompt.id], promptVersions: [{ promptId: prompt.id, version: 1 }],
      modelIds: ['local::model-a'], inlineTestCases: [{ id: 'case-1', userMessage: 'hello' }], runsPerCell: 2,
      status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } satisfies EvaluationConfig);
    const calls: string[] = [];
    vi.spyOn(ExecutionService, 'runPromptfoo').mockImplementation(async (_evalId, _config, cells) => {
      calls.push(cells[0].cellKey ?? cells[0].id);
      return [{ ...cells[0], status: 'completed', response: 'ok' }];
    });
    const prepared = await DurableExecutionService.prepare(evalId);
    await DurableExecutionService.executeCell(
      evalId, prepared.config, prepared.inputs, prepared.plan, prepared.plan.items[0],
      prepared.attempt.attemptId, new AbortController()
    );
    expect(calls).toEqual([prepared.plan.items[0].cellKey]);

    EvaluationAttemptService.initialize();
    expect(EvaluationAttemptService.reconcileOnStartup()).toEqual([evalId]);
    vi.spyOn(LmapiClient, 'getServers').mockResolvedValue([{ config: { name: 'local' }, isOnline: true, models: ['model-a'] } as never]);
    const deferredExecute = vi.spyOn(DurableExecutionService, 'execute').mockResolvedValue();
    const resumed = await DurableExecutionService.resume(evalId);
    expect(resumed.counts).toMatchObject({ total: 2, reused: 1, remaining: 1 });
    expect(resumed.preflight.checks.some(check => check.code === 'MODEL_ARTIFACT_IDENTITY_UNAVAILABLE' && check.informational)).toBe(true);
    deferredExecute.mockRestore();
    await DurableExecutionService.execute(evalId, resumed.attemptId);
    expect(calls).toEqual([prepared.plan.items[0].cellKey, prepared.plan.items[1].cellKey]);
    expect(readJson<EvaluationConfig>(join(evalDir, 'config.json'))?.status).toBe('completed');
    expect(readJson<EvalMatrixCell[]>(join(evalDir, 'results.json'))?.map(cell => cell.attemptId)).toEqual([
      prepared.attempt.attemptId, resumed.attemptId,
    ]);
  });

  it('flags checkpoints with an unsupported schema version separately from corruption', () => {
    const { inputs, plan } = fixture();
    EvaluationPlanService.persist(plan.evalId, inputs, plan);
    const item = plan.items[0];
    const cell: EvalMatrixCell = {
      id: item.cellId, evalId: plan.evalId, promptId: item.promptId, promptVersion: item.promptVersion,
      modelId: item.model.canonicalId, testCaseId: item.testCaseId, run: item.repetition, status: 'completed',
    };
    const checkpoint = EvaluationCheckpointService.commit(plan.evalId, plan, item.cellId, cell, 'attempt-1');
    const evalDir = join(root, 'evals', 'evaluations', plan.evalId);
    writeJsonAtomic(join(evalDir, 'cell-results', `${item.cellId}.json`), { ...checkpoint, schemaVersion: 2 });
    const scan = EvaluationCheckpointService.scan(plan.evalId, plan);
    expect(scan.errors).toEqual([{ code: 'CHECKPOINT_SCHEMA_UNSUPPORTED', file: `${item.cellId}.json`, message: expect.stringContaining('schema version 2') }]);
  });

  it('flags an unsupported promptfoo result schema version during plan validation', () => {
    const { inputs, plan } = fixture();
    const bumped = { ...inputs, promptfoo: { ...inputs.promptfoo, resultSchemaVersion: 2 as never } };
    expect(EvaluationPlanService.validate(bumped, plan)).toContain('PROMPTFOO_SCHEMA_UNSUPPORTED');
  });

  it('blocks resume when a qualified-required judge is no longer qualified', async () => {
    const { inputs, plan, config } = judgeFixture();
    EvaluationPlanService.persist(plan.evalId, inputs, plan);
    const evalDir = join(root, 'evals', 'evaluations', plan.evalId);
    writeJsonAtomic(join(evalDir, 'config.json'), { ...config, status: 'interrupted' } satisfies EvaluationConfig);
    vi.spyOn(LmapiClient, 'getServers').mockResolvedValue([{ config: { name: 'local' }, isOnline: true, models: ['model-a', 'judge-a'] } as never]);
    vi.spyOn(JudgeQualificationService, 'status').mockReturnValue({ state: 'stale', current: false, record: null });
    await expect(DurableExecutionService.resume(plan.evalId)).rejects.toMatchObject({
      code: 'RESUME_INCOMPATIBLE',
      checks: expect.arrayContaining([expect.objectContaining({ code: 'JUDGE_QUALIFICATION_STALE', compatible: false })]),
    });
  });

  it('blocks resume when the judge selection no longer matches its immutable snapshot', async () => {
    const { inputs, plan, config, qualification } = judgeFixture();
    EvaluationPlanService.persist(plan.evalId, inputs, plan);
    const evalDir = join(root, 'evals', 'evaluations', plan.evalId);
    writeJsonAtomic(join(evalDir, 'config.json'), {
      ...config, status: 'interrupted', judgeModelId: 'local::different-judge',
    } satisfies EvaluationConfig);
    vi.spyOn(LmapiClient, 'getServers').mockResolvedValue([{ config: { name: 'local' }, isOnline: true, models: ['model-a', 'judge-a'] } as never]);
    vi.spyOn(JudgeQualificationService, 'status').mockReturnValue({ state: 'qualified', current: true, record: qualification });
    await expect(DurableExecutionService.resume(plan.evalId)).rejects.toMatchObject({
      code: 'RESUME_INCOMPATIBLE',
      checks: expect.arrayContaining([expect.objectContaining({ code: 'JUDGE_POLICY_MISMATCH', compatible: false })]),
    });
  });
});

describe('server-qualified model identity', () => {
  it('splits only the first separator and rejects unqualified identifiers', () => {
    expect(parseServerQualifiedModel('Tiny::org::model')).toEqual({ canonicalId: 'Tiny::org::model', serverName: 'Tiny', modelName: 'org::model' });
    expect(() => parseServerQualifiedModel('model-only')).toThrow(/server::model/);
  });
});
