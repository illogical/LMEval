import { Hono } from 'hono';
import { join } from 'path';
import { PromptService } from '../services/PromptService';
import { readJson, ensureDir, listDir, EVALUATIONS_DIR } from '../services/FileService';
import type { EvaluationConfig, EvaluationSummary } from '../../src/types/eval';

export const promptsRouter = new Hono();

promptsRouter.get('/', c => {
  return c.json(PromptService.list());
});

promptsRouter.get('/:id', c => {
  const { id } = c.req.param();
  const prompt = PromptService.get(id);
  if (!prompt) return c.json({ error: 'Prompt not found' }, 404);
  return c.json(prompt);
});

promptsRouter.get('/:id/content', c => {
  const { id } = c.req.param();
  const version = Number(c.req.query('version') ?? '1');
  const content = PromptService.getVersionContent(id, version);
  if (content === null) return c.json({ error: 'Version not found' }, 404);
  return c.json({ content, version });
});

promptsRouter.post('/', async c => {
  try {
    const body = await c.req.json();
    if (!body.name || !body.content) {
      return c.json({ error: 'name and content are required' }, 400);
    }
    const prompt = PromptService.create(body);
    return c.json(prompt, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message || 'Failed to create prompt' }, 500);
  }
});

promptsRouter.post('/:id/versions', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  if (!body.content) return c.json({ error: 'content is required' }, 400);
  try {
    const updated = PromptService.addVersion(id, body.content, body.description);
    if (!updated) return c.json({ error: 'Prompt not found' }, 404);
    return c.json(updated, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

promptsRouter.get('/:id/diff', c => {
  const { id } = c.req.param();
  const vA = Number(c.req.query('from') ?? '1');
  const vB = Number(c.req.query('to') ?? '2');
  const diff = PromptService.diff(id, vA, vB);
  if (diff === null) return c.json({ error: 'Version not found' }, 404);
  return c.json({ diff, from: vA, to: vB });
});

promptsRouter.put('/:id/tools', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const updated = PromptService.updateTools(id, body.tools ?? []);
  if (!updated) return c.json({ error: 'Prompt not found' }, 404);
  return c.json(updated);
});

promptsRouter.get('/:id/history', c => {
  const { id } = c.req.param();

  ensureDir(EVALUATIONS_DIR);
  const history: Array<{
    evalId: string;
    date: string;
    modelScores: Record<string, number>;
    promptScore?: number;
  }> = [];

  for (const evalId of listDir(EVALUATIONS_DIR)) {
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    if (!config || !config.promptIds.includes(id)) continue;
    if (config.status !== 'completed') continue;

    const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
    if (!summary) continue;

    const modelScores: Record<string, number> = {};
    for (const m of summary.modelSummaries) {
      if (m.avgCompositeScore != null) modelScores[m.modelId] = m.avgCompositeScore;
    }

    const promptSummary = summary.promptSummaries.find(p => p.promptId === id);

    history.push({
      evalId,
      date: summary.completedAt ?? config.createdAt,
      modelScores,
      promptScore: promptSummary?.avgCompositeScore,
    });
  }

  history.sort((a, b) => b.date.localeCompare(a.date));
  return c.json(history);
});
