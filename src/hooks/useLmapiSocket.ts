import { useEffect, useState } from 'react';
import type { LmapiServerStatus } from '../types/lmapi';

interface UseLmapiSocketResult {
  serverStatuses: LmapiServerStatus[];
}

export function useLmapiSocket(): UseLmapiSocketResult {
  const [serverStatuses, setServerStatuses] = useState<LmapiServerStatus[]>([]);

  useEffect(() => {
    let socket: { disconnect(): void } | null = null;
    let cancelled = false;

    // Dynamically import socket.io-client to avoid SSR issues
    import('socket.io-client').then(({ io }) => {
      if (cancelled) return;
      const s = io({ path: '/socket.io', transports: ['websocket'] });
      socket = s;

      s.on('server:status', (statuses: LmapiServerStatus[]) => {
        setServerStatuses(statuses);
      });

      s.on('connect_error', () => {
        // Silently fail – LMApi socket is optional
      });
    }).catch(() => {
      // socket.io-client unavailable, skip
    });

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, []);

  return { serverStatuses };
}
