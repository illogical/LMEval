#!/usr/bin/env node
// Integration test for execution pipeline
// Requires the eval server running on localhost:3200 and LMApi on localhost:3111

const BASE = 'http://localhost:3200';

async function request(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  console.log('Testing Execution Pipeline...\n');
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

  let promptId = '';
  let modelId = '';

  await check('Create test prompt', async () => {
    const prompt = await request('POST', '/api/eval/prompts', {
      name: 'exec-test-prompt',
      content: 'You are a helpful assistant. Answer briefly.',
    });
    promptId = prompt.id;
    if (!promptId) throw new Error('No prompt ID returned');
  });

  await check('Get available models', async () => {
    const models = await request('GET', '/api/eval/models');
    const modelList = (models as Array<{ models: string[] }>).flatMap(s => s.models ?? []);
    if (modelList.length === 0) throw new Error('No models available from LMApi');
    modelId = modelList[0];
  });

  let evalId = '';
  await check('Create evaluation', async () => {
    const evalConfig = await request('POST', '/api/eval/evaluations', {
      name: 'Execution Test',
      promptIds: [promptId],
      modelIds: [modelId],
      userMessage: 'Say hello in one word.',
      runsPerCell: 1,
    });
    evalId = evalConfig.id;
    if (!evalId) throw new Error('No eval ID returned');
    if (evalConfig.status !== 'pending') throw new Error('Expected pending status');
  });

  await check('Evaluation completes', async () => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const evalConfig = await request('GET', `/api/eval/evaluations/${evalId}`);
      if (evalConfig.status === 'completed') return;
      if (evalConfig.status === 'failed') throw new Error(`Eval failed`);
    }
    throw new Error('Evaluation did not complete within 60s');
  });

  await check('Results have correct structure', async () => {
    const results = await request('GET', `/api/eval/evaluations/${evalId}/results`);
    if (!Array.isArray(results)) throw new Error('Results should be array');
    if (results.length === 0) throw new Error('Results should not be empty');
    const cell = results[0] as { id?: string; modelId?: string };
    if (!cell.id || !cell.modelId) throw new Error('Cell missing id or modelId');
  });

  await check('Summary has model rankings', async () => {
    const summary = await request('GET', `/api/eval/evaluations/${evalId}/summary`);
    if (!summary.modelSummaries || summary.modelSummaries.length === 0) {
      throw new Error('No model summaries in summary');
    }
  });

  await check('Cancel non-existent eval returns gracefully', async () => {
    const res = await fetch(`${BASE}/api/eval/evaluations/fake-eval-id`, { method: 'DELETE' });
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
