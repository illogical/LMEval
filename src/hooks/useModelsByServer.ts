import { useState, useEffect } from 'react';
import { listModels } from '../api/eval';

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

    // Match the agent API's server-pinned, routability-filtered catalog so a
    // browser draft cannot select a model the backend will reject.
    listModels()
      .then(data => {
        if (cancelled) return;
        const groups: ServerModelGroup[] = data.servers.map(server => ({
          name: server.name,
          models: [...server.models].sort((a, b) => a.localeCompare(b)),
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
