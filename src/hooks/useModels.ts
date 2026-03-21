import { useState, useEffect } from 'react';
import { getLoadedModels } from '../api/lmapi';

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

    getLoadedModels()
      .then((modelNames: string[]) => {
        if (cancelled) return;
        const opts: ModelOption[] = modelNames.map(m => ({
          value: m,
          label: m,
          serverName: 'Available',
        }));
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
