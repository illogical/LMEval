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
    const url = `${proto}//${host}/ws/eval`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) { ws.close(); return; }
        reconnectDelayRef.current = 1000;
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
                progress = Math.round(((d.completedCells ?? 0) / d.totalCells) * 100);
              }
            } else if (event.type === 'eval:completed') {
              progress = 100;
              isCompleted = true;
            }

            return { ...s, events, progress, isCompleted };
          });
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        setState(s => ({ ...s, status: 'closed' }));
        wsRef.current = null;
        const delay = Math.min(reconnectDelayRef.current * 2, 30000);
        reconnectDelayRef.current = delay;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
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
    setState({ progress: 0, events: [], status: 'idle', isCompleted: false, error: null });
    clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    reconnectDelayRef.current = 1000;

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
