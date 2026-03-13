import { Hono } from 'hono';
import { LmapiClient } from '../services/LmapiClient.ts';
import { FileService } from '../services/FileService.ts';
import { join } from 'path';
import type { EvaluationConfig, EvaluationSummary } from '../../src/types/eval.ts';

const models = new Hono();

models.get('/', async (c) => {
  try {
    const servers = await LmapiClient.getServers();
    const grouped: Record<string, string[]> = {};
    for (const server of servers) {
      if (server.isOnline) {
        grouped[server.config.name] = server.models;
      }
    }
    return c.json({ servers, grouped });
  } catch (e) {
    return c.json({ error: String(e), servers: [], grouped: {} }, 503);
  }
});

models.get('/leaderboard', (c) => {
  try {
    const evalsDir = join(FileService.evalsDir(), 'evaluations');
    FileService.ensureDir(evalsDir);
    const evalDirs = FileService.listDirs(evalsDir);

    const modelAggregates = new Map<string, { totalScore: number; count: number; totalPassRate: number; totalLatency: number; totalTPS: number }>();

    for (const evalDir of evalDirs) {
      const config = FileService.readJson<EvaluationConfig>(join(evalDir, 'config.json'));
      if (!config || config.status !== 'completed') continue;

      const summary = FileService.readJson<EvaluationSummary>(join(evalDir, 'summary.json'));
      if (!summary) continue;

      for (const mr of summary.modelRankings) {
        const existing = modelAggregates.get(mr.modelId) ?? { totalScore: 0, count: 0, totalPassRate: 0, totalLatency: 0, totalTPS: 0 };
        existing.totalScore += mr.compositeScore;
        existing.totalPassRate += mr.deterministicPassRate;
        existing.totalLatency += mr.avgLatencyMs;
        existing.totalTPS += mr.avgTokensPerSecond;
        existing.count++;
        modelAggregates.set(mr.modelId, existing);
      }
    }

    const leaderboard = Array.from(modelAggregates.entries())
      .map(([modelId, agg]) => ({
        modelId,
        avgCompositeScore: agg.count > 0 ? agg.totalScore / agg.count : 0,
        avgDeterministicPassRate: agg.count > 0 ? agg.totalPassRate / agg.count : 0,
        avgLatencyMs: agg.count > 0 ? agg.totalLatency / agg.count : 0,
        avgTokensPerSecond: agg.count > 0 ? agg.totalTPS / agg.count : 0,
        evalCount: agg.count
      }))
      .sort((a, b) => b.avgCompositeScore - a.avgCompositeScore || b.avgDeterministicPassRate - a.avgDeterministicPassRate);

    return c.json(leaderboard);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

export default models;
