import { Hono } from 'hono';
import { TemplateService } from '../services/TemplateService';

export const templatesRouter = new Hono();

templatesRouter.get('/', c => {
  const templates = TemplateService.list();
  return c.json(templates);
});

templatesRouter.get('/:id', c => {
  const { id } = c.req.param();
  const template = TemplateService.get(id);
  if (!template) return c.json({ error: 'Template not found' }, 404);
  return c.json(template);
});

templatesRouter.post('/', async c => {
  const body = await c.req.json();
  if (!body.name || !body.perspectives) {
    return c.json({ error: 'name and perspectives are required' }, 400);
  }
  const template = TemplateService.create(body);
  return c.json(template, 201);
});

templatesRouter.put('/:id', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  try {
    const updated = TemplateService.update(id, body);
    if (!updated) return c.json({ error: 'Template not found' }, 404);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 403);
  }
});

templatesRouter.delete('/:id', c => {
  const { id } = c.req.param();
  try {
    const deleted = TemplateService.delete(id);
    if (!deleted) return c.json({ error: 'Template not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 403);
  }
});
