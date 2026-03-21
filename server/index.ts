import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { templatesRouter } from './routes/templates';
import { promptsRouter } from './routes/prompts';
import { testSuitesRouter } from './routes/testSuites';
import { modelsRouter } from './routes/models';
import { sessionsRouter } from './routes/sessions';
import { evaluationsRouter } from './routes/evaluations';
import { TemplateService } from './services/TemplateService';
import { setupWebSocket } from './ws';
import { config } from './config';

const app = new Hono();

app.use('*', cors());

app.route('/api/eval/templates', templatesRouter);
app.route('/api/eval/prompts', promptsRouter);
app.route('/api/eval/test-suites', testSuitesRouter);
app.route('/api/eval/models', modelsRouter);
app.route('/api/eval/sessions', sessionsRouter);
app.route('/api/eval/evaluations', evaluationsRouter);

app.get('/api/eval/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Seed built-in templates on startup
TemplateService.seedBuiltIns();

const httpServer = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Eval server running on http://localhost:${config.port}`);
});

setupWebSocket(httpServer);

export default app;
