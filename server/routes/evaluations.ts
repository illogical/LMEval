import { Hono } from 'hono';
import { join } from 'path';
import {
  readJson, writeJson, listDir, generateId, ensureDir, EVALUATIONS_DIR, BASELINES_DIR,
} from '../services/FileService';
import { ExecutionService } from '../services/ExecutionService';
import { SessionService } from '../services/SessionService';
import { ReportService } from '../services/ReportService';
import type { EvaluationConfig } from '../../src/types/eval';

export const evaluationsRouter = new Hono();

evaluationsRouter.get('/', c => {
  const status = c.req.query('status');
  const promptId = c.req.query('promptId');
  const modelId = c.req.query('modelId');

  ensureDir(EVALUATIONS_DIR);
  const evals: EvaluationConfig[] = [];
  for (const id of listDir(EVALUATIONS_DIR)) {
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
    if (!config) continue;
    if (status && config.status !== status) continue;
    if (promptId && !config.promptIds.includes(promptId)) continue;
    if (modelId && !config.modelIds.includes(modelId)) continue;
    evals.push(config);
  }
  return c.json(evals.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

evaluationsRouter.get('/:id', c => {
  const { id } = c.req.param();
  const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
  if (!config) return c.json({ error: 'Evaluation not found' }, 404);
  return c.json(config);
});

evaluationsRouter.get('/:id/results', c => {
  const { id } = c.req.param();
  const results = readJson(join(EVALUATIONS_DIR, id, 'results.json'));
  if (!results) return c.json({ error: 'Results not found' }, 404);
  return c.json(results);
});

evaluationsRouter.get('/:id/summary', c => {
  const { id } = c.req.param();
  const summary = readJson(join(EVALUATIONS_DIR, id, 'summary.json'));
  if (!summary) return c.json({ error: 'Summary not found' }, 404);
  return c.json(summary);
});

evaluationsRouter.post('/', async c => {
  const body = await c.req.json() as Partial<EvaluationConfig> & {
    sessionId?: string;
    sessionVersion?: number;
  };

  if (!body.name || !body.promptIds?.length || !body.modelIds?.length) {
    return c.json({ error: 'name, promptIds, and modelIds are required' }, 400);
  }

  const now = new Date().toISOString();
  const evalId = generateId('eval');
  const evalDir = join(EVALUATIONS_DIR, evalId);
  ensureDir(evalDir);

  const config: EvaluationConfig = {
    id: evalId,
    name: body.name,
    promptIds: body.promptIds,
    modelIds: body.modelIds,
    testSuiteId: body.testSuiteId,
    userMessage: body.userMessage,
    templateId: body.templateId,
    judgeModelId: body.judgeModelId,
    enablePairwise: body.enablePairwise,
    runsPerCell: body.runsPerCell ?? 1,
    sessionId: body.sessionId,
    sessionVersion: body.sessionVersion,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  writeJson(join(evalDir, 'config.json'), config);

  let evalRunId: string | undefined;
  if (body.sessionId && body.sessionVersion != null) {
    const run = SessionService.addEvalRun(body.sessionId, body.sessionVersion, evalId);
    evalRunId = run?.id;
  }

  ExecutionService.run(evalId).catch(err => {
    console.error(`[ExecutionService] run(${evalId}) failed:`, err);
  });

  return c.json({ ...config, evalRunId }, 202);
});

evaluationsRouter.delete('/:id', c => {
  const { id } = c.req.param();
  const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
  if (!config) return c.json({ error: 'Evaluation not found' }, 404);
  const cancelled = ExecutionService.cancel(id);
  return c.json({ success: true, cancelled });
});

evaluationsRouter.post('/:id/retry', async c => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({})) as {
    failedCellsOnly?: boolean;
    sessionId?: string;
    sessionVersion?: number;
  };

  const originalConfig = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
  if (!originalConfig) return c.json({ error: 'Evaluation not found' }, 404);

  const now = new Date().toISOString();
  const newEvalId = generateId('eval');
  const newEvalDir = join(EVALUATIONS_DIR, newEvalId);
  ensureDir(newEvalDir);

  const newConfig: EvaluationConfig = {
    ...originalConfig,
    id: newEvalId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    sessionId: body.sessionId ?? originalConfig.sessionId,
    sessionVersion: body.sessionVersion ?? originalConfig.sessionVersion,
  };

  writeJson(join(newEvalDir, 'config.json'), newConfig);

  let evalRunId: string | undefined;
  if (newConfig.sessionId && newConfig.sessionVersion != null) {
    const run = SessionService.addEvalRun(newConfig.sessionId, newConfig.sessionVersion, newEvalId);
    evalRunId = run?.id;
  }

  ExecutionService.run(newEvalId).catch(err => {
    console.error(`[ExecutionService] retry run(${newEvalId}) failed:`, err);
  });

  return c.json({ evalId: newEvalId, evalRunId }, 202);
});

evaluationsRouter.get('/:id/export', c => {
  const { id } = c.req.param();
  const format = c.req.query('format') ?? 'html';

  if (format === 'html') {
    const html = ReportService.generateHtml(id);
    if (!html) return c.json({ error: 'Report could not be generated' }, 404);
    const safeId = id.replace(/[^a-zA-Z0-9_\-]/g, '_');
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="eval-${safeId}.html"`);
    return c.body(html);
  }

  if (format === 'md') {
    const md = ReportService.generateMarkdown(id);
    if (!md) return c.json({ error: 'Report could not be generated' }, 404);
    const safeId = id.replace(/[^a-zA-Z0-9_\-]/g, '_');
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="eval-${safeId}.md"`);
    return c.body(md);
  }

  return c.json({ error: 'format must be html or md' }, 400);
});

evaluationsRouter.post('/:id/baseline', async c => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({})) as { slug?: string };
  if (!body.slug) return c.json({ error: 'slug is required' }, 400);

  const summary = readJson(join(EVALUATIONS_DIR, id, 'summary.json'));
  if (!summary) return c.json({ error: 'Summary not found — run eval first' }, 404);

  ensureDir(BASELINES_DIR);
  const baselinePath = join(BASELINES_DIR, `${body.slug}.json`);
  writeJson(baselinePath, { evalId: id, savedAt: new Date().toISOString(), summary });
  return c.json({ success: true, slug: body.slug, path: baselinePath });
});
