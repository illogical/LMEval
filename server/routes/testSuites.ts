import { Hono } from 'hono';
import { TestSuiteService } from '../services/TestSuiteService';

export const testSuitesRouter = new Hono();

testSuitesRouter.get('/', c => {
  return c.json(TestSuiteService.list());
});

testSuitesRouter.get('/:id', c => {
  const { id } = c.req.param();
  const suite = TestSuiteService.get(id);
  if (!suite) return c.json({ error: 'Test suite not found' }, 404);
  return c.json(suite);
});

testSuitesRouter.post('/', async c => {
  const body = await c.req.json();
  if (!body.name) return c.json({ error: 'name is required' }, 400);
  const suite = TestSuiteService.create(body);
  return c.json(suite, 201);
});

testSuitesRouter.put('/:id', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const updated = TestSuiteService.update(id, body);
  if (!updated) return c.json({ error: 'Test suite not found' }, 404);
  return c.json(updated);
});

testSuitesRouter.delete('/:id', c => {
  const { id } = c.req.param();
  const deleted = TestSuiteService.delete(id);
  if (!deleted) return c.json({ error: 'Test suite not found' }, 404);
  return c.json({ success: true });
});
