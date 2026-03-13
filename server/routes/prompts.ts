import { Hono } from 'hono';
import { PromptService } from '../services/PromptService.ts';
import { FileService } from '../services/FileService.ts';
import { join } from 'path';
import type { EvaluationConfig, EvaluationSummary } from '../../src/types/eval.ts';

const prompts = new Hono();

prompts.get('/', (c) => {
  try {
    return c.json(PromptService.list());
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

prompts.get('/:id', (c) => {
  const manifest = PromptService.get(c.req.param('id'));
  if (!manifest) return c.json({ error: 'Prompt not found' }, 404);
  return c.json(manifest);
});

prompts.get('/:id/versions/:version', (c) => {
  const content = PromptService.getVersionContent(
    c.req.param('id'),
    parseInt(c.req.param('version'))
  );
  if (content === null) return c.json({ error: 'Version not found' }, 404);
  return c.text(content);
});

prompts.post('/', async (c) => {
  try {
    const body = await c.req.json() as { name: string; content: string; description?: string; notes?: string };
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    if (!body.content) return c.json({ error: 'content is required' }, 400);
    const manifest = PromptService.create(body);
    return c.json(manifest, 201);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

prompts.post('/:id/versions', async (c) => {
  try {
    const body = await c.req.json() as { content: string; notes?: string };
    if (!body.content) return c.json({ error: 'content is required' }, 400);
    const manifest = PromptService.addVersion(c.req.param('id'), body);
    return c.json(manifest, 201);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

prompts.get('/:id/diff', (c) => {
  const v1 = parseInt(c.req.query('v1') ?? '1');
  const v2 = parseInt(c.req.query('v2') ?? '2');
  try {
    const diff = PromptService.diff(c.req.param('id'), v1, v2);
    return c.json({ diff, v1, v2 });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

prompts.put('/:id/tools', async (c) => {
  try {
    const body = await c.req.json();
    const tools = Array.isArray(body) ? body : body.tools;
    if (!Array.isArray(tools)) return c.json({ error: 'Expected array of tool definitions' }, 400);
    const manifest = PromptService.updateTools(c.req.param('id'), tools);
    return c.json(manifest);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

prompts.get('/:id/history', (c) => {
  try {
    const promptId = c.req.param('id');
    const manifest = PromptService.get(promptId);
    if (!manifest) return c.json({ error: 'Prompt not found' }, 404);

    const evalsDir = join(FileService.evalsDir(), 'evaluations');
    const evalDirs = FileService.listDirs(evalsDir);

    const history: Array<{ evalId: string; date: string; modelScores: Record<string, number>; promptScore: number }> = [];

    for (const evalDir of evalDirs) {
      const config = FileService.readJson<EvaluationConfig>(join(evalDir, 'config.json'));
      if (!config || !config.promptVersions.some(pv => pv.promptId === promptId)) continue;
      if (config.status !== 'completed') continue;

      const summary = FileService.readJson<EvaluationSummary>(join(evalDir, 'summary.json'));
      if (!summary) continue;

      const modelScores: Record<string, number> = {};
      for (const mr of summary.modelRankings) {
        modelScores[mr.modelId] = mr.compositeScore;
      }

      const promptRank = summary.promptRankings.find(pr => pr.promptId === promptId);

      history.push({
        evalId: config.id,
        date: config.completedAt ?? config.createdAt,
        modelScores,
        promptScore: promptRank?.compositeScore ?? 0
      });
    }

    history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return c.json(history);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

export default prompts;
