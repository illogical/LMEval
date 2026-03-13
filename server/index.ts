import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { templatesRouter } from './routes/templates';
import { promptsRouter } from './routes/prompts';
import { testSuitesRouter } from './routes/testSuites';
import { modelsRouter } from './routes/models';
import { TemplateService } from './services/TemplateService';

const app = new Hono();

app.use('*', cors());

app.route('/api/eval/templates', templatesRouter);
app.route('/api/eval/prompts', promptsRouter);
app.route('/api/eval/test-suites', testSuitesRouter);
app.route('/api/eval/models', modelsRouter);

app.get('/api/eval/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Seed built-in templates on startup
TemplateService.seedBuiltIns();

const port = Number(process.env.PORT ?? 3200);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Eval server running on http://localhost:${port}`);
});

export default app;
