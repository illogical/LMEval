import { Router } from 'express';
import { PresetService } from '../services/PresetService';

export const presetsRouter = Router();

presetsRouter.get('/', async (req, res) => {
  const presets = await PresetService.list();
  res.json(presets);
});

presetsRouter.get('/:id', async (req, res) => {
  const preset = await PresetService.get(req.params.id);
  if (!preset) return void res.status(404).json({ error: 'Not found' });
  res.json(preset);
});

presetsRouter.post('/', async (req, res) => {
  const body = req.body;
  const preset = await PresetService.create(body);
  res.status(201).json(preset);
});

presetsRouter.patch('/:id', async (req, res) => {
  const body = req.body;
  const preset = await PresetService.update(req.params.id, body);
  if (!preset) return void res.status(404).json({ error: 'Not found' });
  res.json(preset);
});

presetsRouter.delete('/:id', async (req, res) => {
  const deleted = await PresetService.delete(req.params.id);
  if (!deleted) return void res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
