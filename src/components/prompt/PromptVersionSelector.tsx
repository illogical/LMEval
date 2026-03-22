import { useState, useEffect } from 'react';
import { listPrompts, getPromptContent } from '../../api/eval';
import type { PromptManifest } from '../../types/eval';
import './PromptVersionSelector.css';

interface PromptVersionSelectorProps {
  onLoad: (manifest: PromptManifest, content: string, version: number) => void;
}

export function PromptVersionSelector({ onLoad }: PromptVersionSelectorProps) {
  const [prompts, setPrompts] = useState<PromptManifest[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadSuccess, setLoadSuccess] = useState(false);

  useEffect(() => {
    listPrompts().then(setPrompts).catch(() => {});
  }, []);

  const selectedManifest = prompts.find(p => p.id === selectedId);

  async function handleLoad() {
    console.log('[PVS] handleLoad called', { selectedId, selectedVersion });
    if (!selectedManifest) {
      console.warn('[PVS] handleLoad: no selectedManifest — selectedId:', selectedId, 'prompts:', prompts.length);
      return;
    }
    console.log('[PVS] loading content for', { id: selectedId, version: selectedVersion });
    setLoading(true);
    setLoadError(null);
    setLoadSuccess(false);
    try {
      const { content } = await getPromptContent(selectedId, selectedVersion);
      console.log('[PVS] content received, length:', content?.length);
      onLoad(selectedManifest, content, selectedVersion);
      console.log('[PVS] onLoad called successfully');
      setLoadSuccess(true);
      setTimeout(() => setLoadSuccess(false), 2000);
    } catch (err) {
      console.error('[PVS] Failed to load prompt:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load prompt');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pvs">
      <span className="pvs-label">Load saved:</span>
      <select
        className="pvs-select"
        value={selectedId}
        onChange={e => {
          setSelectedId(e.target.value);
          const m = prompts.find(p => p.id === e.target.value);
          if (m) setSelectedVersion(m.versions[m.versions.length - 1]?.version ?? 1);
        }}
        aria-label="Select prompt"
      >
        <option value="">Select a prompt…</option>
        {prompts.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {selectedManifest && (
        <select
          className="pvs-select pvs-version"
          value={selectedVersion}
          onChange={e => setSelectedVersion(Number(e.target.value))}
          aria-label="Select version"
        >
          {[...selectedManifest.versions].reverse().map(v => (
            <option key={v.version} value={v.version}>v{v.version} — {new Date(v.createdAt).toLocaleDateString()}</option>
          ))}
        </select>
      )}

      <button
        type="button"
        className="pvs-load-btn"
        onClick={handleLoad}
        disabled={!selectedId || loading}
      >
        {loading ? 'Loading…' : loadSuccess ? '✓ Loaded' : 'Load'}
      </button>
      {loadError && <span className="pvs-error">{loadError}</span>}
    </div>
  );
}
