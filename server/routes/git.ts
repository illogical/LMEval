import { Hono } from 'hono';
import { GitService } from '../services/GitService';

export const gitRouter = new Hono();

gitRouter.get('/status', async c => {
  try {
    const status = await GitService.status();
    return c.json(status);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

gitRouter.post('/init', async c => {
  try {
    await GitService.init();
    const status = await GitService.status();
    return c.json({ success: true, status });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

gitRouter.post('/commit', async c => {
  const body = await c.req.json().catch(() => ({})) as { message?: string };

  if (!body.message) {
    return c.json({ error: 'message is required' }, 400);
  }

  try {
    const hash = await GitService.commit(body.message);
    return c.json({ success: true, hash });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Commit message must start with')) {
      return c.json({ error: msg }, 400);
    }
    if (msg.includes('nothing to commit')) {
      return c.json({ error: 'Nothing to commit' }, 400);
    }
    return c.json({ error: msg }, 500);
  }
});

gitRouter.post('/revert', async c => {
  const body = await c.req.json().catch(() => ({})) as { hash?: string };
  if (!body.hash) return c.json({ error: 'hash is required' }, 400);

  try {
    await GitService.revert(body.hash);
    return c.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Invalid commit hash')) {
      return c.json({ error: msg }, 400);
    }
    return c.json({ error: msg }, 500);
  }
});

gitRouter.get('/log', async c => {
  const limit = Number(c.req.query('limit') ?? '10');
  try {
    const log = await GitService.log(limit);
    return c.json(log);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});
