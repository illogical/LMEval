import { Hono } from 'hono';
import { PresetService } from '../services/PresetService';

export const presetsRouter = new Hono();

presetsRouter.get('/', async (c) => {
  const presets = await PresetService.list();
  return c.json(presets);
});

presetsRouter.get('/:id', async (c) => {
  const preset = await PresetService.get(c.req.param('id'));
  if (!preset) return c.json({ error: 'Not found' }, 404);
  return c.json(preset);
});

presetsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const preset = await PresetService.create(body);
  return c.json(preset, 201);
});

presetsRouter.patch('/:id', async (c) => {
  const body = await c.req.json();
  const preset = await PresetService.update(c.req.param('id'), body);
  if (!preset) return c.json({ error: 'Not found' }, 404);
  return c.json(preset);
});

presetsRouter.delete('/:id', async (c) => {
  const deleted = await PresetService.delete(c.req.param('id'));
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});
