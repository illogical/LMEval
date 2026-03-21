import { useState, useEffect } from 'react';
import type { LmapiServerStatus } from '../types/lmapi';

export interface ServerModelGroup {
  name: string;
  models: string[];
}

export interface SelectedModel {
  serverName: string;
  modelName: string;
}

export function modelKey(m: SelectedModel): string {
  return `${m.serverName}::${m.modelName}`;
}

interface UseModelsByServerResult {
  servers: ServerModelGroup[];
  loading: boolean;
  error: string | null;
}

export function useModelsByServer(): UseModelsByServerResult {
  const [servers, setServers] = useState<ServerModelGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Call LMApi directly via the /lmapi Vite proxy — same pattern as the old useModels hook.
    // This avoids requiring the backend server (port 3200) for model discovery.
    fetch('/lmapi/api/servers')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch servers: ${res.statusText}`);
        return res.json() as Promise<LmapiServerStatus[]>;
      })
      .then(data => {
        if (cancelled) return;
        const groups: ServerModelGroup[] = data
          .filter(s => s.isOnline && s.models.length > 0)
          .map(s => ({
            name: s.config.name,
            models: [...s.models].sort((a, b) => a.localeCompare(b)),
          }));
        setServers(groups);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { servers, loading, error };
}
