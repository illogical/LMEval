import { useState, useEffect } from 'react';
import { getServers } from '../api/lmapi';
import type { LmapiServerStatus } from '../types/lmapi';

export interface ModelOption {
  value: string;
  label: string;
  serverName: string;
}

interface UseModelsResult {
  models: ModelOption[];
  loading: boolean;
  error: string | null;
}

export function useModels(): UseModelsResult {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getServers()
      .then((servers: LmapiServerStatus[]) => {
        if (cancelled) return;
        const opts: ModelOption[] = servers
          .filter(s => s.isOnline)
          .flatMap(s =>
            s.models.map(m => ({
              value: m,
              label: m,
              serverName: s.config.name,
            }))
          );
        setModels(opts);
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

  return { models, loading, error };
}
