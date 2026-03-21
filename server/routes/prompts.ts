import { Hono } from 'hono';
import { PromptService } from '../services/PromptService';

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
  const body = await c.req.json();
  if (!body.name || !body.content) {
    return c.json({ error: 'name and content are required' }, 400);
  }
  const prompt = PromptService.create(body);
  return c.json(prompt, 201);
});

promptsRouter.post('/:id/versions', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  if (!body.content) return c.json({ error: 'content is required' }, 400);
  const updated = PromptService.addVersion(id, body.content, body.description);
  if (!updated) return c.json({ error: 'Prompt not found' }, 404);
  return c.json(updated, 201);
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
