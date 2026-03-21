#!/usr/bin/env node
const BASE = 'http://localhost:3200';

async function request(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log('Testing Session API...\n');
  let passed = 0;
  let failed = 0;

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}: ${(err as Error).message}`);
      failed++;
    }
  }

  // First create a prompt to reference
  const promptA = await request('POST', '/api/eval/prompts', { name: 'test-session-prompt-a', content: 'You are a helpful assistant.' });
  const promptB = await request('POST', '/api/eval/prompts', { name: 'test-session-prompt-b', content: 'You are a concise assistant.' });

  let sessionId = '';
  await check('Create session', async () => {
    const session = await request('POST', '/api/eval/sessions', {
      name: 'Test Session',
      description: 'Integration test session',
      promptA: { promptId: promptA.id, promptVersion: 1 },
      promptB: { promptId: promptB.id, promptVersion: 1 },
    });
    sessionId = session.id;
    if (!session.id || !session.slug || session.latestVersion !== 1) throw new Error('Invalid session shape');
    if (session.versions.length !== 1) throw new Error('Expected 1 version');
  });

  await check('List sessions includes new session', async () => {
    const list = await request('GET', '/api/eval/sessions');
    if (!list.find((s: { id: string }) => s.id === sessionId)) throw new Error('Session not in list');
  });

  await check('Get session by ID', async () => {
    const session = await request('GET', `/api/eval/sessions/${sessionId}`);
    if (session.id !== sessionId) throw new Error('Wrong session');
  });

  await check('Get active version', async () => {
    const version = await request('GET', `/api/eval/sessions/${sessionId}/active`);
    if (version.version !== 1) throw new Error('Wrong version');
    if (version.promptA.promptId !== promptA.id) throw new Error('Wrong promptA');
  });

  let v2: { version: number; evalRunIds: string[] };
  await check('Add second version', async () => {
    v2 = await request('POST', `/api/eval/sessions/${sessionId}/versions`, {
      description: 'Improved B',
      promptA: { promptId: promptB.id, promptVersion: 1 },
      promptB: { promptId: promptB.id, promptVersion: 1 },
    });
    if (v2.version !== 2) throw new Error('Expected version 2');
  });

  await check('List shows both versions', async () => {
    const session = await request('GET', `/api/eval/sessions/${sessionId}`);
    if (session.versions.length !== 2) throw new Error('Expected 2 versions');
    if (session.latestVersion !== 2) throw new Error('latestVersion should be 2');
  });

  let runId = '';
  await check('Add eval run', async () => {
    const run = await request('POST', `/api/eval/sessions/${sessionId}/runs`, {
      evalId: 'fake-eval-id',
      sessionVersion: 1,
    });
    runId = run.id;
    if (!run.id || run.status !== 'pending') throw new Error('Invalid run shape');
  });

  await check('Update run status', async () => {
    const updated = await request('PATCH', `/api/eval/sessions/${sessionId}/runs/${runId}`, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
    if (updated.status !== 'completed') throw new Error('Status not updated');
  });

  await check('List eval runs', async () => {
    const runs = await request('GET', `/api/eval/sessions/${sessionId}/runs`);
    if (!runs.find((r: { id: string }) => r.id === runId)) throw new Error('Run not in list');
  });

  await check('Delete session', async () => {
    await request('DELETE', `/api/eval/sessions/${sessionId}`);
    const list = await request('GET', '/api/eval/sessions');
    if (list.find((s: { id: string }) => s.id === sessionId)) throw new Error('Session not deleted');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
