import { Router } from 'express';
import { PurposeTemplateService } from '../services/PurposeTemplateService';

export const purposeTemplatesRouter = Router();

purposeTemplatesRouter.get('/', (req, res) => {
  res.json(PurposeTemplateService.list());
});

purposeTemplatesRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const template = PurposeTemplateService.get(id);
  if (!template) return void res.status(404).json({ error: 'Purpose template not found' });
  res.json(template);
});

purposeTemplatesRouter.post('/', (req, res) => {
  const body = req.body;
  if (!body.name || !body.assertionStrategy) {
    return void res.status(400).json({ error: 'name and assertionStrategy are required' });
  }
  const template = PurposeTemplateService.create({
    name: body.name,
    description: body.description ?? '',
    purposeCategory: 'custom',
    seedPromptContent: body.seedPromptContent,
    defaultComparisonMode: body.defaultComparisonMode ?? 'prompt',
    assertionStrategy: body.assertionStrategy,
    starterTestCases: body.starterTestCases ?? [],
  });
  res.status(201).json(template);
});

purposeTemplatesRouter.put('/:id', (req, res) => {
  const { id } = req.params;
  try {
    const updated = PurposeTemplateService.update(id, req.body);
    if (!updated) return void res.status(404).json({ error: 'Purpose template not found' });
    res.json(updated);
  } catch (err) {
    res.status(403).json({ error: (err as Error).message });
  }
});

purposeTemplatesRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  try {
    const deleted = PurposeTemplateService.delete(id);
    if (!deleted) return void res.status(404).json({ error: 'Purpose template not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(403).json({ error: (err as Error).message });
  }
});
