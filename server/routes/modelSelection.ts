import { Router } from 'express';
import { join } from 'path';
import { readJson, RECOMMENDATIONS_DIR } from '../services/FileService';
import { ModelSelectionService } from '../services/ModelSelectionService';
import { LatencyBudgetService, type LatencyBudgets } from '../services/LatencyBudgetService';
import type { ModelRecommendation } from '../../src/types/eval';

export const modelSelectionRouter = Router();

modelSelectionRouter.get('/', (req, res) => {
  res.json(ModelSelectionService.listCampaigns());
});

modelSelectionRouter.post('/', (req, res) => {
  try {
    const campaign = ModelSelectionService.createCampaign(req.body ?? {});
    ModelSelectionService.runCampaign(campaign.id).catch(err => {
      console.error(`[ModelSelectionService] runCampaign(${campaign.id}) failed:`, err);
    });
    res.status(202).json(campaign);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

modelSelectionRouter.get('/latency-budgets', (req, res) => {
  res.json(LatencyBudgetService.get() ?? {});
});

modelSelectionRouter.put('/latency-budgets', (req, res) => {
  const body = req.body as Partial<LatencyBudgets>;
  const tasks: Array<keyof LatencyBudgets> = ['classification', 'tagging', 'summarization'];
  for (const task of tasks) {
    if (typeof body[task] !== 'number') {
      return void res.status(400).json({ error: `latency-budgets requires a numeric "${task}" value` });
    }
  }
  res.json(LatencyBudgetService.set(body as LatencyBudgets));
});

modelSelectionRouter.get('/:id', (req, res) => {
  const campaign = ModelSelectionService.getCampaign(req.params.id);
  if (!campaign) return void res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

modelSelectionRouter.get('/:id/recommendations', (req, res) => {
  const campaign = ModelSelectionService.getCampaign(req.params.id);
  if (!campaign) return void res.status(404).json({ error: 'Campaign not found' });
  const recommendations: Record<string, ModelRecommendation> = {};
  for (const task of campaign.tasks) {
    const rec = readJson<ModelRecommendation>(join(RECOMMENDATIONS_DIR, `${campaign.id}-${task}.json`));
    if (rec) recommendations[task] = rec;
  }
  res.json(recommendations);
});

modelSelectionRouter.post('/:id/cancel', (req, res) => {
  const cancelled = ModelSelectionService.cancel(req.params.id);
  if (!cancelled) return void res.status(404).json({ error: 'Campaign not found or nothing in flight to cancel' });
  res.json({ cancelled: true });
});
