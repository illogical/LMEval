import { Hono } from 'hono';
import { TestSuiteService } from '../services/TestSuiteService';
import { parseCSV, parseJSON } from '../../src/utils/testCaseIO';
import { generateId } from '../services/FileService';

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

testSuitesRouter.post('/parse', async c => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ error: 'content (string) is required' }, 400);
  }
  const format: string = body.format ?? 'json';
  if (format !== 'csv' && format !== 'json') {
    return c.json({ error: 'format must be "csv" or "json"' }, 400);
  }
  const result = format === 'csv' ? parseCSV(body.content) : parseJSON(body.content);
  const cases = result.cases.map(tc => ({ ...tc, id: generateId('tc') }));
  return c.json({ cases, warnings: result.warnings, errors: result.errors });
});

testSuitesRouter.delete('/:id', c => {
  const { id } = c.req.param();
  const deleted = TestSuiteService.delete(id);
  if (!deleted) return c.json({ error: 'Test suite not found' }, 404);
  return c.json({ success: true });
});
