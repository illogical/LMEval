import { join } from 'node:path';
import type { Server } from 'node:http';
import { buildApp } from '../index';
import { configurePaths } from '../services/FileService';
import { reconfigureLmapiBaseUrl } from '../config';
import { LmapiClient } from '../services/LmapiClient';
import { ExecutionService } from '../services/ExecutionService';
import { setupWebSocket, type Disposer as WsDisposer } from '../ws';
import { parseHostedConfig } from './config';
import {
  HOSTED_CONTRACT_VERSION,
  type Disposer,
  type HostedApplication,
  type HostedApplicationOptions,
} from './contracts';

const DEFAULT_HOMEBASE_PORT = '17106';

/**
 * LMEval's HomeBase hosted-adapter factory
 * (docs/plans/2026-08-23-homebase-integration.md).
 *
 * Import-safety: this module and the factory call below must have zero side
 * effects — no I/O, no timers, no env reads. Unlike MemoryApi's sibling
 * adapter, none of LMEval's services construct module-scope singletons that
 * do I/O at *import* time (FileService's path constants are plain string
 * joins, not filesystem calls — see FileService.ts's configurePaths() doc
 * comment), so `buildApp` can be imported statically here with no dynamic-
 * import sequencing trick required. All real resource acquisition (path
 * configuration, seeding, the git-init check inside buildApp()) still only
 * happens inside initialize(), never at module load.
 *
 * LMEval is ESM ("type": "module") — this file uses a plain `export default`
 * (see ./index.ts), not LMApi's CJS `export =` trick (that exists only
 * because LMApi compiles to CommonJS).
 */
export default function createLmEvalAdapter(options: HostedApplicationOptions): HostedApplication {
  const state: {
    since: string;
    initialized: boolean;
    disposed: boolean;
    wsDisposer: WsDisposer | null;
    appDispose: (() => Promise<void>) | null;
  } = {
    since: new Date().toISOString(),
    initialized: false,
    disposed: false,
    wsDisposer: null,
    appDispose: null,
  };

  let router: HostedApplication['router'];

  const app: HostedApplication = {
    contractVersion: HOSTED_CONTRACT_VERSION,

    get router() {
      return router;
    },

    // build:hosted (package.json) writes the base-path-aware production
    // build into the same `dist/` standalone `npm run build` uses — re-run
    // build:hosted after any standalone build before HomeBase serves this.
    staticAssets: {
      directory: join(options.repositoryRoot, 'dist'),
      spaFallback: true,
    },

    async initialize() {
      parseHostedConfig(options.config);

      configurePaths({ dataRoot: options.dataPath, repoRoot: options.repositoryRoot });

      // Always loopback, never options.hostOrigin: hostOrigin is HomeBase's
      // *public* origin (may be a reverse-proxied HTTPS domain this same
      // process can't dial itself) — matches MemoryApi's verified-working
      // pattern (docs/plans/homebase-integration-plan.md in that repo, §4).
      const homebasePort = process.env.HOMEBASE_PORT ?? DEFAULT_HOMEBASE_PORT;
      reconfigureLmapiBaseUrl(`http://127.0.0.1:${homebasePort}/lmapi`);

      const built = buildApp({ appBasePath: options.basePath });
      router = built.router;
      state.appDispose = built.dispose;

      state.initialized = true;
      state.since = new Date().toISOString();
    },

    async attachRealtime(server: Server): Promise<Disposer> {
      state.wsDisposer = setupWebSocket(server, options.basePath);
      return () => state.wsDisposer?.();
    },

    async getStatus() {
      if (!state.initialized) {
        return { state: 'degraded' as const, summary: 'Not initialized', since: state.since };
      }
      try {
        await LmapiClient.getLoadedModels();
      } catch (err) {
        return {
          state: 'degraded' as const,
          summary: `LMApi unreachable: ${(err as Error).message}`,
          since: state.since,
        };
      }
      return { state: 'ready' as const, summary: 'LMEval is running', since: state.since };
    },

    async getActiveWork() {
      const activeIds = ExecutionService.getActiveEvalIds();
      if (activeIds.length === 0) {
        return { hasActiveWork: false };
      }
      return {
        hasActiveWork: true,
        description: `${activeIds.length} evaluation(s) running`,
      };
    },

    async dispose() {
      // Guarding on !state.appDispose too (not just state.disposed) so a
      // dispose() call before initialize() ever ran doesn't permanently
      // latch state.disposed — a later *real* dispose() after initialize()
      // must still fire.
      if (state.disposed || !state.appDispose) return;
      state.disposed = true;

      // WebSocket teardown is attachRealtime()'s returned Disposer's job —
      // HomeBase calls it separately, not duplicated here.
      await state.appDispose();
    },
  };

  return app;
}
