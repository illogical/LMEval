import { Router } from 'express';
import { SessionService } from '../services/SessionService';

export const sessionsRouter = Router();

sessionsRouter.get('/', (req, res) => {
  res.json(SessionService.list());
});

sessionsRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const session = SessionService.get(id);
  if (!session) return void res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

sessionsRouter.get('/:id/active', (req, res) => {
  const { id } = req.params;
  const version = SessionService.getActiveVersion(id);
  if (!version) return void res.status(404).json({ error: 'Session or active version not found' });
  res.json(version);
});

sessionsRouter.get('/:id/versions/:version', (req, res) => {
  const { id, version } = req.params;
  const sv = SessionService.getVersion(id, Number(version));
  if (!sv) return void res.status(404).json({ error: 'Version not found' });
  res.json(sv);
});

sessionsRouter.post('/', (req, res) => {
  const body = req.body;
  if (!body.name || !body.promptA || !body.promptB) {
    return void res.status(400).json({ error: 'name, promptA, and promptB are required' });
  }
  if (!body.promptA.promptId || body.promptA.promptVersion == null) {
    return void res.status(400).json({ error: 'promptA must have promptId and promptVersion' });
  }
  if (!body.promptB.promptId || body.promptB.promptVersion == null) {
    return void res.status(400).json({ error: 'promptB must have promptId and promptVersion' });
  }
  const session = SessionService.create(body);
  res.status(201).json(session);
});

sessionsRouter.post('/:id/versions', (req, res) => {
  const { id } = req.params;
  const body = req.body;
  if (!body.promptA || !body.promptB) {
    return void res.status(400).json({ error: 'promptA and promptB are required' });
  }
  const version = SessionService.createVersion(id, body);
  if (!version) return void res.status(404).json({ error: 'Session not found' });
  res.status(201).json(version);
});

sessionsRouter.put('/:id/latest', (req, res) => {
  const { id } = req.params;
  const body = req.body;
  if (body.version == null) return void res.status(400).json({ error: 'version is required' });
  const updated = SessionService.setLatestVersion(id, Number(body.version));
  if (!updated) return void res.status(404).json({ error: 'Session or version not found' });
  res.json(updated);
});

sessionsRouter.get('/:id/runs', (req, res) => {
  const { id } = req.params;
  const versionParam = req.query.version as string | undefined;
  const runs = SessionService.listEvalRuns(id, versionParam ? Number(versionParam) : undefined);
  res.json(runs);
});

sessionsRouter.post('/:id/runs', (req, res) => {
  const { id } = req.params;
  const body = req.body;
  if (!body.evalId || body.sessionVersion == null) {
    return void res.status(400).json({ error: 'evalId and sessionVersion are required' });
  }
  const run = SessionService.addEvalRun(id, Number(body.sessionVersion), body.evalId);
  if (!run) return void res.status(404).json({ error: 'Session not found' });
  res.status(201).json(run);
});

sessionsRouter.patch('/:id/runs/:runId', (req, res) => {
  const { id, runId } = req.params;
  const body = req.body;
  const updated = SessionService.updateEvalRun(id, runId, body);
  if (!updated) return void res.status(404).json({ error: 'Run not found' });
  res.json(updated);
});

sessionsRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  const deleted = SessionService.delete(id);
  if (!deleted) return void res.status(404).json({ error: 'Session not found' });
  res.json({ success: true });
});
