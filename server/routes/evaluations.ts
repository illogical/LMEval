import { Router } from 'express';
import { join } from 'path';
import {
  readJson, writeJson, listDir, generateId, ensureDir, deleteDir, EVALUATIONS_DIR, BASELINES_DIR,
} from '../services/FileService';
import { ExecutionService } from '../services/ExecutionService';
import { SessionService } from '../services/SessionService';
import { ReportService } from '../services/ReportService';
import { SummaryService } from '../services/SummaryService';
import type {
  EvaluationConfig, EvaluationSummary, TestCase, EvaluationHistoryEntry, BaselineSummary,
} from '../../src/types/eval';

export const evaluationsRouter = Router();

evaluationsRouter.get('/', (req, res) => {
  const status = req.query.status as string | undefined;
  const promptId = req.query.promptId as string | undefined;
  const modelId = req.query.modelId as string | undefined;

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
  res.json(evals.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// Saved baselines, newest first — lets the Results UI offer a "compare
// against" picker instead of requiring the user to already know a slug.
// Registered before /:id so it isn't shadowed by that param route.
evaluationsRouter.get('/baselines', (req, res) => {
  ensureDir(BASELINES_DIR);
  const baselines: BaselineSummary[] = [];
  for (const file of listDir(BASELINES_DIR)) {
    if (!file.endsWith('.json')) continue;
    const slug = file.replace(/\.json$/, '');
    const record = readJson<{ evalId: string; savedAt: string; summary: EvaluationSummary }>(
      join(BASELINES_DIR, file)
    );
    if (!record) continue;
    const scored = record.summary.modelSummaries.filter(m => m.avgCompositeScore != null);
    baselines.push({
      slug,
      evalId: record.evalId,
      savedAt: record.savedAt,
      modelIds: record.summary.modelSummaries.map(m => m.modelId),
      avgCompositeScore: scored.length > 0
        ? scored.reduce((s, m) => s + (m.avgCompositeScore ?? 0), 0) / scored.length
        : undefined,
    });
  }
  res.json(baselines.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
});

evaluationsRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
  if (!config) return void res.status(404).json({ error: 'Evaluation not found' });
  res.json(config);
});

evaluationsRouter.get('/:id/results', (req, res) => {
  const { id } = req.params;
  const results = readJson(join(EVALUATIONS_DIR, id, 'results.json'));
  if (!results) return void res.status(404).json({ error: 'Results not found' });
  res.json(results);
});

evaluationsRouter.get('/:id/summary', (req, res) => {
  const { id } = req.params;
  const summary = readJson(join(EVALUATIONS_DIR, id, 'summary.json'));
  if (!summary) return void res.status(404).json({ error: 'Summary not found' });
  res.json(summary);
});

// The resolved test cases actually run for this eval, persisted at run time
// (server/services/ExecutionService.ts) so the Results UI can label rows with
// the real user message instead of the generated testCaseId slug.
evaluationsRouter.get('/:id/testcases', (req, res) => {
  const { id } = req.params;
  const testCases = readJson<TestCase[]>(join(EVALUATIONS_DIR, id, 'testcases.json'));
  res.json(testCases ?? []);
});

// Per-eval history of composite scores over time for every prompt this eval
// used, across all completed evaluations that share at least one of those
// prompt ids — generalizes the per-prompt logic in routes/prompts.ts to an
// eval's whole prompt set, so the Trend tab can plot real multi-run history.
evaluationsRouter.get('/:id/history', (req, res) => {
  const { id } = req.params;
  const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
  if (!config) return void res.status(404).json({ error: 'Evaluation not found' });

  ensureDir(EVALUATIONS_DIR);
  const history: EvaluationHistoryEntry[] = [];

  for (const evalId of listDir(EVALUATIONS_DIR)) {
    const otherConfig = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    if (!otherConfig || otherConfig.status !== 'completed') continue;
    if (!otherConfig.promptIds.some(p => config.promptIds.includes(p))) continue;

    const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
    if (!summary) continue;

    const modelScores: Record<string, number> = {};
    for (const m of summary.modelSummaries) {
      if (m.avgCompositeScore != null) modelScores[m.modelId] = m.avgCompositeScore;
    }
    const promptScores: Record<string, number> = {};
    for (const p of summary.promptSummaries) {
      if (p.avgCompositeScore != null) promptScores[`${p.promptId}:${p.promptVersion}`] = p.avgCompositeScore;
    }

    history.push({
      evalId,
      date: summary.completedAt ?? otherConfig.createdAt,
      modelScores,
      promptScores,
    });
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  res.json(history);
});

// Regression of this eval's summary against a saved baseline — computed on
// read rather than at run time, so any baseline (not just the one active when
// the eval was originally run) can be selected from the Results UI.
evaluationsRouter.get('/:id/regression', (req, res) => {
  const { id } = req.params;
  const baselineSlug = req.query.baselineSlug as string | undefined;
  if (!baselineSlug) return void res.status(400).json({ error: 'baselineSlug query param is required' });

  const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, id, 'summary.json'));
  if (!summary) return void res.status(404).json({ error: 'Summary not found' });

  const baseline = readJson<{ evalId: string; savedAt: string; summary: EvaluationSummary }>(
    join(BASELINES_DIR, `${baselineSlug}.json`)
  );
  if (!baseline) return void res.status(404).json({ error: 'Baseline not found' });

  res.json(SummaryService.computeRegression(summary, baseline.summary));
});

evaluationsRouter.post('/', (req, res) => {
  const body = req.body as Partial<EvaluationConfig> & {
    sessionId?: string;
    sessionVersion?: number;
  };

  if (!body.name || !body.promptIds?.length || !body.modelIds?.length) {
    return void res.status(400).json({ error: 'name, promptIds, and modelIds are required' });
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
    comparisonMode: body.comparisonMode,
    purposeTemplateId: body.purposeTemplateId,
    testSuiteId: body.testSuiteId,
    userMessage: body.userMessage,
    inlineTestCases: body.inlineTestCases,
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

  res.status(202).json({ ...config, evalRunId });
});

evaluationsRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  const evalDir = join(EVALUATIONS_DIR, id);
  const config = readJson<EvaluationConfig>(join(evalDir, 'config.json'));
  if (!config) return void res.status(404).json({ error: 'Evaluation not found' });
  ExecutionService.cancel(id);
  deleteDir(evalDir);
  res.json({ success: true });
});

evaluationsRouter.post('/:id/cancel', (req, res) => {
  const { id } = req.params;
  const evalDir = join(EVALUATIONS_DIR, id);
  const config = readJson<EvaluationConfig>(join(evalDir, 'config.json'));
  if (!config) return void res.status(404).json({ error: 'Evaluation not found' });
  const cancelled = ExecutionService.cancel(id);
  res.json({ success: true, cancelled });
});

evaluationsRouter.post('/:id/retry', (req, res) => {
  const { id } = req.params;
  const body = (req.body ?? {}) as {
    failedCellsOnly?: boolean;
    sessionId?: string;
    sessionVersion?: number;
  };

  const originalConfig = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
  if (!originalConfig) return void res.status(404).json({ error: 'Evaluation not found' });

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

  res.status(202).json({ evalId: newEvalId, evalRunId });
});

evaluationsRouter.get('/:id/export', (req, res) => {
  const { id } = req.params;
  const format = (req.query.format as string | undefined) ?? 'html';

  if (format === 'html') {
    const html = ReportService.generateHtml(id);
    if (!html) return void res.status(404).json({ error: 'Report could not be generated' });
    const safeId = id.replace(/[^a-zA-Z0-9_\-]/g, '_');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="eval-${safeId}.html"`);
    return void res.send(html);
  }

  if (format === 'md') {
    const md = ReportService.generateMarkdown(id);
    if (!md) return void res.status(404).json({ error: 'Report could not be generated' });
    const safeId = id.replace(/[^a-zA-Z0-9_\-]/g, '_');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="eval-${safeId}.md"`);
    return void res.send(md);
  }

  res.status(400).json({ error: 'format must be html or md' });
});

evaluationsRouter.post('/:id/baseline', (req, res) => {
  const { id } = req.params;
  const body = (req.body ?? {}) as { slug?: string };
  if (!body.slug) return void res.status(400).json({ error: 'slug is required' });

  const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, id, 'summary.json'));
  if (!summary) return void res.status(404).json({ error: 'Summary not found — run eval first' });

  ensureDir(BASELINES_DIR);
  const baselinePath = join(BASELINES_DIR, `${body.slug}.json`);
  writeJson(baselinePath, { evalId: id, savedAt: new Date().toISOString(), summary });
  res.json({ success: true, slug: body.slug, path: baselinePath });
});

// Saved baselines, newest first — lets the Results UI offer a "compare
// against" picker instead of requiring the user to already know a slug.
