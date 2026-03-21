import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { EvalStreamEvent } from '../types/eval';

interface WebSocketContextValue {
  subscribe: (handler: (event: EvalStreamEvent) => void) => () => void;
  isConnected: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/eval`;
})();

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<(event: EvalStreamEvent) => void>>(new Set());
  const [isConnected, setIsConnected] = useState(false);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) { ws.close(); return; }
        setIsConnected(true);
        reconnectDelayRef.current = 1000;
      };

      ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data as string) as EvalStreamEvent;
          handlersRef.current.forEach(h => h(event));
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        if (!unmountedRef.current) {
          const delay = Math.min(reconnectDelayRef.current * 2, 30000);
          reconnectDelayRef.current = delay;
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available in test environment
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((handler: (event: EvalStreamEvent) => void) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  return (
    <WebSocketContext.Provider value={{ subscribe, isConnected }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider');
  return ctx;
}
