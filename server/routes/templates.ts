import { Hono } from 'hono';
import { TemplateService } from '../services/TemplateService.ts';
import { LmapiClient } from '../services/LmapiClient.ts';
import { JudgeService } from '../services/JudgeService.ts';

const templates = new Hono();

templates.get('/', (c) => {
  try {
    const list = TemplateService.list();
    return c.json(list);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

templates.get('/:id', (c) => {
  const id = c.req.param('id');
  const template = TemplateService.get(id);
  if (!template) return c.json({ error: 'Template not found' }, 404);
  return c.json(template);
});

templates.post('/', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const template = TemplateService.create(body);
    return c.json(template, 201);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

templates.put('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json();
    const template = TemplateService.update(id, body);
    return c.json(template);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('built-in')) return c.json({ error: msg }, 403);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

templates.delete('/:id', (c) => {
  const id = c.req.param('id');
  try {
    TemplateService.delete(id);
    return c.json({ success: true });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('built-in')) return c.json({ error: msg }, 403);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

templates.post('/generate', async (c) => {
  try {
    const body = await c.req.json() as { promptContent: string; tools?: unknown[]; model?: string };
    if (!body.promptContent) return c.json({ error: 'promptContent is required' }, 400);

    // Get available models to pick the most capable one
    let model = body.model;
    if (!model) {
      try {
        const models = await LmapiClient.getModels();
        model = models[0] ?? '';
      } catch {
        model = '';
      }
    }

    if (!model) return c.json({ error: 'No models available' }, 503);

    const messages = JudgeService.buildTemplateGeneratorPrompt(body.promptContent, body.tools as never);
    const response = await LmapiClient.chatCompletion({ model, messages, stream: false });
    const raw = response.choices?.[0]?.message?.content ?? '';
    const parsed = JudgeService.parseTemplateGeneratorResponse(raw);

    if (!parsed) return c.json({ error: 'Failed to parse generated template', raw }, 422);
    return c.json(parsed);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

export default templates;
