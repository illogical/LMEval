import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { LMEvalClient } from './lib/LMEvalClient';
import type { EvalPurposeTemplate, EvaluationInput, TestCase } from '../src/types/eval';

const args = new Map(process.argv.slice(2).map(arg => {
  const separator = arg.indexOf('=');
  return separator === -1
    ? [arg.replace(/^--/, ''), 'true']
    : [arg.slice(0, separator).replace(/^--/, ''), arg.slice(separator + 1)];
}));
const taskArg = args.get('task') ?? 'all';
const requestedTasks = taskArg === 'all' ? ['classification', 'tagging', 'summarization'] : [taskArg];
const allowedTasks = new Set(['classification', 'tagging', 'summarization']);
for (const task of requestedTasks) if (!allowedTasks.has(task)) throw new Error(`Unsupported task: ${task}`);

const baseUrl = args.get('base-url');
const client = new LMEvalClient(baseUrl);
const taskDefaults: Record<string, { caseLimit: number; maxTokens: number }> = {
  classification: { caseLimit: 8, maxTokens: 50 },
  tagging: { caseLimit: 3, maxTokens: 100 },
  summarization: { caseLimit: 3, maxTokens: 150 },
};

function positiveInteger(name: string, fallback: number): number {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function selectCases(task: string, source: TestCase[], limit: number): TestCase[] {
  const calibration = source.filter(testCase => testCase.caseTags?.includes('split:calibration'));
  if (task !== 'classification' || limit < 8) return calibration.slice(0, limit);

  const labels = ['Preference', 'Reminder', 'Snippet', 'Event', 'Note', 'Prompt', 'Idea', 'History'];
  const desiredShapes = ['boundary', 'noisy', 'clear', 'boundary', 'noisy', 'clear', 'boundary', 'noisy'];
  const selected = labels.map((label, index) => {
    const candidates = calibration.filter(testCase => testCase.expectedOutput === label);
    return candidates.find(testCase => testCase.caseTags?.includes(`shape:${desiredShapes[index]}`)) ?? candidates[0];
  }).filter((testCase): testCase is TestCase => !!testCase);
  if (selected.length !== labels.length) throw new Error('Classification calibration data does not cover all eight labels');
  return selected.concat(calibration.filter(testCase => !selected.some(item => item.id === testCase.id))).slice(0, limit);
}

async function findExactPrompt(content: string, task: string, explicitId?: string, explicitVersion?: number) {
  const manifests = await client.listPrompts();
  const candidates = explicitId ? manifests.filter(prompt => prompt.id === explicitId) : manifests;
  if (explicitId && candidates.length === 0) throw new Error(`Prompt not found: ${explicitId}`);
  for (const prompt of candidates) {
    const versions = explicitVersion == null
      ? [...prompt.versions].sort((a, b) => b.version - a.version)
      : prompt.versions.filter(version => version.version === explicitVersion);
    for (const version of versions) {
      if (await client.getPromptContent(prompt.id, version.version) === content) return { prompt, version: version.version, reused: true };
    }
  }
  if (explicitId) throw new Error(`Prompt ${explicitId} does not contain an exact-content matching version`);
  const prompt = await client.createPrompt(`memoryapi-${task}-${sha256(content).slice(0, 12)}`, content);
  return { prompt, version: 1, reused: false };
}

async function waitForTerminal(evalId: string) {
  const deadline = Date.now() + positiveInteger('timeout-minutes', 20) * 60_000;
  while (Date.now() < deadline) {
    const feedback = await client.getFeedback(evalId);
    console.log(`${evalId}: ${feedback.status} ${feedback.progress.completed}/${feedback.progress.total}`);
    if (['completed', 'failed', 'cancelled'].includes(feedback.status)) return feedback;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2000));
  }
  throw new Error(`Timed out waiting for ${evalId}`);
}

function resolveModels(discovered: string[]): string[] {
  const requested = (args.get('models') ?? args.get('model'))?.split(',').map(value => value.trim()).filter(Boolean);
  const models = requested?.length ? requested : discovered.slice(0, 1);
  if (models.length === 0) throw new Error('No model is available. Supply --models=server::model[,server::model].');
  const missing = models.filter(model => !discovered.includes(model));
  if (missing.length) throw new Error(`Requested models are unavailable: ${missing.join(', ')}`);
  return models;
}

async function resolvePrompt(template: EvalPurposeTemplate, task: string) {
  const content = template.seedPromptContent ?? 'Follow the task contract exactly.';
  const explicitVersion = args.has('prompt-version') ? positiveInteger('prompt-version', 1) : undefined;
  const result = await findExactPrompt(content, task, args.get('prompt-id'), explicitVersion);
  return { ...result, content, contentSha256: sha256(content) };
}

async function main() {
  const [catalog, templates, suites, existingPrompts, existingEvaluations] = await Promise.all([
    client.listModels(), client.listPurposeTemplates(), client.listTestSuites(), client.listPrompts(), client.listEvaluations(),
  ]);
  const discovered = catalog.servers.flatMap(server => server.models.map(model => `${server.name}::${model}`));
  const models = resolveModels(discovered);
  const judgeModelId = args.get('judge');
  if (judgeModelId && !discovered.includes(judgeModelId)) throw new Error(`Requested judge is unavailable: ${judgeModelId}`);
  const evidence: unknown[] = [];
  console.log(JSON.stringify({ discovery: { catalog, templates: templates.map(t => t.id), suites: suites.map(s => s.id), promptCount: existingPrompts.length, evaluationCount: existingEvaluations.length } }, null, 2));

  for (const task of requestedTasks) {
    const template = templates.find(candidate => candidate.purposeCategory === task && candidate.builtIn);
    if (!template) throw new Error(`Built-in purpose template not found for ${task}`);
    if (task === 'summarization' && !judgeModelId) throw new Error('Summarization requires --judge=server::model for this workflow.');
    if (task === 'summarization' && judgeModelId && models.includes(judgeModelId)) throw new Error('The judge must differ from every candidate model.');

    const suite = template.defaultTestSuiteId ? await client.getTestSuite(template.defaultTestSuiteId) : null;
    const caseLimit = positiveInteger('case-limit', taskDefaults[task].caseLimit);
    const cases = selectCases(task, suite?.testCases ?? template.starterTestCases, caseLimit);
    if (cases.some(testCase => testCase.caseTags?.includes('split:regression'))) throw new Error('Regression cases must not be exposed by this smoke workflow');
    const prompt = await resolvePrompt(template, task);
    const runsPerCell = positiveInteger('runs', task === 'classification' ? 3 : 1);
    const maxTokens = positiveInteger('max-tokens', taskDefaults[task].maxTokens);
    const expectedCalls = models.length * cases.length * runsPerCell;
    const templateId = task === 'summarization' && template.assertionStrategy.type === 'grounded-summary'
      ? template.assertionStrategy.config.templateId
      : undefined;
    const input: EvaluationInput = {
      name: `Agent workflow ${task} verification ${new Date().toISOString()}`,
      promptIds: [prompt.prompt.id],
      promptVersions: [{ promptId: prompt.prompt.id, version: prompt.version }],
      modelIds: models,
      comparisonMode: models.length > 1 ? 'model' : 'matrix',
      purposeTemplateId: template.id,
      templateId,
      inlineTestCases: cases,
      judgeModelId: task === 'summarization' ? judgeModelId : undefined,
      inference: { temperature: Number(args.get('temperature') ?? 0.3), maxTokens },
      runsPerCell,
    };
    console.log(JSON.stringify({ task, promptId: prompt.prompt.id, promptVersion: prompt.version, promptReused: prompt.reused, models, inference: input.inference, runsPerCell, caseIds: cases.map(item => item.id), expectedCalls }, null, 2));

    const validation = await client.validateEvaluation(input);
    if (!validation.valid) throw new Error(`${task} validation failed: ${JSON.stringify(validation.errors)}`);
    const draft = await client.createEvaluationDraft(input);
    const readBack = await client.getEvaluation(draft.evaluation.id);
    for (const field of ['promptIds', 'promptVersions', 'modelIds', 'comparisonMode', 'purposeTemplateId', 'inlineTestCases', 'inference', 'runsPerCell'] as const) {
      if (JSON.stringify(readBack[field]) !== JSON.stringify(input[field])) throw new Error(`${task} draft readback mismatch for ${field}`);
    }
    console.log(`${task} draft: ${draft.evaluation.id} ${draft.browserPaths.config}`);

    await client.startEvaluationDraft(draft.evaluation.id);
    const feedback = await waitForTerminal(draft.evaluation.id);
    if (feedback.status !== 'completed') throw new Error(`${task} workflow ended as ${feedback.status}`);
    const [results, summary, resolvedTestCases, markdownExport] = await Promise.all([
      client.getResults(draft.evaluation.id), client.getSummary(draft.evaluation.id),
      client.getResolvedTestCases(draft.evaluation.id), client.exportEvaluation(draft.evaluation.id, 'md'),
    ]);
    if (results.length !== expectedCalls) throw new Error(`${task} produced ${results.length} cells; expected ${expectedCalls}`);
    if (summary.totalCells !== expectedCalls || summary.failedCells !== 0) throw new Error(`${task} summary reports ${summary.totalCells} cells and ${summary.failedCells} failures`);
    if (resolvedTestCases.length !== cases.length) throw new Error(`${task} persisted ${resolvedTestCases.length} cases; expected ${cases.length}`);
    for (const cell of results) {
      if (cell.request?.systemPrompt !== prompt.content) throw new Error(`${task} cell ${cell.id} did not use the pinned prompt content`);
      if (!cell.request?.userMessage.match(/^<memory>\n[\s\S]*\n<\/memory>$/)) throw new Error(`${task} cell ${cell.id} lost the production memory wrapper`);
      if (!models.includes(cell.modelId)) throw new Error(`${task} cell ${cell.id} used an undeclared model`);
      if (!cell.finishReason) throw new Error(`${task} cell ${cell.id} did not persist finishReason`);
    }
    if (summary.resolvedInference?.temperature !== input.inference?.temperature || summary.resolvedInference?.maxTokens !== maxTokens) {
      throw new Error(`${task} resolved inference does not match the requested production settings`);
    }
    if (summary.transportProvenance?.messageShape !== 'chat-messages') throw new Error(`${task} did not persist chat-message transport provenance`);

    evidence.push({
      task,
      mechanicsOnly: true,
      limitations: [
        'Bounded calibration smoke; not stable quality or promotion evidence.',
        'Regression cases were not exposed.',
        suite?.provenance?.reviewStatus === 'pending-human-review' ? 'The source benchmark remains pending human review.' : undefined,
      ].filter(Boolean),
      evalId: draft.evaluation.id,
      prompt: { id: prompt.prompt.id, version: prompt.version, sha256: prompt.contentSha256, reused: prompt.reused },
      models,
      judgeModelId: task === 'summarization' ? judgeModelId : undefined,
      caseIds: cases.map(item => item.id),
      runsPerCell,
      candidateCallCount: expectedCalls,
      inference: input.inference,
      validation,
      browserPaths: feedback.browserPaths,
      feedback,
      rawResults: results.map(cell => ({ id: cell.id, modelId: cell.modelId, testCaseId: cell.testCaseId, run: cell.run, status: cell.status, response: cell.response, finishReason: cell.finishReason, assertionResults: cell.assertionResults, error: cell.error })),
      summary,
      export: { format: 'md', sha256: sha256(markdownExport), bytes: Buffer.byteLength(markdownExport) },
    });
  }

  const output = { generatedAt: new Date().toISOString(), baseUrl: baseUrl ?? `http://localhost:${process.env.PORT ?? 3200}/api/eval`, evidence };
  const evidencePath = args.get('evidence');
  if (evidencePath) {
    const absolutePath = resolve(evidencePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(`Evidence written to ${absolutePath}`);
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
