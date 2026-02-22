import type { EvalStreamEvent } from '../src/types/eval.ts';

interface WsData {
  id: string;
}

type BunWs = {
  send(data: string): void;
  readyState: number;
};

const clients = new Set<BunWs>();

export const wsHandlers = {
  open(ws: BunWs) {
    clients.add(ws);
  },
  close(ws: BunWs) {
    clients.delete(ws);
  },
  message(_ws: BunWs, _msg: string | Buffer) {
    // No-op: clients only receive
  }
};

export function broadcast(event: EvalStreamEvent): void {
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    try {
      ws.send(msg);
    } catch { /* ignore disconnected */ }
  }
}

export function getClientCount(): number {
  return clients.size;
}
