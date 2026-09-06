import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePaths } from '../services/FileService';
import { PromptService } from '../services/PromptService';
import { LmapiClient } from '../services/LmapiClient';
import { ExecutionService } from '../services/ExecutionService';
import { configureEvaluationRoutes, evaluationsRouter } from './evaluations';

let dataRoot: string;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  configureEvaluationRoutes({ appBasePath: '/lmeval/' });
  const app = express();
  app.use(express.json());
  app.use('/api/eval/evaluations', evaluationsRouter);
  await new Promise<void>(resolve => { server = app.listen(0, resolve); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/eval/evaluations`;
});

afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-evaluation-route-'));
  configurePaths({ dataRoot, repoRoot: process.cwd() });
  vi.spyOn(LmapiClient, 'getServers').mockResolvedValue([{ config: { name: 'local' }, isOnline: true, models: ['model-a'] } as never]);
  vi.spyOn(ExecutionService, 'run').mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(dataRoot, { recursive: true, force: true });
});

function body() {
  const prompt = PromptService.create({ name: 'Route prompt', content: 'Classify exactly.' });
  return {
    name: 'Route draft', promptIds: [prompt.id], modelIds: ['local::model-a'], comparisonMode: 'matrix',
    inlineTestCases: [{ id: 'case-1', userMessage: 'hello' }], inference: { temperature: 0.3, maxTokens: 1000 }, runsPerCell: 1,
  };
}

describe('agent-drivable evaluation routes', () => {
  it('creates a draft without execution, patches it, and starts it exactly once', async () => {
    const create = await fetch(`${baseUrl}/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.evaluation.status).toBe('draft');
    expect(created.browserPaths.config).toContain('/lmeval/eval/config/');
    expect(ExecutionService.run).not.toHaveBeenCalled();

    const patch = await fetch(`${baseUrl}/${created.evaluation.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Updated draft' }) });
    expect(patch.status).toBe(200);
    expect((await patch.json()).evaluation.name).toBe('Updated draft');

    const start = await fetch(`${baseUrl}/${created.evaluation.id}/run`, { method: 'POST' });
    expect(start.status).toBe(202);
    expect(ExecutionService.run).toHaveBeenCalledTimes(1);
    const again = await fetch(`${baseUrl}/${created.evaluation.id}/run`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(ExecutionService.run).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy create-and-start flat and persists inference', async () => {
    const response = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    expect(response.status).toBe(202);
    const created = await response.json();
    expect(created.id).toMatch(/^eval-/);
    expect(created.evaluation).toBeUndefined();
    expect(created.inference).toEqual({ temperature: 0.3, maxTokens: 1000 });
    expect(ExecutionService.run).toHaveBeenCalledTimes(1);
  });

  it('returns machine-readable validation and feedback states', async () => {
    const invalid = await fetch(`${baseUrl}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '', promptIds: [], modelIds: [] }) });
    expect(invalid.status).toBe(200);
    expect((await invalid.json()).valid).toBe(false);

    const create = await fetch(`${baseUrl}/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    const created = await create.json();
    const feedback = await fetch(`${baseUrl}/${created.evaluation.id}/feedback`);
    expect(feedback.status).toBe(200);
    expect(await feedback.json()).toMatchObject({ status: 'draft', readiness: { results: false, summary: false } });
  });
});
