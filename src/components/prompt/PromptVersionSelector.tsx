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

  useEffect(() => {
    listPrompts().then(setPrompts).catch(() => {});
  }, []);

  const selectedManifest = prompts.find(p => p.id === selectedId);

  async function handleLoad() {
    if (!selectedManifest) return;
    setLoading(true);
    try {
      const { content } = await getPromptContent(selectedId, selectedVersion);
      onLoad(selectedManifest, content, selectedVersion);
    } catch (err) {
      console.error('Failed to load prompt:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pvs">
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
        <option value="">Load saved prompt…</option>
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
        className="pvs-load-btn"
        onClick={handleLoad}
        disabled={!selectedId || loading}
      >
        {loading ? 'Loading…' : 'Load'}
      </button>
    </div>
  );
}
