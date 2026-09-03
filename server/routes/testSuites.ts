import { Router } from 'express';
import { TestSuiteService } from '../services/TestSuiteService';
import { parseCSV, parseJSON } from '../../src/utils/testCaseIO';
import { generateId } from '../services/FileService';

export const testSuitesRouter = Router();

testSuitesRouter.get('/', (req, res) => {
  res.json(TestSuiteService.list());
});

testSuitesRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const suite = TestSuiteService.get(id);
  if (!suite) return void res.status(404).json({ error: 'Test suite not found' });
  res.json(suite);
});

testSuitesRouter.post('/', (req, res) => {
  const body = req.body;
  if (!body.name) return void res.status(400).json({ error: 'name is required' });
  const suite = TestSuiteService.create(body);
  res.status(201).json(suite);
});

testSuitesRouter.put('/:id', (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const updated = TestSuiteService.update(id, body);
  if (!updated) return void res.status(404).json({ error: 'Test suite not found' });
  res.json(updated);
});

testSuitesRouter.post('/parse', (req, res) => {
  const body = req.body ?? null;
  if (!body || typeof body.content !== 'string') {
    return void res.status(400).json({ error: 'content (string) is required' });
  }
  const format: string = body.format ?? 'json';
  if (format !== 'csv' && format !== 'json') {
    return void res.status(400).json({ error: 'format must be "csv" or "json"' });
  }
  const result = format === 'csv' ? parseCSV(body.content) : parseJSON(body.content);
  const cases = result.cases.map(tc => ({ ...tc, id: generateId('tc') }));
  res.json({ cases, warnings: result.warnings, errors: result.errors });
});

testSuitesRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  const deleted = TestSuiteService.delete(id);
  if (!deleted) return void res.status(404).json({ error: 'Test suite not found' });
  res.json({ success: true });
});
