import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePaths } from '../services/FileService';
import { ModelSelectionService } from '../services/ModelSelectionService';
import { PromptService } from '../services/PromptService';
import { LmapiClient } from '../services/LmapiClient';
import { modelSelectionRouter } from './modelSelection';

let dataRoot: string;
let server: Server;
let baseUrl: string;
let validDraft: Record<string, unknown>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/eval/model-selection', modelSelectionRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/eval/model-selection`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-model-selection-route-'));
  configurePaths({ dataRoot, repoRoot: process.cwd() });
  const first = PromptService.create({ name: 'Route campaign prompt one', content: 'Prompt one' });
  const second = PromptService.create({ name: 'Route campaign prompt two', content: 'Prompt two' });
  vi.spyOn(LmapiClient, 'getServers').mockResolvedValue([{ config: { name: 'local', baseUrl: 'http://local' }, isOnline: true, models: ['incumbent', 'candidate'], runningModels: [], activeModels: [], activeRequests: 0, lastChecked: Date.now() }]);
  validDraft = { tasks: ['classification'], incumbentModelId: 'local::incumbent', candidateSlate: [{ modelId: 'local::incumbent', lmapiServer: 'local' }, { modelId: 'local::candidate', lmapiServer: 'local' }], promptPinsByTask: { classification: [{ promptId: first.id, version: 1 }, { promptId: second.id, version: 1 }] }, testSuiteIdByTask: { classification: 'memory-classification-v1' } };
});

afterEach(() => {
  vi.restoreAllMocks();
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('campaign draft lifecycle routes', () => {
  it('validates, saves, patches, and returns consolidated feedback without starting model work', async () => {
    const validate = await fetch(`${baseUrl}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validDraft) });
    expect(validate.status).toBe(200);
    expect((await validate.json()).valid).toBe(true);

    const create = await fetch(`${baseUrl}/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validDraft) });
    expect(create.status).toBe(201);
    const campaign = await create.json();
    expect(campaign.status).toBe('draft');

    const patch = await fetch(`${baseUrl}/${campaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validDraft) });
    expect(patch.status).toBe(200);
    const feedback = await fetch(`${baseUrl}/${campaign.id}/feedback`);
    expect(feedback.status).toBe(200);
    expect(await feedback.json()).toMatchObject({ campaign: { id: campaign.id, status: 'draft' }, browserPath: `/campaigns/${campaign.id}` });
  });

  it('allows exactly one concurrent draft start transition', async () => {
    const campaign = await ModelSelectionService.createDraft(validDraft as never);
    const results = await Promise.allSettled([
      ModelSelectionService.startDraft(campaign.id),
      ModelSelectionService.startDraft(campaign.id),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(ModelSelectionService.getCampaign(campaign.id)?.status).toBe('pending');
  });
});

describe('POST /api/eval/model-selection', () => {
  it('returns 400 when incumbentModelId is missing', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: ['classification'],
        candidateSlate: [{ modelId: 'm1', lmapiServer: 's1' }],
        promptIdsByTask: { classification: ['p1'] },
        testSuiteIdByTask: { classification: 'suite-1' },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/incumbentModelId/);
  });

  it('returns 400 when candidateSlate is empty', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: ['classification'],
        incumbentModelId: 'm1',
        candidateSlate: [],
        promptIdsByTask: { classification: ['p1'] },
        testSuiteIdByTask: { classification: 'suite-1' },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/candidateSlate/);
  });
});

describe('GET /api/eval/model-selection/:id', () => {
  it('returns 404 for an unknown campaign', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/eval/model-selection/:id/cancel', () => {
  it('returns 404 for an unknown campaign', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist/cancel`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('cancels a pending campaign before its first phase is dispatched', () => {
    const campaign = ModelSelectionService.createCampaign({
      tasks: ['classification'],
      incumbentModelId: 'm1',
      candidateSlate: [{ modelId: 'm1', lmapiServer: 's1' }],
      promptIdsByTask: { classification: ['p1'] },
      testSuiteIdByTask: { classification: 'suite-1' },
    });
    expect(ModelSelectionService.cancel(campaign.id)).toBe(true);
    expect(ModelSelectionService.getCampaign(campaign.id)?.status).toBe('cancelled');
  });
});

describe('PUT /api/eval/model-selection/latency-budgets', () => {
  it('round-trips a valid budgets payload', async () => {
    const budgets = { classification: 500, tagging: 500, summarization: 2000 };
    const putRes = await fetch(`${baseUrl}/latency-budgets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(budgets),
    });
    expect(putRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/latency-budgets`);
    expect(await getRes.json()).toEqual(budgets);
  });

  it('returns 400 when a task is missing a numeric value', async () => {
    const res = await fetch(`${baseUrl}/latency-budgets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification: 500, tagging: 500 }),
    });
    expect(res.status).toBe(400);
  });
});
