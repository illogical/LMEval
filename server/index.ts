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
import { GitService } from './services/GitService';
import { gitRouter } from './routes/git';
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
app.route('/api/eval/git', gitRouter);

app.get('/api/eval/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Seed built-in templates on startup
TemplateService.seedBuiltIns();

// Check if data dir is a git repo on startup
GitService.isInitialized().then(initialized => {
  if (!initialized) {
    console.warn('[git] data/ is not a git repository. Run POST /api/eval/git/init to initialize.');
  }
}).catch(() => {});

const httpServer = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Eval server running on http://localhost:${config.port}`);
});

setupWebSocket(httpServer);

export default app;
