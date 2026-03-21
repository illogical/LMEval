import { Hono } from 'hono';
import { join } from 'path';
import { LmapiClient } from '../services/LmapiClient';
import { readJson, ensureDir, listDir, EVALUATIONS_DIR } from '../services/FileService';
import type { EvaluationConfig, EvaluationSummary } from '../../src/types/eval';

export const modelsRouter = new Hono();

modelsRouter.get('/', async c => {
  try {
    const models = await LmapiClient.getLoadedModels();
    return c.json({ models });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

modelsRouter.get('/by-server', async c => {
  try {
    const servers = await LmapiClient.getServers();
    const result = servers
      .filter(s => s.isOnline && s.models.length > 0)
      .map(s => ({
        name: s.config.name,
        models: [...s.models].sort((a, b) => a.localeCompare(b)),
      }));
    return c.json({ servers: result });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

modelsRouter.get('/leaderboard', c => {
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

  return c.json(leaderboard);
});
