import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configurePaths } from '../services/FileService';
import { judgesRouter } from './judges';

let server: Server;
let baseUrl: string;
let dataRoot: string;

beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/eval/judges', judgesRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/eval/judges`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-judge-route-')); configurePaths({ dataRoot, repoRoot: process.cwd() }); });
afterEach(() => { configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() }); rmSync(dataRoot, { recursive: true, force: true }); });

describe('judge qualification lifecycle routes', () => {
  it('returns the consolidated missing state and a 404 for an unknown run', async () => {
    const status = await fetch(`${baseUrl}/${encodeURIComponent('local::judge')}/qualification-status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ state: 'missing', current: false, record: null });
    expect((await fetch(`${baseUrl}/qualification-runs/does-not-exist`)).status).toBe(404);
  });

  it('rejects malformed judge identifiers before dispatch', async () => {
    const response = await fetch(`${baseUrl}/plain-model/qualification-runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(400);
  });
});
