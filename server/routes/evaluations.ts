import { Hono } from 'hono';
import { join } from 'path';
import { FileService } from '../services/FileService.ts';
import { ExecutionService } from '../services/ExecutionService.ts';
import { ReportService } from '../services/ReportService.ts';
import type { EvaluationConfig, EvaluationResults, EvaluationSummary } from '../../src/types/eval.ts';

const evaluations = new Hono();

evaluations.get('/', (c) => {
  try {
    const status = c.req.query('status');
    const promptId = c.req.query('promptId');
    const modelId = c.req.query('modelId');

    const evalsDir = join(FileService.evalsDir(), 'evaluations');
    FileService.ensureDir(evalsDir);
    const evalDirs = FileService.listDirs(evalsDir);

    let configs = evalDirs
      .map(d => FileService.readJson<EvaluationConfig>(join(d, 'config.json')))
      .filter((c): c is EvaluationConfig => c !== null);

    if (status) configs = configs.filter(c => c.status === status);
    if (promptId) configs = configs.filter(c => c.promptVersions.some(pv => pv.promptId === promptId));
    if (modelId) configs = configs.filter(c => c.models.includes(modelId));

    configs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json(configs);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

evaluations.get('/:id', (c) => {
  const evalDir = join(FileService.evalsDir(), 'evaluations', c.req.param('id'));
  const config = FileService.readJson<EvaluationConfig>(join(evalDir, 'config.json'));
  if (!config) return c.json({ error: 'Evaluation not found' }, 404);
  return c.json(config);
});

evaluations.get('/:id/results', (c) => {
  const evalDir = join(FileService.evalsDir(), 'evaluations', c.req.param('id'));
  const results = FileService.readJson<EvaluationResults>(join(evalDir, 'results.json'));
  if (!results) return c.json({ error: 'Results not found' }, 404);
  return c.json(results);
});

evaluations.get('/:id/summary', (c) => {
  const evalDir = join(FileService.evalsDir(), 'evaluations', c.req.param('id'));
  const summary = FileService.readJson<EvaluationSummary>(join(evalDir, 'summary.json'));
  if (!summary) return c.json({ error: 'Summary not found' }, 404);
  return c.json(summary);
});

evaluations.post('/', async (c) => {
  try {
    const body = await c.req.json() as Partial<EvaluationConfig>;
    if (!body.templateId) return c.json({ error: 'templateId is required' }, 400);
    if (!body.models || body.models.length === 0) return c.json({ error: 'At least one model is required' }, 400);
    if (!body.promptVersions || body.promptVersions.length === 0) return c.json({ error: 'At least one promptVersion is required' }, 400);

    const id = FileService.generateId();
    const now = new Date().toISOString();
    const config: EvaluationConfig = {
      id,
      name: body.name ?? `Eval ${new Date().toLocaleDateString()}`,
      templateId: body.templateId,
      promptVersions: body.promptVersions,
      models: body.models,
      testSuiteId: body.testSuiteId,
      inlineTestCases: body.inlineTestCases,
      judgeConfig: body.judgeConfig ?? { enabled: false, model: '', perspectives: [], pairwiseComparison: false, runsPerCombination: 1 },
      toolDefinitions: body.toolDefinitions,
      createdAt: now,
      status: 'pending',
      baselineId: body.baselineId
    };

    const evalDir = join(FileService.evalsDir(), 'evaluations', id);
    FileService.ensureDir(evalDir);
    FileService.writeJson(join(evalDir, 'config.json'), config);

    // Start execution asynchronously
    ExecutionService.run(id).catch(e => {
      console.error(`[evaluations] Execution failed for ${id}:`, e);
    });

    return c.json(config, 202);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

evaluations.post('/:id/cancel', (c) => {
  const id = c.req.param('id');
  const cancelled = ExecutionService.cancel(id);
  if (!cancelled) {
    return c.json({ error: 'Evaluation not running or not found' }, 404);
  }
  return c.json({ success: true, message: 'Cancellation requested' });
});

evaluations.get('/:id/export', (c) => {
  const id = c.req.param('id');
  const format = c.req.query('format') ?? 'md';

  try {
    if (format === 'html') {
      const html = ReportService.generateHtml(id);
      c.header('Content-Type', 'text/html');
      c.header('Content-Disposition', `attachment; filename="eval-${id}.html"`);
      return c.body(html);
    } else {
      const md = ReportService.generateMarkdown(id);
      c.header('Content-Type', 'text/markdown');
      c.header('Content-Disposition', `attachment; filename="eval-${id}.md"`);
      return c.body(md);
    }
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

evaluations.post('/:id/baseline', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json() as { slug: string };
    if (!body.slug) return c.json({ error: 'slug is required' }, 400);

    const evalDir = join(FileService.evalsDir(), 'evaluations', id);
    const summary = FileService.readJson<EvaluationSummary>(join(evalDir, 'summary.json'));
    if (!summary) return c.json({ error: 'Summary not found - run evaluation first' }, 404);

    const baselinePath = join(FileService.evalsDir(), 'baselines', `${body.slug}.json`);
    FileService.ensureDir(join(FileService.evalsDir(), 'baselines'));
    FileService.writeJson(baselinePath, { evalId: id, slug: body.slug, summary, savedAt: new Date().toISOString() });

    return c.json({ success: true, slug: body.slug });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

export default evaluations;
