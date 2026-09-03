import type { Server } from 'http';
import { WebSocketServer } from 'ws';
import { setBroadcast } from './services/ExecutionService';
import type { EvalStreamEvent } from '../src/types/eval';

let broadcastFn: ((event: EvalStreamEvent) => void) | null = null;

export function broadcast(event: EvalStreamEvent) {
  broadcastFn?.(event);
}

export type Disposer = () => Promise<void> | void;

/**
 * Namespaces the WebSocket upgrade path under `basePath` ("/" standalone,
 * "/lmeval/" hosted) so it doesn't intercept upgrade requests for sibling
 * apps sharing HomeBase's http.Server (docs/plans/2026-08-23-homebase-integration.md §5).
 */
export function setupWebSocket(server: Server, basePath: string = '/'): Disposer {
  const path = `${basePath}ws/eval`.replace(/\/\/+/g, '/');
  const wss = new WebSocketServer({ server, path });

  broadcastFn = (event: EvalStreamEvent) => {
    const msg = JSON.stringify(event);
    wss.clients.forEach(client => {
      if (client.readyState === 1 /* OPEN */) {
        client.send(msg);
      }
    });
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[eval:ws] broadcast ${event.type} (${event.evalId}) to ${wss.clients.size} clients`);
    }
  };

  wss.on('connection', (ws) => {
    if (process.env.NODE_ENV !== 'test') {
      console.log('[eval:ws] client connected');
    }
    ws.on('close', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log('[eval:ws] client disconnected');
      }
    });
  });

  setBroadcast(broadcastFn);

  return () => {
    setBroadcast(() => {});
    broadcastFn = null;
    for (const client of wss.clients) {
      client.terminate();
    }
    return new Promise(resolve => wss.close(() => resolve()));
  };
}
