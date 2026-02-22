import { useEffect, useState, useMemo } from 'react';
import { useEval } from '../../context/EvalContext';
import { evalApi } from '../../api/eval';

interface ModelEntry {
  serverId: string;
  serverName: string;
  modelId: string;
  isRunning: boolean;
}

export function ModelSelector() {
  const { state, dispatch } = useEval();
  const { selectedModels } = state;
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    evalApi.listModels()
      .then(setModels)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const filtered = models.filter(m =>
      m.modelId.toLowerCase().includes(search.toLowerCase()) ||
      m.serverName.toLowerCase().includes(search.toLowerCase())
    );
    const map = new Map<string, ModelEntry[]>();
    for (const m of filtered) {
      if (!map.has(m.serverName)) map.set(m.serverName, []);
      const group = map.get(m.serverName);
      if (group) group.push(m);
    }
    return map;
  }, [models, search]);

  const toggle = (modelId: string) => dispatch({ type: 'TOGGLE_MODEL', modelId });

  const selectAllLocal = () => {
    const localIds = models.filter(m => !m.modelId.startsWith('openrouter')).map(m => m.modelId);
    dispatch({ type: 'SET_SELECTED_MODELS', models: Array.from(new Set([...selectedModels, ...localIds])) });
  };

  const clearAll = () => dispatch({ type: 'SET_SELECTED_MODELS', models: [] });

  if (loading) {
    return (
      <div className="p-3">
        <div className="text-xs animate-pulse" style={{ color: 'var(--text-secondary)' }}>Loading models…</div>
        {[1, 2, 3].map(i => (
          <div key={i} className="h-6 rounded mt-2 animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-xs" style={{ color: 'var(--error)' }}>
        Failed to load models: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search models…"
        className="w-full text-xs px-2 py-1.5 rounded border focus:outline-none"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        aria-label="Search models"
      />

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={selectAllLocal}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          aria-label="Select all local models"
        >
          Select All Local
        </button>
        <button
          onClick={clearAll}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          aria-label="Clear model selection"
        >
          Clear
        </button>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-secondary)' }}>
          {selectedModels.length} selected
        </span>
      </div>

      {/* Groups */}
      <div className="overflow-y-auto max-h-48 flex flex-col gap-3">
        {grouped.size === 0 && (
          <div className="text-xs py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
            No models found
          </div>
        )}
        {Array.from(grouped.entries()).map(([serverName, mods]) => (
          <div key={serverName}>
            <div className="text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {serverName}
            </div>
            {mods.map(m => (
              <label
                key={m.modelId}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedModels.includes(m.modelId)}
                  onChange={() => toggle(m.modelId)}
                  className="accent-amber-500"
                  aria-label={`Select model ${m.modelId}`}
                />
                <span className="text-xs font-mono truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                  {m.modelId}
                </span>
                {m.isRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" title="Currently running" />
                )}
              </label>
            ))}
          </div>
        ))}
      </div>

      {/* Selected chips */}
      {selectedModels.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
          {selectedModels.map(m => (
            <span
              key={m}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--bg-elevated)', color: 'var(--accent)' }}
            >
              {m.split(':')[0]}
              <button
                onClick={() => toggle(m)}
                className="hover:text-rose-400 transition-colors"
                aria-label={`Remove ${m}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
