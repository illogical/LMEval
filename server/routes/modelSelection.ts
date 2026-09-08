import { Router } from 'express';
import { join } from 'path';
import { readJson, RECOMMENDATIONS_DIR } from '../services/FileService';
import { ModelSelectionService } from '../services/ModelSelectionService';
import { LatencyBudgetService, type LatencyBudgets } from '../services/LatencyBudgetService';
import type { CampaignDraftFromEvaluationInput, ModelRecommendation } from '../../src/types/eval';
import { CampaignValidationService } from '../services/CampaignValidationService';
import { CampaignFeedbackService } from '../services/CampaignFeedbackService';
import type { Response } from 'express';

export const modelSelectionRouter = Router();
let appBasePath = '/';
export function configureCampaignRoutes(base: string) { appBasePath = base; }
function failure(res: Response, error: unknown) {
  const e = error as Error & { status?: number; validation?: unknown };
  res.status(e.status ?? (e.name === 'ModelCatalogUnavailableError' ? 503 : 400)).json({ error: e.message, validation: e.validation });
}
modelSelectionRouter.param('id', (req, res, next, id) => {
  if (!/^[\w-]+$/.test(id)) return void res.status(400).json({ error: 'Invalid campaign ID' });
  next();
});
modelSelectionRouter.post('/validate', async (req, res) => {
  try { res.json(await CampaignValidationService.validate(req.body)); } catch (e) { failure(res, e); }
});
modelSelectionRouter.post('/drafts', async (req, res) => {
  try { res.status(201).json(await ModelSelectionService.createDraft(req.body)); } catch (e) { failure(res, e); }
});
modelSelectionRouter.post('/drafts/from-evaluation', async (req, res) => {
  try { res.status(201).json(await ModelSelectionService.createDraftFromEvaluation(req.body as CampaignDraftFromEvaluationInput)); } catch (e) { failure(res, e); }
});
modelSelectionRouter.patch('/:id', async (req, res) => {
  try { res.json(await ModelSelectionService.patchDraft(req.params.id, req.body)); } catch (e) { failure(res, e); }
});
modelSelectionRouter.post('/:id/run', async (req, res) => {
  try {
    const codes = req.body?.acknowledgedWarningCodes ?? [];
    if (!Array.isArray(codes) || codes.some(c => typeof c !== 'string')) throw new Error('acknowledgedWarningCodes must be a string array');
    const campaign = await ModelSelectionService.startDraft(req.params.id, codes);
    res.status(202).json(campaign);
    void ModelSelectionService.runCampaign(campaign.id);
  } catch (e) { failure(res, e); }
});
modelSelectionRouter.get('/:id/feedback', async (req, res) => {
  const feedback = await CampaignFeedbackService.get(req.params.id, appBasePath);
  res.status(feedback ? 200 : 404).json(feedback ?? { error: 'Campaign not found' });
});

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
