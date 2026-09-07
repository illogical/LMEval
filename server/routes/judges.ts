import { Router } from 'express';
import { JudgeQualificationService } from '../services/JudgeQualificationService';

export const judgesRouter = Router();

judgesRouter.get('/:modelId/qualification-status', (req, res) => res.json(JudgeQualificationService.status(req.params.modelId)));
judgesRouter.post('/:modelId/qualification-runs', (req, res) => {
  try { res.status(202).json(JudgeQualificationService.startRun(req.params.modelId, req.body?.calibrationSetId)); }
  catch (error) { const e = error as Error & { status?: number; runId?: string }; res.status(e.status ?? 400).json({ error: e.message, runId: e.runId }); }
});
judgesRouter.get('/qualification-runs/:runId', (req, res) => {
  const run = JudgeQualificationService.getRun(req.params.runId);
  res.status(run ? 200 : 404).json(run ?? { error: 'Qualification run not found' });
});
judgesRouter.post('/qualification-runs/:runId/cancel', (req, res) => {
  try { res.status(202).json(JudgeQualificationService.cancelRun(req.params.runId)); }
  catch (error) { const e = error as Error & { status?: number }; res.status(e.status ?? 400).json({ error: e.message }); }
});

judgesRouter.get('/:modelId/qualification', (req, res) => {
  const record = JudgeQualificationService.get(req.params.modelId);
  if (!record) {
    res.status(404).json({ error: 'No qualification record for this judge model' });
    return;
  }
  res.json(record);
});

judgesRouter.post('/:modelId/qualify', async (req, res) => {
  try {
    const modelId = req.params.modelId;
    const calibrationSetId = typeof req.body?.calibrationSetId === 'string' ? req.body.calibrationSetId : undefined;
    const record = await JudgeQualificationService.qualify(modelId, calibrationSetId);
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
