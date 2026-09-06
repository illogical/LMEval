import { LMEvalClient } from './lib/LMEvalClient';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2);
  return [key, value];
}));
const taskArg = args.get('task') ?? 'all';
const requestedTasks = taskArg === 'all' ? ['classification', 'tagging', 'summarization'] : [taskArg];
const baseUrl = args.get('base-url');
const client = new LMEvalClient(baseUrl);

async function waitForTerminal(evalId: string) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const feedback = await client.getFeedback(evalId);
    console.log(`${evalId}: ${feedback.status} ${feedback.progress.completed}/${feedback.progress.total}`);
    if (['completed', 'failed', 'cancelled'].includes(feedback.status)) return feedback;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${evalId}`);
}

async function main() {
  const catalog = await client.listModels();
  const discovered = catalog.servers.flatMap(server => server.models.map(model => `${server.name}::${model}`));
  const modelId = args.get('model') ?? discovered[0];
  if (!modelId) throw new Error('No model is available. Supply --model=server::model after starting LMApi.');
  const judgeModelId = args.get('judge');
  const templates = await client.listPurposeTemplates();

  for (const task of requestedTasks) {
    const template = templates.find(candidate => candidate.purposeCategory === task && candidate.builtIn);
    if (!template) throw new Error(`Built-in purpose template not found for ${task}`);
    if (task === 'summarization' && !judgeModelId) throw new Error('Summarization requires --judge=server::model for this smoke workflow.');
    if (task === 'summarization' && judgeModelId === modelId) throw new Error('The judge must differ from the candidate model.');

    const suite = template.defaultTestSuiteId ? await client.getTestSuite(template.defaultTestSuiteId) : null;
    const cases = (suite?.testCases ?? template.starterTestCases)
      .filter(testCase => !testCase.caseTags?.includes('split:regression'))
      .slice(0, 3);
    const prompt = await client.createPrompt(`agent-smoke-${task}-${Date.now()}`, template.seedPromptContent ?? 'Follow the task contract exactly.');
    const templateId = task === 'summarization' && template.assertionStrategy.type === 'grounded-summary'
      ? template.assertionStrategy.config.templateId
      : undefined;
    const input = {
      name: `Agent workflow ${task} smoke ${new Date().toISOString()}`,
      promptIds: [prompt.id],
      promptVersions: [{ promptId: prompt.id, version: 1 }],
      modelIds: [modelId],
      comparisonMode: 'matrix' as const,
      purposeTemplateId: template.id,
      templateId,
      inlineTestCases: cases,
      judgeModelId: task === 'summarization' ? judgeModelId : undefined,
      inference: { temperature: 0.3, maxTokens: 1000 },
      runsPerCell: 1,
    };
    const validation = await client.validateEvaluation(input);
    if (!validation.valid) throw new Error(`${task} validation failed: ${JSON.stringify(validation.errors)}`);
    const draft = await client.createEvaluationDraft(input);
    console.log(`${task} draft: ${draft.evaluation.id} ${draft.browserPaths.config}`);
    await client.startEvaluationDraft(draft.evaluation.id);
    const feedback = await waitForTerminal(draft.evaluation.id);
    console.log(JSON.stringify({ task, evalId: draft.evaluation.id, feedback }, null, 2));
    if (feedback.status !== 'completed') throw new Error(`${task} smoke ended as ${feedback.status}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
