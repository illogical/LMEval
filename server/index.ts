import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { TemplateService } from './services/TemplateService.ts';
import templates from './routes/templates.ts';
import prompts from './routes/prompts.ts';
import testSuites from './routes/testSuites.ts';
import evaluations from './routes/evaluations.ts';
import models from './routes/models.ts';
import { broadcast, wsHandlers } from './ws.ts';
import type { EvalStreamEvent } from '../src/types/eval.ts';

const PORT = parseInt(process.env.PORT ?? '3200', 10);

const app = new Hono();

app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:3200'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

// Mount routes
app.route('/api/eval/templates', templates);
app.route('/api/eval/prompts', prompts);
app.route('/api/eval/test-suites', testSuites);
app.route('/api/eval/evaluations', evaluations);
app.route('/api/eval/models', models);

app.get('/health', (c) => c.json({ status: 'ok', port: PORT }));

// Seed templates
TemplateService.seedBuiltIns();
console.log('[server] Templates seeded');

// Start Bun server with WebSocket support
const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // Handle WebSocket upgrade
    if (req.url.includes('/ws/eval')) {
      const upgraded = server.upgrade(req, { data: { id: crypto.randomUUID() } });
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    // Handle HTTP requests via Hono
    return app.fetch(req, { server });
  },
  websocket: wsHandlers
});

console.log(`[server] Eval server running at http://localhost:${server.port}`);
console.log(`[server] WebSocket at ws://localhost:${server.port}/ws/eval`);

export { broadcast };
export type { EvalStreamEvent };

