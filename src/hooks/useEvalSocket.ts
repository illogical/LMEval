import { useEffect, useRef, useState } from 'react';
import type { LiveFeedEntry } from '../context/EvalContext';

interface Progress {
  phase: number;
  totalPhases: number;
  completedCells: number;
  totalCells: number;
  elapsedMs: number;
}

interface UseEvalSocketResult {
  progress: Progress | null;
  liveFeed: LiveFeedEntry[];
  isCompleted: boolean;
  error: string | null;
}

export function useEvalSocket(evalId: string | null): UseEvalSocketResult {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [liveFeed, setLiveFeed] = useState<LiveFeedEntry[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!evalId) return;

    setProgress(null);
    setLiveFeed([]);
    setIsCompleted(false);
    setError(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws/eval`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', evalId }));
    };

    ws.onmessage = (evt) => {
      let event: { type: string; evalId: string; data?: unknown; timestamp: string };
      try {
        event = JSON.parse(evt.data as string);
      } catch {
        return;
      }
      if (event.evalId !== evalId) return;

      switch (event.type) {
        case 'eval:progress': {
          const d = event.data as Progress;
          setProgress(d);
          break;
        }
        case 'cell:completed': {
          const d = event.data as {
            cellId: string;
            modelId: string;
            testCaseName: string;
            passed: boolean | null;
            score: number | null;
          };
          const entry: LiveFeedEntry = { ...d, timestamp: Date.now() };
          setLiveFeed(prev => [entry, ...prev].slice(0, 100));
          break;
        }
        case 'cell:failed': {
          const d = event.data as { cellId: string; modelId: string; testCaseName: string };
          const entry: LiveFeedEntry = {
            cellId: d.cellId,
            modelId: d.modelId,
            testCaseName: d.testCaseName,
            passed: false,
            score: null,
            timestamp: Date.now(),
          };
          setLiveFeed(prev => [entry, ...prev].slice(0, 100));
          break;
        }
        case 'eval:completed':
          setIsCompleted(true);
          break;
        case 'eval:failed': {
          const d = event.data as { message?: string };
          setError(d?.message ?? 'Evaluation failed');
          break;
        }
      }
    };

    ws.onerror = () => setError('WebSocket connection error');
    ws.onclose = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [evalId]);

  return { progress, liveFeed, isCompleted, error };
}
