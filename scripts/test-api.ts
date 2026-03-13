/**
 * Integration test script for the eval API backend.
 * Run with: bun run scripts/test-api.ts
 * (Requires server to be running on PORT 3200)
 */

const BASE = `http://localhost:${process.env.PORT ?? 3200}/api/eval`;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function put(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function del(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  return res.json();
}

console.log('\n🧪 Eval API Integration Tests\n');

// ─── Templates ───────────────────────────────────────────────────────────────
console.log('── Templates ──');

let customTemplateId = '';

await test('GET /templates returns built-ins', async () => {
  const list = await get('/templates') as Array<{ id: string; isBuiltIn: boolean }>;
  assert(Array.isArray(list), 'Should return array');
  const builtIns = list.filter(t => t.isBuiltIn);
  assert(builtIns.length >= 4, `Should have at least 4 built-ins, got ${builtIns.length}`);
  const ids = list.map(t => t.id);
  assert(ids.includes('general-quality'), 'Should include general-quality');
  assert(ids.includes('tool-calling'), 'Should include tool-calling');
});

await test('GET /templates/:id returns built-in', async () => {
  const t = await get('/templates/general-quality') as { id: string; name: string };
  assert(t.id === 'general-quality', 'Should return correct template');
  assert(t.name === 'General Quality', 'Should have correct name');
});

await test('POST /templates creates custom template', async () => {
  const t = await post('/templates', {
    name: 'Test Custom Template',
    description: 'Created by test',
    deterministicChecks: { formatCompliance: false, jsonSchemaValidation: false, toolCallValidation: false },
    judgeConfig: { enabled: false, model: '', perspectives: [], pairwiseComparison: false, runsPerCombination: 1 }
  }) as { id: string; name: string };
  assert(t.id, 'Should have an ID');
  assert(t.name === 'Test Custom Template', 'Should have correct name');
  customTemplateId = t.id;
});

await test('GET /templates includes custom template', async () => {
  const list = await get('/templates') as Array<{ id: string }>;
  assert(list.some(t => t.id === customTemplateId), 'Should include the created template');
});

await test('DELETE /templates/:id removes custom template', async () => {
  const result = await del(`/templates/${customTemplateId}`) as { success: boolean };
  assert(result.success, 'Should return success');
});

await test('DELETE /templates/general-quality fails (built-in)', async () => {
  const res = await fetch(`${BASE}/templates/general-quality`, { method: 'DELETE' });
  assert(res.status === 403, `Should return 403, got ${res.status}`);
});

// ─── Prompts ─────────────────────────────────────────────────────────────────
console.log('\n── Prompts ──');

let promptId = '';

await test('POST /prompts creates a new prompt', async () => {
  const p = await post('/prompts', {
    name: 'Test System Prompt',
    content: 'You are a helpful assistant that answers questions concisely.',
    description: 'Test prompt for API tests',
    notes: 'Initial version'
  }) as { id: string; slug: string; currentVersion: number };
  assert(p.id, 'Should have an ID');
  assert(p.slug, 'Should have a slug');
  assert(p.currentVersion === 1, 'Should start at version 1');
  promptId = p.id;
});

await test('GET /prompts returns the created prompt', async () => {
  const list = await get('/prompts') as Array<{ id: string }>;
  assert(Array.isArray(list), 'Should return array');
  assert(list.some(p => p.id === promptId), 'Should include the created prompt');
});

await test('GET /prompts/:id returns manifest', async () => {
  const p = await get(`/prompts/${promptId}`) as { id: string; versions: Array<{ version: number }> };
  assert(p.id === promptId, 'Should return correct prompt');
  assert(p.versions.length === 1, 'Should have 1 version');
});

await test('GET /prompts/:id/versions/:version returns content', async () => {
  const content = await fetch(`${BASE}/prompts/${promptId}/versions/1`).then(r => r.text());
  assert(content.includes('helpful assistant'), 'Should return prompt content');
});

await test('POST /prompts/:id/versions adds a new version', async () => {
  const p = await post(`/prompts/${promptId}/versions`, {
    content: 'You are a helpful assistant. Be concise and accurate.',
    notes: 'Added accuracy guidance'
  }) as { currentVersion: number; versions: Array<{ version: number }> };
  assert(p.currentVersion === 2, 'Should be at version 2');
  assert(p.versions.length === 2, 'Should have 2 versions');
});

await test('GET /prompts/:id/diff returns diff', async () => {
  const result = await get(`/prompts/${promptId}/diff?v1=1&v2=2`) as { diff: string; v1: number; v2: number };
  assert(result.diff, 'Should return a diff');
  assert(result.v1 === 1 && result.v2 === 2, 'Should have correct versions');
});

// ─── Test Suites ─────────────────────────────────────────────────────────────
console.log('\n── Test Suites ──');

let suiteId = '';

await test('POST /test-suites creates a suite', async () => {
  const s = await post('/test-suites', {
    name: 'API Test Suite',
    description: 'Test cases for API testing',
    testCases: [
      { id: 'tc1', name: 'Basic question', userMessage: 'What is 2+2?' },
      { id: 'tc2', name: 'Summary request', userMessage: 'Summarize the water cycle.' }
    ]
  }) as { id: string; testCases: Array<{ id: string }> };
  assert(s.id, 'Should have an ID');
  assert(s.testCases.length === 2, 'Should have 2 test cases');
  suiteId = s.id;
});

await test('GET /test-suites/:id returns the suite', async () => {
  const s = await get(`/test-suites/${suiteId}`) as { id: string; name: string };
  assert(s.id === suiteId, 'Should return correct suite');
  assert(s.name === 'API Test Suite', 'Should have correct name');
});

await test('PUT /test-suites/:id updates the suite', async () => {
  const s = await put(`/test-suites/${suiteId}`, {
    name: 'Updated API Test Suite'
  }) as { name: string };
  assert(s.name === 'Updated API Test Suite', 'Should update name');
});

await test('DELETE /test-suites/:id removes the suite', async () => {
  const result = await del(`/test-suites/${suiteId}`) as { success: boolean };
  assert(result.success, 'Should return success');
});

// ─── Models ───────────────────────────────────────────────────────────────────
console.log('\n── Models ──');

await test('GET /models returns server data (or graceful error if LMApi offline)', async () => {
  const result = await get('/models') as { servers?: unknown[]; grouped?: Record<string, unknown>; error?: string };
  // Either returns data or a graceful error (LMApi may not be running)
  assert(
    result.servers !== undefined || result.error !== undefined,
    'Should return servers or error'
  );
});

await test('GET /models/leaderboard returns array', async () => {
  const result = await get('/models/leaderboard');
  assert(Array.isArray(result), 'Should return an array');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
