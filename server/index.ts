import express, { Router, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { pathToFileURL } from 'url';
import { join } from 'path';
import { templatesRouter } from './routes/templates';
import { purposeTemplatesRouter } from './routes/purposeTemplates';
import { promptsRouter } from './routes/prompts';
import { testSuitesRouter } from './routes/testSuites';
import { modelsRouter } from './routes/models';
import { sessionsRouter } from './routes/sessions';
import { evaluationsRouter } from './routes/evaluations';
import { gitRouter } from './routes/git';
import { presetsRouter } from './routes/presets';
import { judgesRouter } from './routes/judges';
import { TemplateService } from './services/TemplateService';
import { PurposeTemplateService } from './services/PurposeTemplateService';
import { GitService } from './services/GitService';
import { configurePaths } from './services/FileService';
import { setupWebSocket } from './ws';
import { config } from './config';

/**
 * Composition root (docs/plans/2026-08-23-homebase-integration.md §2). Builds
 * the Express router and runs the (still I/O, but now deferred until called
 * rather than run at module-import time) startup checks. Has no side effects
 * beyond that — never listens, never touches the WebSocket server. Those are
 * the caller's job (the standalone guard below, or the hosted adapter's
 * initialize()/attachRealtime()).
 *
 * Returns a bare Router (not a full Express app) so it can be assigned
 * directly to HomeBase's `HostedApplication.router` contract field. The
 * standalone guard mounts it into its own `express()` instance at root.
 */
export function buildApp(): { router: Router; dispose: () => Promise<void> } {
  const router = Router();
  router.use(express.json());

  router.use('/api/eval/templates', templatesRouter);
  router.use('/api/eval/purpose-templates', purposeTemplatesRouter);
  router.use('/api/eval/prompts', promptsRouter);
  router.use('/api/eval/test-suites', testSuitesRouter);
  router.use('/api/eval/models', modelsRouter);
  router.use('/api/eval/sessions', sessionsRouter);
  router.use('/api/eval/evaluations', evaluationsRouter);
  router.use('/api/eval/git', gitRouter);
  router.use('/api/eval/presets', presetsRouter);
  router.use('/api/eval/judges', judgesRouter);

  router.get('/api/eval/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    // express.json() forwards a malformed body here as a SyntaxError before
    // any route handler runs — surface it the same way Hono's c.req.json()
    // rejection used to (a 400, not the generic 500 below).
    if (err instanceof SyntaxError && 'body' in err) {
      return void res.status(400).json({ error: 'Invalid JSON body' });
    }
    console.error('[server] Unhandled error:', err);
    res.status(500).json({ error: (err as Error).message ?? 'Internal server error' });
  });

  // Seed built-in templates on startup
  TemplateService.seedBuiltIns();
  PurposeTemplateService.seedBuiltIns();

  // Check if data dir is a git repo on startup
  GitService.isInitialized().then(initialized => {
    if (!initialized) {
      console.warn('[git] data/ is not a git repository. Run POST /api/eval/git/init to initialize.');
    }
  }).catch(() => {});

  return {
    router,
    // Nothing owned at this layer needs releasing today — WebSocket
    // teardown is the caller's responsibility via setupWebSocket()'s own
    // returned Disposer (server/ws.ts), not duplicated here.
    dispose: async () => {},
  };
}

const isMainModule = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });

  const { router } = buildApp();

  const app = express();
  app.use(cors());
  app.use(router);

  const httpServer = createServer(app);
  httpServer.listen(config.port, () => {
    console.log(`Eval server running on http://localhost:${config.port}`);
  });

  setupWebSocket(httpServer, '/');
}
