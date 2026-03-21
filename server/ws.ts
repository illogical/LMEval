import { setBroadcast } from './services/ExecutionService';
import type { EvalStreamEvent } from '../src/types/eval';

let broadcastFn: ((event: EvalStreamEvent) => void) | null = null;

export function broadcast(event: EvalStreamEvent) {
  broadcastFn?.(event);
}

export function setupWebSocket(server: unknown) {
  // Try to use the ws package for real WebSocket support
  let WebSocketServer: typeof import('ws').WebSocketServer | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WebSocketServer = require('ws').WebSocketServer;
  } catch {
    // ws not available — fall back to logging
  }

  if (WebSocketServer && server) {
    try {
      const wss = new WebSocketServer({ server: server as import('http').Server, path: '/ws/eval' });

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
    } catch (err) {
      console.warn('[eval:ws] Failed to start WebSocket server:', err);
      broadcastFn = logBroadcast;
    }
  } else {
    broadcastFn = logBroadcast;
  }

  setBroadcast(broadcastFn ?? logBroadcast);
}

function logBroadcast(event: EvalStreamEvent) {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[eval:event] ${event.type} (${event.evalId})`);
  }
}
