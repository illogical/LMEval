import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import type { HostedApplicationOptions } from '../contracts';

vi.mock('../../index', () => ({
  buildApp: vi.fn(),
}));
vi.mock('../../services/FileService', () => ({
  configurePaths: vi.fn(),
}));
vi.mock('../../config', () => ({
  reconfigureLmapiBaseUrl: vi.fn(),
}));
vi.mock('../../services/LmapiClient', () => ({
  LmapiClient: { getLoadedModels: vi.fn() },
}));
vi.mock('../../services/ExecutionService', () => ({
  ExecutionService: { getActiveEvalIds: vi.fn(() => []) },
}));
vi.mock('../../ws', () => ({
  setupWebSocket: vi.fn(),
}));

import { buildApp } from '../../index';
import { configurePaths } from '../../services/FileService';
import { reconfigureLmapiBaseUrl } from '../../config';
import { LmapiClient } from '../../services/LmapiClient';
import { ExecutionService } from '../../services/ExecutionService';
import { setupWebSocket } from '../../ws';
import createLmEvalAdapter from '../adapter';

const buildAppMock = vi.mocked(buildApp);
const configurePathsMock = vi.mocked(configurePaths);
const reconfigureLmapiBaseUrlMock = vi.mocked(reconfigureLmapiBaseUrl);
const getLoadedModelsMock = vi.mocked(LmapiClient.getLoadedModels);
const getActiveEvalIdsMock = vi.mocked(ExecutionService.getActiveEvalIds);
const setupWebSocketMock = vi.mocked(setupWebSocket);

function baseOptions(overrides: Partial<HostedApplicationOptions> = {}): HostedApplicationOptions {
  return {
    applicationId: 'lmeval',
    repositoryRoot: path.join('C:', 'fake', 'repo', 'LMEval'),
    basePath: '/lmeval/',
    hostOrigin: 'https://homebase.example.com',
    dataPath: path.join('C:', 'fake', 'data', 'lmeval'),
    config: undefined,
    logger: { child: vi.fn(), log: vi.fn(), flush: vi.fn() } as unknown as HostedApplicationOptions['logger'],
    ...overrides,
  };
}

describe('createLmEvalAdapter', () => {
  const fakeRouter = { __fake: 'router' } as unknown as ReturnType<typeof buildApp>['router'];
  const appDisposeMock = vi.fn(async () => {});
  const originalHomebasePort = process.env.HOMEBASE_PORT;

  beforeEach(() => {
    buildAppMock.mockReset().mockReturnValue({ router: fakeRouter, dispose: appDisposeMock });
    configurePathsMock.mockReset();
    reconfigureLmapiBaseUrlMock.mockReset();
    getLoadedModelsMock.mockReset().mockResolvedValue([]);
    getActiveEvalIdsMock.mockReset().mockReturnValue([]);
    setupWebSocketMock.mockReset();
    appDisposeMock.mockClear();
    delete process.env.HOMEBASE_PORT;
  });

  afterEach(() => {
    if (originalHomebasePort === undefined) {
      delete process.env.HOMEBASE_PORT;
    } else {
      process.env.HOMEBASE_PORT = originalHomebasePort;
    }
  });

  it('factory call has zero side effects', () => {
    createLmEvalAdapter(baseOptions());

    expect(configurePathsMock).not.toHaveBeenCalled();
    expect(buildAppMock).not.toHaveBeenCalled();
    expect(reconfigureLmapiBaseUrlMock).not.toHaveBeenCalled();
  });

  it('exposes the contract version, staticAssets, and no router before initialize()', () => {
    const options = baseOptions();
    const app = createLmEvalAdapter(options);

    expect(app.contractVersion).toBe(1);
    expect(app.router).toBeUndefined();
    expect(app.staticAssets).toEqual({
      directory: path.join(options.repositoryRoot, 'dist'),
      spaFallback: true,
    });
  });

  describe('initialize()', () => {
    it('configures data paths from options, reconfigures LMApi to loopback, then builds the app', async () => {
      const options = baseOptions();
      const app = createLmEvalAdapter(options);

      await app.initialize!();

      expect(configurePathsMock).toHaveBeenCalledWith({
        dataRoot: options.dataPath,
        repoRoot: options.repositoryRoot,
      });
      expect(reconfigureLmapiBaseUrlMock).toHaveBeenCalledWith('http://127.0.0.1:17106/lmapi');
      expect(buildAppMock).toHaveBeenCalled();
      expect(app.router).toBe(fakeRouter);

      const configureOrder = configurePathsMock.mock.invocationCallOrder[0];
      const buildOrder = buildAppMock.mock.invocationCallOrder[0];
      expect(configureOrder).toBeLessThan(buildOrder);
    });

    it('ignores hostOrigin and uses HOMEBASE_PORT for the loopback LMApi URL when set', async () => {
      process.env.HOMEBASE_PORT = '19999';
      const app = createLmEvalAdapter(baseOptions());

      await app.initialize!();

      expect(reconfigureLmapiBaseUrlMock).toHaveBeenCalledWith('http://127.0.0.1:19999/lmapi');
    });

    it('rejects clearly on an invalid adapterConfig without touching paths or building the app', async () => {
      const app = createLmEvalAdapter(baseOptions({ config: 'not-an-object' as unknown as Record<string, unknown> }));

      await expect(app.initialize!()).rejects.toThrow(/Invalid LMEval adapterConfig/);
      expect(configurePathsMock).not.toHaveBeenCalled();
      expect(buildAppMock).not.toHaveBeenCalled();
    });
  });

  describe('getStatus()', () => {
    it('reports degraded before initialize()', async () => {
      const app = createLmEvalAdapter(baseOptions());
      const status = await app.getStatus();
      expect(status.state).toBe('degraded');
      expect(status.summary).toMatch(/not initialized/i);
    });

    it('reports degraded when LMApi is unreachable', async () => {
      const app = createLmEvalAdapter(baseOptions());
      await app.initialize!();
      getLoadedModelsMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const status = await app.getStatus();
      expect(status.state).toBe('degraded');
      expect(status.summary).toMatch(/LMApi unreachable/);
    });

    it('reports ready once initialized and LMApi is reachable', async () => {
      const app = createLmEvalAdapter(baseOptions());
      await app.initialize!();

      const status = await app.getStatus();
      expect(status.state).toBe('ready');
    });
  });

  describe('getActiveWork()', () => {
    it('reports no active work when nothing is running', async () => {
      const app = createLmEvalAdapter(baseOptions());
      const work = await app.getActiveWork!();
      expect(work.hasActiveWork).toBe(false);
    });

    it('reports active work with a count when evaluations are running', async () => {
      getActiveEvalIdsMock.mockReturnValue(['eval-1', 'eval-2']);
      const app = createLmEvalAdapter(baseOptions());
      const work = await app.getActiveWork!();
      expect(work.hasActiveWork).toBe(true);
      expect(work.description).toMatch(/2 evaluation/);
    });
  });

  describe('attachRealtime()', () => {
    it('namespaces the WebSocket server under basePath and returns a disposer', async () => {
      const wsDisposeMock = vi.fn();
      setupWebSocketMock.mockReturnValue(wsDisposeMock);

      const options = baseOptions();
      const app = createLmEvalAdapter(options);
      const fakeServer = {} as import('node:http').Server;

      const disposer = await app.attachRealtime!(fakeServer);
      expect(setupWebSocketMock).toHaveBeenCalledWith(fakeServer, options.basePath);

      await disposer?.();
      expect(wsDisposeMock).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('is idempotent (safe to call twice, and before initialize())', async () => {
      const app = createLmEvalAdapter(baseOptions());
      await expect(app.dispose!()).resolves.not.toThrow();

      await app.initialize!();
      await app.dispose!();
      await app.dispose!();

      expect(appDisposeMock).toHaveBeenCalledTimes(1);
    });
  });
});
