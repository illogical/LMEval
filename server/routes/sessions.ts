import { Hono } from 'hono';
import { SessionService } from '../services/SessionService';

export const sessionsRouter = new Hono();

sessionsRouter.get('/', c => {
  return c.json(SessionService.list());
});

sessionsRouter.get('/:id', c => {
  const { id } = c.req.param();
  const session = SessionService.get(id);
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json(session);
});

sessionsRouter.get('/:id/active', c => {
  const { id } = c.req.param();
  const version = SessionService.getActiveVersion(id);
  if (!version) return c.json({ error: 'Session or active version not found' }, 404);
  return c.json(version);
});

sessionsRouter.get('/:id/versions/:version', c => {
  const { id, version } = c.req.param();
  const sv = SessionService.getVersion(id, Number(version));
  if (!sv) return c.json({ error: 'Version not found' }, 404);
  return c.json(sv);
});

sessionsRouter.post('/', async c => {
  const body = await c.req.json();
  if (!body.name || !body.promptA || !body.promptB) {
    return c.json({ error: 'name, promptA, and promptB are required' }, 400);
  }
  if (!body.promptA.promptId || body.promptA.promptVersion == null) {
    return c.json({ error: 'promptA must have promptId and promptVersion' }, 400);
  }
  if (!body.promptB.promptId || body.promptB.promptVersion == null) {
    return c.json({ error: 'promptB must have promptId and promptVersion' }, 400);
  }
  const session = SessionService.create(body);
  return c.json(session, 201);
});

sessionsRouter.post('/:id/versions', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  if (!body.promptA || !body.promptB) {
    return c.json({ error: 'promptA and promptB are required' }, 400);
  }
  const version = SessionService.createVersion(id, body);
  if (!version) return c.json({ error: 'Session not found' }, 404);
  return c.json(version, 201);
});

sessionsRouter.put('/:id/latest', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  if (body.version == null) return c.json({ error: 'version is required' }, 400);
  const updated = SessionService.setLatestVersion(id, Number(body.version));
  if (!updated) return c.json({ error: 'Session or version not found' }, 404);
  return c.json(updated);
});

sessionsRouter.get('/:id/runs', c => {
  const { id } = c.req.param();
  const versionParam = c.req.query('version');
  const runs = SessionService.listEvalRuns(id, versionParam ? Number(versionParam) : undefined);
  return c.json(runs);
});

sessionsRouter.post('/:id/runs', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  if (!body.evalId || body.sessionVersion == null) {
    return c.json({ error: 'evalId and sessionVersion are required' }, 400);
  }
  const run = SessionService.addEvalRun(id, Number(body.sessionVersion), body.evalId);
  if (!run) return c.json({ error: 'Session not found' }, 404);
  return c.json(run, 201);
});

sessionsRouter.patch('/:id/runs/:runId', async c => {
  const { id, runId } = c.req.param();
  const body = await c.req.json();
  const updated = SessionService.updateEvalRun(id, runId, body);
  if (!updated) return c.json({ error: 'Run not found' }, 404);
  return c.json(updated);
});

sessionsRouter.delete('/:id', c => {
  const { id } = c.req.param();
  const deleted = SessionService.delete(id);
  if (!deleted) return c.json({ error: 'Session not found' }, 404);
  return c.json({ success: true });
});
