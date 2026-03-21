import { Hono } from 'hono';
import { LmapiClient } from '../services/LmapiClient';

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
