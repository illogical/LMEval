import { useEffect, useRef, useState, useCallback } from 'react';
import type { EvalStreamEvent } from '../types/eval';

export interface EvalSocketState {
  progress: number;       // 0-100
  events: EvalStreamEvent[];
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  isCompleted: boolean;
  error: string | null;
}

export function useEvalSocket(evalId: string | null): EvalSocketState {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectDelayRef = useRef(1000);
  const unmountedRef = useRef(false);
  // Reconnects or duplicate deliveries can replay an older eval:progress event;
  // WS progress is a hint and must never report less durable work than already observed.
  const maxObservedCompletedRef = useRef(0);

  const [state, setState] = useState<EvalSocketState>({
    progress: 0,
    events: [],
    status: 'idle',
    isCompleted: false,
    error: null,
  });

  const connect = useCallback(() => {
    if (!evalId || unmountedRef.current) return;

    setState(s => ({ ...s, status: 'connecting' }));

    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:5173';
    // Namespaced under BASE_URL to match the server's basePath-scoped
    // upgrade path (server/ws.ts) — see WebSocketContext.tsx for the same
    // pattern.
    const path = `${import.meta.env.BASE_URL}ws/eval`.replace(/\/\/+/g, '/');
    const url = `${proto}//${host}${path}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) { ws.close(); return; }
        reconnectDelayRef.current = 500;
        setState(s => ({ ...s, status: 'open', error: null }));
      };

      ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data as string) as EvalStreamEvent;
          if (event.evalId !== evalId) return;

          setState(s => {
            const events = [...s.events, event];
            let progress = s.progress;
            let isCompleted = s.isCompleted;

            if (event.type === 'eval:progress') {
              const d = event.data as { completedCells?: number; totalCells?: number };
              if (d.totalCells && d.totalCells > 0) {
                const observed = Math.max(maxObservedCompletedRef.current, d.completedCells ?? 0);
                maxObservedCompletedRef.current = observed;
                progress = Math.round((observed / d.totalCells) * 100);
              }
            } else if (event.type === 'eval:completed') {
              progress = 100;
              isCompleted = true;
            }

            return { ...s, events, progress, isCompleted };
          });
        } catch (e) { console.debug('[useEvalSocket] Failed to parse WS message', e); }
      };

      ws.onclose = (evt) => {
        if (unmountedRef.current) return;
        console.warn(`[useEvalSocket] closed (code=${evt.code}, reason=${evt.reason || 'none'}, clean=${evt.wasClean})`);
        setState(s => ({ ...s, status: 'closed', error: `Connection closed (code ${evt.code}${evt.reason ? `: ${evt.reason}` : ''})` }));
        wsRef.current = null;
        const delay = Math.min(reconnectDelayRef.current * 2, 5000);
        reconnectDelayRef.current = delay;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (evt) => {
        console.warn('[useEvalSocket] error event', evt);
        setState(s => ({ ...s, status: 'error', error: 'WebSocket connection error' }));
        ws.close();
      };
    } catch (err) {
      setState(s => ({ ...s, status: 'error', error: (err as Error).message }));
    }
  }, [evalId]);

  useEffect(() => {
    unmountedRef.current = false;
    // Reset state when evalId changes
    maxObservedCompletedRef.current = 0;
    setState({ progress: 0, events: [], status: 'idle', isCompleted: false, error: null });
    clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    reconnectDelayRef.current = 500;

    if (evalId) {
      connect();
    }

    return () => {
      unmountedRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [evalId, connect]);

  return state;
}
