import { Hono } from 'hono';
import { LmapiClient } from '../services/LmapiClient';

export const modelsRouter = new Hono();

modelsRouter.get('/', async c => {
  try {
    const servers = await LmapiClient.getServers();
    const grouped = servers
      .filter(s => s.isOnline)
      .map(s => ({ serverName: s.config.name, models: s.models }));
    return c.json(grouped);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});
