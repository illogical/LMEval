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
