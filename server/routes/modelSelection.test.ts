import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configurePaths } from '../services/FileService';
import { ModelSelectionService } from '../services/ModelSelectionService';
import { modelSelectionRouter } from './modelSelection';

let dataRoot: string;
let server: Server;
let baseUrl: string;

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
});

afterEach(() => {
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(dataRoot, { recursive: true, force: true });
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

  it('returns 404 when a known campaign has nothing in flight to cancel', () => {
    const campaign = ModelSelectionService.createCampaign({
      tasks: ['classification'],
      incumbentModelId: 'm1',
      candidateSlate: [{ modelId: 'm1', lmapiServer: 's1' }],
      promptIdsByTask: { classification: ['p1'] },
      testSuiteIdByTask: { classification: 'suite-1' },
    });
    // No phase eval has been recorded yet (runCampaign never started), so
    // there is nothing for ExecutionService.cancel to act on.
    expect(ModelSelectionService.cancel(campaign.id)).toBe(false);
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
