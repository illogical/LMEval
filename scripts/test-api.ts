/**
 * Integration test for the eval API.
 * Run with: node scripts/test-api.ts (requires server to be running on port 3200)
 */

const BASE = 'http://localhost:3200/api/eval';

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as T;
  if (!res.ok) throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

async function assert(condition: boolean, message: string): Promise<void> {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function runTests(): Promise<void> {
  console.log('=== Eval API Integration Tests ===\n');

  // Health check
  console.log('1. Health check');
  const health = await request<{ status: string }>('GET', '/health');
  await assert(health.status === 'ok', 'server is healthy');

  // Template CRUD
  console.log('\n2. Template CRUD');
  const templates = await request<unknown[]>('GET', '/templates');
  await assert(Array.isArray(templates), 'list templates returns array');
  await assert(templates.length >= 4, 'built-in templates are present');

  const builtIn = templates.find((t: unknown) => (t as { id: string }).id === 'general-quality') as { id: string; builtIn: boolean } | undefined;
  await assert(builtIn !== undefined, 'general-quality template exists');
  await assert(builtIn!.builtIn === true, 'general-quality is marked as built-in');

  // Create custom template
  const custom = await request<{ id: string; name: string; perspectives?: unknown[] }>('POST', '/templates', {
    name: 'Test Template',
    description: 'For integration testing',
    perspectives: [
      { id: 'quality', name: 'Quality', description: 'Overall quality', weight: 1.0, criteria: 'Is it good?', scoringGuide: '1-5' }
    ],
  });
  await assert(custom.name === 'Test Template', 'custom template created');
  await assert(typeof custom.id === 'string', 'custom template has id');

  // Get template by id
  const fetched = await request<{ id: string }>('GET', `/templates/${custom.id}`);
  await assert(fetched.id === custom.id, 'can fetch template by id');

  // Update custom template
  const updated = await request<{ name: string }>('PUT', `/templates/${custom.id}`, { name: 'Updated Template', perspectives: custom.perspectives ?? [] });
  await assert(updated.name === 'Updated Template', 'custom template updated');

  // Delete custom template
  const deleted = await request<{ success: boolean }>('DELETE', `/templates/${custom.id}`);
  await assert(deleted.success === true, 'custom template deleted');

  // Reject delete built-in
  try {
    await request('DELETE', '/templates/general-quality');
    await assert(false, 'should have thrown');
  } catch {
    console.log('  ✓ cannot delete built-in template');
  }

  // Prompt CRUD
  console.log('\n3. Prompt CRUD');
  const prompt = await request<{ id: string; versions: unknown[] }>('POST', '/prompts', {
    name: 'Test Prompt',
    content: 'You are a helpful assistant.',
    description: 'Test',
  });
  await assert(typeof prompt.id === 'string', 'prompt created with id');
  await assert(prompt.versions.length === 1, 'prompt has 1 version');

  const content = await request<{ content: string; version: number }>('GET', `/prompts/${prompt.id}/content?version=1`);
  await assert(content.content === 'You are a helpful assistant.', 'can retrieve version content');

  const v2 = await request<{ versions: unknown[] }>('POST', `/prompts/${prompt.id}/versions`, {
    content: 'You are an expert assistant.',
    description: 'Improved',
  });
  await assert(v2.versions.length === 2, 'version 2 added');

  const diff = await request<{ diff: string }>('GET', `/prompts/${prompt.id}/diff?from=1&to=2`);
  await assert(typeof diff.diff === 'string', 'diff returned');
  await assert(diff.diff.includes('helpful'), 'diff contains original text');

  // Test suite CRUD
  console.log('\n4. Test Suite CRUD');
  const suite = await request<{ id: string; testCases: unknown[] }>('POST', '/test-suites', {
    name: 'Test Suite',
    description: 'For integration testing',
    testCases: [
      { userMessage: 'Hello, how are you?', description: 'Simple greeting' },
      { userMessage: 'What is 2+2?', description: 'Math question' },
    ],
  });
  await assert(typeof suite.id === 'string', 'test suite created');
  await assert(suite.testCases.length === 2, 'test suite has 2 test cases');

  const fetchedSuite = await request<{ id: string }>('GET', `/test-suites/${suite.id}`);
  await assert(fetchedSuite.id === suite.id, 'can fetch test suite by id');

  const updatedSuite = await request<{ testCases: unknown[] }>('PUT', `/test-suites/${suite.id}`, {
    testCases: [{ userMessage: 'Updated message', description: 'Updated' }],
  });
  await assert(updatedSuite.testCases.length === 1, 'test suite updated');

  const deletedSuite = await request<{ success: boolean }>('DELETE', `/test-suites/${suite.id}`);
  await assert(deletedSuite.success === true, 'test suite deleted');

  console.log('\n=== All tests passed ✓ ===\n');
}

runTests().catch(err => {
  console.error('\n✗ Tests failed:', err.message);
  process.exit(1);
});
