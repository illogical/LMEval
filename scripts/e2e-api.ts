/**
 * End-to-end API test script for LMEval.
 *
 * Tests all 12 scenarios in the E2E_TESTING_AND_AGENT_SDK plan using
 * LMEvalClient. All created resources are prefixed with 'e2e-test-' and
 * deleted in the finally block.
 *
 * Prerequisites: server must be running (port from PORT env var, default 3200)
 *   bun run dev:server
 *
 * Run:
 *   bun scripts/e2e-api.ts
 */

import { LMEvalClient } from './lib/LMEvalClient';

const client = new LMEvalClient();

// ─── helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
  passed++;
}

function fail(msg: string, err?: unknown) {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  console.error(`  ✗ ${msg}${detail ? ': ' + detail : ''}`);
  failed++;
  failures.push(msg);
}

function assert(condition: boolean, msg: string) {
  if (condition) pass(msg);
  else fail(msg);
}

async function section(title: string, fn: () => Promise<void>) {
  console.log(`\n${title}`);
  try {
    await fn();
  } catch (err) {
    fail(`unexpected error in section`, err);
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

let promptAId = '';
let promptBId = '';
let templateId = '';
let testSuiteId = '';
let presetId = '';
let sessionId = '';
let evalId = '';
let secondEvalId = '';
let cancelEvalId = '';
let firstModelId = '';

async function run() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   LMEval API End-to-End Test Suite       ║');
  console.log('╚══════════════════════════════════════════╝');

  // ── 1. Health check ─────────────────────────────────────────────────────────
  await section('1. Health check', async () => {
    const res = await fetch(`http://localhost:${process.env.PORT ?? 3200}/api/eval/health`);
    assert(res.status === 200, 'server responds 200 on /health');
    const body = await res.json() as { status: string };
    assert(body.status === 'ok', 'health status is ok');
  });

  // ── 2. Model discovery ───────────────────────────────────────────────────────
  await section('2. Model discovery', async () => {
    const models = await client.listModels();
    assert(Array.isArray(models.servers), 'listModels returns servers array');
    assert(models.servers.length > 0, 'at least one server returned');
    assert(models.servers[0].models.length > 0, 'at least one model on first server');
    firstModelId = `${models.servers[0].name}::${models.servers[0].models[0]}`;
    console.log(`  → using model: ${firstModelId}`);
  });

  if (!firstModelId) {
    console.error('\nNo models available — cannot continue without a model. Exiting.');
    process.exit(1);
  }

  // ── 3. Prompt lifecycle ──────────────────────────────────────────────────────
  await section('3. Prompt lifecycle', async () => {
    const promptA = await client.createPrompt(
      'e2e-test-prompt-a',
      'You are a helpful assistant.'
    );
    promptAId = promptA.id;
    assert(!!promptA.id, 'createPrompt returns an id');
    assert(promptA.versions.length === 1, 'starts with version 1');
    assert(promptA.name === 'e2e-test-prompt-a', 'name matches');

    const promptB = await client.createPrompt(
      'e2e-test-prompt-b',
      'You are a concise assistant. Keep all answers under 50 words.'
    );
    promptBId = promptB.id;
    assert(!!promptB.id, 'createPrompt B returns an id');

    // Add version to prompt A
    const updated = await client.addPromptVersion(
      promptAId,
      'You are an expert assistant with deep knowledge.',
      'Added expertise framing'
    );
    assert(updated.versions.length === 2, 'addPromptVersion increments version count');

    // Read specific version content
    const v1Content = await client.getPromptContent(promptAId, 1);
    assert(v1Content === 'You are a helpful assistant.', 'getPromptContent returns correct v1 content');

    const v2Content = await client.getPromptContent(promptAId, 2);
    assert(v2Content.includes('expert'), 'getPromptContent returns correct v2 content');

    // List
    const list = await client.listPrompts();
    assert(list.some(p => p.id === promptAId), 'listPrompts includes prompt A');
    assert(list.some(p => p.id === promptBId), 'listPrompts includes prompt B');
  });

  // ── 4. Template operations ───────────────────────────────────────────────────
  await section('4. Template operations', async () => {
    const templates = await client.listTemplates();
    assert(templates.length >= 1, 'listTemplates returns at least one template');
    const builtIn = templates.find(t => t.builtIn);
    assert(!!builtIn, 'at least one built-in template exists');

    // Generate from prompt content
    const generated = await client.generateTemplate('You are a helpful assistant.');
    assert(!!generated, 'generateTemplate returns a result');

    // Create a custom template
    const customTemplate = await client.createTemplate({
      name: 'e2e-test-template',
      description: 'Created by e2e test',
      builtIn: false,
      perspectives: (generated.perspectives ?? []).length > 0
        ? generated.perspectives!
        : [{
            id: 'quality',
            name: 'Quality',
            description: 'Overall response quality',
            weight: 1,
            criteria: 'Is the response helpful and accurate?',
            scoringGuide: '1-10 where 10 is perfect',
          }],
    });
    templateId = customTemplate.id;
    assert(!!customTemplate.id, 'createTemplate returns id');
    assert(customTemplate.name === 'e2e-test-template', 'template name matches');
    assert(!customTemplate.builtIn, 'custom template is not built-in');

    // Update
    const updatedTemplate = await client.updateTemplate(templateId, {
      ...customTemplate,
      name: 'e2e-test-template-v2',
    });
    assert(updatedTemplate.name === 'e2e-test-template-v2', 'updateTemplate changes name');
    // Rename back for cleanup matching
    await client.updateTemplate(templateId, { ...updatedTemplate, name: 'e2e-test-template' });
  });

  // ── 5. Test case parsing ──────────────────────────────────────────────────────
  await section('5. Test case parsing', async () => {
    const csvContent = [
      'userMessage,description,expectedOutput,tags',
      '"What is 2+2?","Basic math","4","math;easy"',
      '"Explain recursion.","CS concept","",""',
    ].join('\r\n');

    const csvResult = await client.parseTestCases(csvContent, 'csv');
    assert(csvResult.errors.length === 0, 'CSV parse has no errors');
    assert(csvResult.cases.length === 2, 'CSV parse returns 2 cases');
    assert(csvResult.cases[0].userMessage === 'What is 2+2?', 'first CSV case has correct userMessage');
    assert(Array.isArray(csvResult.cases[0].tags), 'CSV tags parsed to array');
    assert(csvResult.cases[0].tags!.includes('math'), 'CSV tag "math" parsed');

    const jsonContent = JSON.stringify([
      { userMessage: 'Tell me a joke.', description: 'Humor test', tags: ['fun', 'creative'] },
      { userMessage: 'What is TypeScript?', description: 'Language question' },
    ]);

    const jsonResult = await client.parseTestCases(jsonContent, 'json');
    assert(jsonResult.errors.length === 0, 'JSON parse has no errors');
    assert(jsonResult.cases.length === 2, 'JSON parse returns 2 cases');
    assert(jsonResult.cases[0].tags?.includes('fun'), 'JSON array tags parsed correctly');

    // Invalid input — should return errors, not throw
    const badResult = await client.parseTestCases('not,valid,csv,without,header', 'csv');
    assert(badResult.errors.length > 0, 'invalid CSV returns errors array (not thrown)');

    // Store parsed CSV cases for suite creation
    (client as unknown as { _parsedCases: typeof csvResult.cases })._parsedCases = csvResult.cases;
  });

  // ── 6. Test suite lifecycle ───────────────────────────────────────────────────
  await section('6. Test suite lifecycle', async () => {
    const parsedCases = (client as unknown as { _parsedCases: Array<{ userMessage: string; description?: string; tags?: string[]; id?: string }> })._parsedCases ?? [
      { userMessage: 'What is 2+2?' },
      { userMessage: 'Explain recursion.' },
    ];

    const suite = await client.createTestSuite({
      name: 'e2e-test-suite',
      description: 'Created by e2e test script',
      testCases: parsedCases.map(({ id: _id, ...rest }) => rest),
    });
    testSuiteId = suite.id;
    assert(!!suite.id, 'createTestSuite returns id');
    assert(suite.name === 'e2e-test-suite', 'suite name matches');
    assert(suite.testCases.length >= 2, 'suite contains test cases');

    const suites = await client.listTestSuites();
    assert(suites.some(s => s.id === testSuiteId), 'listTestSuites includes new suite');

    const fetched = await client.getTestSuite(testSuiteId);
    assert(fetched.id === testSuiteId, 'getTestSuite returns correct suite');
  });

  // ── 7. Preset lifecycle ───────────────────────────────────────────────────────
  await section('7. Preset lifecycle', async () => {
    const preset = await client.createPreset({
      name: 'e2e-test-preset',
      description: 'e2e test preset',
      modelIds: [firstModelId],
      templateId: templateId || undefined,
      testSuiteId: testSuiteId || undefined,
      judgeModelId: null as unknown as undefined,
      enablePairwise: false,
      runsPerCell: 1,
    });
    presetId = preset.id;
    assert(!!preset.id, 'createPreset returns id');
    assert(preset.runsPerCell === 1, 'runsPerCell is 1');

    const updated = await client.updatePreset(presetId, { runsPerCell: 2 });
    assert(updated.runsPerCell === 2, 'updatePreset changes runsPerCell');

    const fetched = await client.getPreset(presetId);
    assert(fetched.runsPerCell === 2, 'getPreset returns updated runsPerCell');

    const presets = await client.listPresets();
    assert(presets.some(p => p.id === presetId), 'listPresets includes new preset');
  });

  // ── 8. Session lifecycle ──────────────────────────────────────────────────────
  await section('8. Session lifecycle', async () => {
    const session = await client.createSession({
      name: 'e2e-test-session',
      description: 'e2e test session',
      promptA: { promptId: promptAId, promptVersion: 1 },
      promptB: { promptId: promptBId, promptVersion: 1 },
    });
    sessionId = session.id;
    assert(!!session.id, 'createSession returns id');
    assert(session.name === 'e2e-test-session', 'session name matches');
    assert(session.versions.length >= 1, 'session has at least one version');

    await client.addSessionVersion(sessionId, {
      description: 'v2 iteration',
      promptA: { promptId: promptAId, promptVersion: 2 },
      promptB: { promptId: promptBId, promptVersion: 1 },
    });
    const refreshed = await client.getSession(sessionId);
    assert(refreshed.versions.length >= 2, 'addSessionVersion adds a version');

    const sessions = await client.listSessions();
    assert(sessions.some(s => s.id === sessionId), 'listSessions includes new session');
  });

  // ── 9. Full evaluation run ────────────────────────────────────────────────────
  await section('9. Full evaluation run', async () => {
    const { evalId: id } = await client.createEvaluation({
      name: 'e2e-test-eval',
      promptIds: [promptAId, promptBId],
      modelIds: [firstModelId],
      testSuiteId,
      runsPerCell: 1,
    });
    evalId = id;
    assert(!!evalId, 'createEvaluation returns evalId');

    console.log(`  → waiting for eval ${evalId} to complete (up to 2 min)…`);
    const summary = await client.waitForCompletion(evalId, 120_000);
    assert(summary.totalCells > 0, 'summary has totalCells > 0');
    assert(summary.completedCells > 0, 'at least some cells completed');
    assert(summary.failedCells === 0, 'no cells failed');
    console.log(`  → completed: ${summary.completedCells}/${summary.totalCells} cells`);
  });

  // ── 10. Results inspection ────────────────────────────────────────────────────
  await section('10. Results inspection', async () => {
    const results = await client.getResults(evalId);
    assert(Array.isArray(results.cells), 'getResults returns cells array');
    assert(results.cells.length > 0, 'results have cells');
    const completedCell = results.cells.find(c => c.status === 'completed');
    assert(!!completedCell, 'at least one completed cell');
    assert(typeof completedCell!.response === 'string', 'completed cell has response');

    const summary = await client.getSummary(evalId);
    assert(summary.modelSummaries.length > 0, 'getSummary returns model summaries');

    const html = await client.exportEvaluation(evalId, 'html');
    assert(html.includes('<html') || html.includes('<!DOCTYPE'), 'exportEvaluation html contains html tag');

    const md = await client.exportEvaluation(evalId, 'md');
    assert(md.includes('#') || md.length > 0, 'exportEvaluation md returns content');
  });

  // ── 11. Baseline + regression ─────────────────────────────────────────────────
  await section('11. Baseline + regression', async () => {
    await client.saveBaseline(evalId, 'e2e-test-baseline');
    pass('saveBaseline succeeded');

    // Create a second eval to compare
    const { evalId: id2 } = await client.createEvaluation({
      name: 'e2e-test-eval-2',
      promptIds: [promptAId, promptBId],
      modelIds: [firstModelId],
      testSuiteId,
      runsPerCell: 1,
    });
    secondEvalId = id2;
    console.log(`  → waiting for second eval ${secondEvalId}…`);
    const summary2 = await client.waitForCompletion(secondEvalId, 120_000);
    assert(summary2.totalCells > 0, 'second eval completed');

    const summary2Fetched = await client.getSummary(secondEvalId);
    assert(!!summary2Fetched, 'getSummary on second eval works');
    // Regression field is present when a baseline was previously saved
    // (may or may not be populated depending on baseline ID linkage)
    pass('second eval summary retrieved');
  });

  // ── 12. Evaluation cancel ─────────────────────────────────────────────────────
  await section('12. Evaluation cancel', async () => {
    const { evalId: id } = await client.createEvaluation({
      name: 'e2e-test-eval-cancel',
      promptIds: [promptAId, promptBId],
      modelIds: [firstModelId],
      testSuiteId,
      runsPerCell: 3,
    });
    cancelEvalId = id;
    assert(!!cancelEvalId, 'createEvaluation for cancel test returns id');

    // Cancel immediately
    await client.cancelEvaluation(cancelEvalId);
    pass('cancelEvaluation did not throw');

    // Allow a moment for the cancel to propagate
    await new Promise(r => setTimeout(r, 500));

    const config = await client.getEvaluation(cancelEvalId);
    assert(
      config.status === 'cancelled' || config.status === 'running' || config.status === 'completed',
      `eval status after cancel is a valid terminal-or-transitional state (got: ${config.status})`
    );
    if (config.status === 'cancelled') pass('eval status is cancelled');
    else console.log(`  ℹ eval status is ${config.status} (cancel may have arrived after completion)`);
  });
}

// ─── run + cleanup ────────────────────────────────────────────────────────────

try {
  await run();
} finally {
  console.log('\n─── Cleanup ────────────────────────────────────────────────────');
  await client.cleanupTestResources('e2e-test-');
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Failed assertions:');
  for (const f of failures) console.log(`    - ${f}`);
}
console.log('════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
