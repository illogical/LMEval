import { Router } from 'express';
import { GitService } from '../services/GitService';

export const gitRouter = Router();

gitRouter.get('/status', async (req, res) => {
  try {
    const status = await GitService.status();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

gitRouter.post('/init', async (req, res) => {
  try {
    await GitService.init();
    const status = await GitService.status();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

gitRouter.post('/commit', async (req, res) => {
  const body = (req.body ?? {}) as { message?: string };

  if (!body.message) {
    return void res.status(400).json({ error: 'message is required' });
  }

  try {
    const hash = await GitService.commit(body.message);
    res.json({ success: true, hash });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Commit message must start with')) {
      return void res.status(400).json({ error: msg });
    }
    if (msg.includes('nothing to commit')) {
      return void res.status(400).json({ error: 'Nothing to commit' });
    }
    res.status(500).json({ error: msg });
  }
});

gitRouter.post('/revert', async (req, res) => {
  const body = (req.body ?? {}) as { hash?: string };
  if (!body.hash) return void res.status(400).json({ error: 'hash is required' });

  try {
    await GitService.revert(body.hash);
    res.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Invalid commit hash')) {
      return void res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

gitRouter.get('/log', async (req, res) => {
  const limit = Number(req.query.limit ?? '10');
  try {
    const log = await GitService.log(limit);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
