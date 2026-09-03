import { Router } from 'express';
import { join } from 'path';
import { PromptService } from '../services/PromptService';
import { readJson, ensureDir, listDir, EVALUATIONS_DIR } from '../services/FileService';
import type { EvaluationConfig, EvaluationSummary } from '../../src/types/eval';

export const promptsRouter = Router();

promptsRouter.get('/', (req, res) => {
  res.json(PromptService.list());
});

promptsRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const prompt = PromptService.get(id);
  if (!prompt) return void res.status(404).json({ error: 'Prompt not found' });
  res.json(prompt);
});

promptsRouter.get('/:id/content', (req, res) => {
  const { id } = req.params;
  const version = Number(req.query.version ?? '1');
  const content = PromptService.getVersionContent(id, version);
  if (content === null) return void res.status(404).json({ error: 'Version not found' });
  res.json({ content, version });
});

promptsRouter.post('/', (req, res) => {
  try {
    const body = req.body;
    if (!body.name || !body.content) {
      return void res.status(400).json({ error: 'name and content are required' });
    }
    const prompt = PromptService.create(body);
    res.status(201).json(prompt);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to create prompt' });
  }
});

promptsRouter.post('/:id/versions', (req, res) => {
  const { id } = req.params;
  const body = req.body;
  if (!body.content) return void res.status(400).json({ error: 'content is required' });
  try {
    const updated = PromptService.addVersion(id, body.content, body.description);
    if (!updated) return void res.status(404).json({ error: 'Prompt not found' });
    res.status(201).json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

promptsRouter.get('/:id/diff', (req, res) => {
  const { id } = req.params;
  const vA = Number(req.query.from ?? '1');
  const vB = Number(req.query.to ?? '2');
  const diff = PromptService.diff(id, vA, vB);
  if (diff === null) return void res.status(404).json({ error: 'Version not found' });
  res.json({ diff, from: vA, to: vB });
});

promptsRouter.put('/:id/tools', (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const updated = PromptService.updateTools(id, body.tools ?? []);
  if (!updated) return void res.status(404).json({ error: 'Prompt not found' });
  res.json(updated);
});

promptsRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  const deleted = PromptService.delete(id);
  if (!deleted) return void res.status(404).json({ error: 'Prompt not found' });
  res.json({ success: true });
});

promptsRouter.get('/:id/history', (req, res) => {
  const { id } = req.params;

  ensureDir(EVALUATIONS_DIR);
  const history: Array<{
    evalId: string;
    date: string;
    modelScores: Record<string, number>;
    promptScore?: number;
  }> = [];

  for (const evalId of listDir(EVALUATIONS_DIR)) {
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    if (!config || !config.promptIds.includes(id)) continue;
    if (config.status !== 'completed') continue;

    const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
    if (!summary) continue;

    const modelScores: Record<string, number> = {};
    for (const m of summary.modelSummaries) {
      if (m.avgCompositeScore != null) modelScores[m.modelId] = m.avgCompositeScore;
    }

    const promptSummary = summary.promptSummaries.find(p => p.promptId === id);

    history.push({
      evalId,
      date: summary.completedAt ?? config.createdAt,
      modelScores,
      promptScore: promptSummary?.avgCompositeScore,
    });
  }

  history.sort((a, b) => b.date.localeCompare(a.date));
  res.json(history);
});
