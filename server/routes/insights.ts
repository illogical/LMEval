import { Router } from 'express';
import {
  getLeaderboard, getTrend, getDiagnostics, getOperational, listActivities,
} from '../services/InsightsIndexService';

export const insightsRouter = Router();

insightsRouter.get('/activities', (_req, res) => {
  res.json(listActivities());
});

insightsRouter.get('/leaderboard', (req, res) => {
  const activity = typeof req.query.activity === 'string' ? req.query.activity : undefined;
  if (!activity) return void res.status(400).json({ error: 'activity query param is required' });
  res.json(getLeaderboard(activity));
});

insightsRouter.get('/trend', (req, res) => {
  const activity = typeof req.query.activity === 'string' ? req.query.activity : undefined;
  const modelId = typeof req.query.modelId === 'string' ? req.query.modelId : undefined;
  if (!activity) return void res.status(400).json({ error: 'activity query param is required' });
  res.json(getTrend(activity, modelId));
});

insightsRouter.get('/diagnostics', (req, res) => {
  const activity = typeof req.query.activity === 'string' ? req.query.activity : undefined;
  const modelId = typeof req.query.modelId === 'string' ? req.query.modelId : undefined;
  if (!activity) return void res.status(400).json({ error: 'activity query param is required' });
  res.json(getDiagnostics(activity, modelId));
});

insightsRouter.get('/operational', (req, res) => {
  const activity = typeof req.query.activity === 'string' ? req.query.activity : undefined;
  if (!activity) return void res.status(400).json({ error: 'activity query param is required' });
  res.json(getOperational(activity));
});
