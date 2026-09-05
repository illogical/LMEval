import { Router } from 'express';
import { JudgeQualificationService } from '../services/JudgeQualificationService';

export const judgesRouter = Router();

judgesRouter.get('/:modelId/qualification', (req, res) => {
  const record = JudgeQualificationService.get(decodeURIComponent(req.params.modelId));
  if (!record) {
    res.status(404).json({ error: 'No qualification record for this judge model' });
    return;
  }
  res.json(record);
});

judgesRouter.post('/:modelId/qualify', async (req, res) => {
  try {
    const modelId = decodeURIComponent(req.params.modelId);
    const calibrationSetId = typeof req.body?.calibrationSetId === 'string' ? req.body.calibrationSetId : undefined;
    const record = await JudgeQualificationService.qualify(modelId, calibrationSetId);
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
