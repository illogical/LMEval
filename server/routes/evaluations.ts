import { Router } from 'express';
import { join } from 'path';
import {
  readJson, writeJson, listDir, generateId, ensureDir, deleteDir, EVALUATIONS_DIR, BASELINES_DIR,
} from '../services/FileService';
import { ExecutionService } from '../services/ExecutionService';
import { SessionService } from '../services/SessionService';
import { ReportService } from '../services/ReportService';
import { SummaryService } from '../services/SummaryService';
import { SummaryAnalysisService } from '../services/SummaryAnalysisService';
import { EvaluationService, browserPaths } from '../services/EvaluationService';
import { EvaluationFeedbackService } from '../services/EvaluationFeedbackService';
import { ModelCatalogUnavailableError } from '../services/EvaluationValidationService';
import type {
  EvaluationConfig, EvaluationSummary, TestCase, EvaluationHistoryEntry, BaselineSummary, EvalMatrixCell, EvaluationInput,
} from '../../src/types/eval';

export const evaluationsRouter = Router();
let appBasePath = '/';

export function configureEvaluationRoutes(options: { appBasePath: string }) {
  appBasePath = options.appBasePath;
}

function sendEvaluationError(res: import('express').Response, error: unknown) {
  const err = error as Error & { code?: string; validation?: unknown };
  if (error instanceof ModelCatalogUnavailableError) {
    return void res.status(503).json({ error: err.message, code: 'MODEL_CATALOG_UNAVAILABLE' });
  }
  if (err.code === 'EVALUATION_NOT_FOUND') return void res.status(404).json({ error: err.message, code: err.code });
  if (err.code === 'EVALUATION_NOT_DRAFT' || err.code === 'EVALUATION_ALREADY_STARTED') {
    return void res.status(409).json({ error: err.message, code: err.code });
  }
  if (err.validation) return void res.status(400).json({ error: err.message, code: 'EVALUATION_VALIDATION_FAILED', validation: err.validation });
  return void res.status(400).json({ error: err.message, code: err.code ?? 'EVALUATION_REQUEST_FAILED' });
}

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

  // A10: provenance/inference/transport/judge-qualification diff — both sides
  // already carry these fields on their EvaluationSummary, so this is
  // pass-through, not new computation.
  res.json({
    ...SummaryService.computeRegression(summary, baseline.summary),
    provenanceDiff: {
      current: {
        resolvedInference: summary.resolvedInference,
        transportProvenance: summary.transportProvenance,
        benchmarkProvenance: summary.benchmarkProvenance,
      },
      baseline: {
        resolvedInference: baseline.summary.resolvedInference,
        transportProvenance: baseline.summary.transportProvenance,
        benchmarkProvenance: baseline.summary.benchmarkProvenance,
      },
    },
  });
});

evaluationsRouter.post('/validate', async (req, res) => {
  try {
    const checked = await EvaluationService.validate(req.body as EvaluationInput);
    res.json(checked.validation);
  } catch (error) {
    sendEvaluationError(res, error);
  }
});

evaluationsRouter.post('/drafts', async (req, res) => {
  try {
    const created = await EvaluationService.create(req.body as EvaluationInput, 'draft');
    res.status(201).json({ ...created, browserPaths: browserPaths(created.evaluation.id, appBasePath) });
  } catch (error) {
    sendEvaluationError(res, error);
  }
});

evaluationsRouter.post('/', async (req, res) => {
  try {
    const created = await EvaluationService.create(req.body as EvaluationInput, 'pending');
    ExecutionService.run(created.evaluation.id).catch(err => console.error(`[ExecutionService] run(${created.evaluation.id}) failed:`, err));
    res.status(202).json({ ...created.evaluation, evalRunId: created.evalRunId });
  } catch (error) {
    sendEvaluationError(res, error);
  }
});

evaluationsRouter.patch('/:id', async (req, res) => {
  try {
    const updated = await EvaluationService.patchDraft(req.params.id, req.body as Partial<EvaluationInput>);
    res.json({ ...updated, browserPaths: browserPaths(updated.evaluation.id, appBasePath) });
  } catch (error) {
    sendEvaluationError(res, error);
  }
});

evaluationsRouter.post('/:id/run', async (req, res) => {
  try {
    const started = await EvaluationService.startDraft(req.params.id);
    ExecutionService.run(started.evaluation.id).catch(err => console.error(`[ExecutionService] run(${started.evaluation.id}) failed:`, err));
    res.status(202).json({ ...started, browserPaths: browserPaths(started.evaluation.id, appBasePath) });
  } catch (error) {
    sendEvaluationError(res, error);
  }
});

evaluationsRouter.get('/:id/feedback', async (req, res) => {
  const feedback = await EvaluationFeedbackService.get(req.params.id, appBasePath);
  if (!feedback) return void res.status(404).json({ error: 'Evaluation not found', code: 'EVALUATION_NOT_FOUND' });
  res.json(feedback);
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
    cellIds?: string[];
    sessionId?: string;
    sessionVersion?: number;
  };

  const originalConfig = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, id, 'config.json'));
  if (!originalConfig) return void res.status(404).json({ error: 'Evaluation not found' });

  // `cellIds` (single/multi cell "Retry this cell") takes precedence over
  // `failedCellsOnly` (bulk retry) when both are somehow present. Either
  // produces an explicit (promptId, modelId, testCaseId) allow-list that
  // ExecutionService.run() uses to shrink the re-run's matrix — previously
  // `failedCellsOnly` was accepted here but never actually implemented,
  // so a "retry failed cells" request silently re-ran the entire evaluation.
  // `results.json` (written post-execution by ExecutionService.aggregate()) carries the
  // real per-cell status/error; `cells.json` is only the pre-execution 'pending' snapshot
  // buildMatrix() wrote before any cell ran, so a failedCellsOnly lookup against it would
  // never find a 'failed' cell. Cell id/promptId/modelId/testCaseId are stable across both,
  // so `cells.json` is still a safe fallback for a not-yet-completed evaluation.
  const originalCells = readJson<EvalMatrixCell[]>(join(EVALUATIONS_DIR, id, 'results.json'))
    ?? readJson<EvalMatrixCell[]>(join(EVALUATIONS_DIR, id, 'cells.json'))
    ?? [];
  let cellFilter: Array<{ promptId: string; modelId: string; testCaseId: string }> | undefined;
  if (body.cellIds && body.cellIds.length > 0) {
    const targeted = originalCells.filter(c => body.cellIds!.includes(c.id));
    if (targeted.length === 0) return void res.status(400).json({ error: 'No matching cells found for the given cellIds' });
    cellFilter = targeted.map(c => ({ promptId: c.promptId, modelId: c.modelId, testCaseId: c.testCaseId }));
  } else if (body.failedCellsOnly) {
    const failed = originalCells.filter(c => c.status === 'failed');
    if (failed.length === 0) return void res.status(400).json({ error: 'No failed cells to retry' });
    cellFilter = failed.map(c => ({ promptId: c.promptId, modelId: c.modelId, testCaseId: c.testCaseId }));
  }

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

  ExecutionService.run(newEvalId, cellFilter ? { cellFilter } : undefined).catch(err => {
    console.error(`[ExecutionService] retry run(${newEvalId}) failed:`, err);
  });

  res.status(202).json({ evalId: newEvalId, evalRunId, retriedCells: cellFilter?.length });
});

// B3: Step 5 Summary page. GET returns the cached analysis (if any) without
// dispatching a model call; POST (re)generates it. Cached to
// data/evals/evaluations/{id}/analysis.json so repeat page visits don't
// re-spend a refinement-model call.
evaluationsRouter.get('/:id/summary-analysis', (req, res) => {
  const { id } = req.params;
  const cached = SummaryAnalysisService.getCached(id);
  if (!cached) return void res.status(404).json({ error: 'No analysis has been generated for this evaluation yet' });
  res.json(cached);
});

evaluationsRouter.post('/:id/summary-analysis', async (req, res) => {
  const { id } = req.params;
  const body = (req.body ?? {}) as { refinementModel?: string };
  try {
    const analysis = await SummaryAnalysisService.analyze(id, body.refinementModel);
    res.json(analysis);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
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
