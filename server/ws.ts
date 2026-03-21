import { setBroadcast } from './services/ExecutionService';

// WebSocket integration (requires ws package or native WebSocket support)
// Broadcast is available for future integration
export function setupWebSocket(_server: unknown) {
  setBroadcast((event) => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[eval:event] ${event.type} (${event.evalId})`);
    }
  });
}
