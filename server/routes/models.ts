import { Router } from 'express';
import { join } from 'path';
import { LmapiClient } from '../services/LmapiClient';
import { readJson, ensureDir, listDir, EVALUATIONS_DIR } from '../services/FileService';
import type { EvaluationConfig, EvaluationSummary } from '../../src/types/eval';

export const modelsRouter = Router();

modelsRouter.get('/', async (req, res) => {
  try {
    const models = await LmapiClient.getLoadedModels();
    res.json({ models });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

modelsRouter.get('/by-server', async (req, res) => {
  try {
    const servers = await LmapiClient.getServers();
    const result = servers
      .filter(s => s.isOnline && s.models.length > 0)
      .map(s => ({
        name: s.config.name,
        models: [...s.models].sort((a, b) => a.localeCompare(b)),
      }));
    res.json({ servers: result });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

modelsRouter.get('/leaderboard', (req, res) => {
  ensureDir(EVALUATIONS_DIR);
  const modelScores = new Map<string, number[]>();

  for (const evalId of listDir(EVALUATIONS_DIR)) {
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    if (!config || config.status !== 'completed') continue;

    const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
    if (!summary) continue;

    for (const m of summary.modelSummaries) {
      if (m.avgCompositeScore == null) continue;
      const scores = modelScores.get(m.modelId) ?? [];
      scores.push(m.avgCompositeScore);
      modelScores.set(m.modelId, scores);
    }
  }

  const leaderboard = Array.from(modelScores.entries()).map(([modelId, scores]) => ({
    modelId,
    avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
    evalCount: scores.length,
  })).sort((a, b) => b.avgScore - a.avgScore);

  res.json(leaderboard);
});
