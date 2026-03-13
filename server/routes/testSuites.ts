import { Hono } from 'hono';
import { TestSuiteService } from '../services/TestSuiteService.ts';

const testSuites = new Hono();

testSuites.get('/', (c) => {
  try {
    return c.json(TestSuiteService.list());
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

testSuites.get('/:id', (c) => {
  const suite = TestSuiteService.get(c.req.param('id'));
  if (!suite) return c.json({ error: 'Test suite not found' }, 404);
  return c.json(suite);
});

testSuites.post('/', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const suite = TestSuiteService.create({
      name: body.name,
      description: body.description,
      testCases: body.testCases ?? []
    });
    return c.json(suite, 201);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

testSuites.put('/:id', async (c) => {
  try {
    const body = await c.req.json();
    const suite = TestSuiteService.update(c.req.param('id'), body);
    return c.json(suite);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

testSuites.delete('/:id', (c) => {
  try {
    TestSuiteService.delete(c.req.param('id'));
    return c.json({ success: true });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

export default testSuites;
