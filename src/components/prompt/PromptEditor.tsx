import { useState, useEffect } from 'react';
import { useEval } from '../../context/EvalContext';
import { evalApi } from '../../api/eval';
import type { PromptManifest } from '../../types/eval';

export function PromptEditor() {
  const { state, dispatch } = useEval();
  const { prompts, activePromptIdx } = state;
  const prompt = prompts[activePromptIdx];

  const [savedPrompts, setSavedPrompts] = useState<PromptManifest[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveNotes, setSaveNotes] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);

  useEffect(() => {
    evalApi.listPrompts().then(setSavedPrompts).catch(() => {});
  }, []);

  // Estimate tokens (rough: chars / 4)
  useEffect(() => {
    setTokenCount(Math.round(prompt.content.length / 4));
  }, [prompt.content]);

  const updatePrompt = (patch: Partial<import('../../context/EvalContext').PromptTab>) => {
    dispatch({ type: 'UPDATE_PROMPT', idx: activePromptIdx, patch });
  };

  const handleModeChange = async (mode: 'editor' | 'file' | 'saved') => {
    updatePrompt({ mode });
    if (mode === 'saved' && savedPrompts.length === 0) {
      const list = await evalApi.listPrompts().catch(() => []);
      setSavedPrompts(list);
    }
  };

  const handleSavedSelect = async (promptId: string, version: number) => {
    try {
      const content = await evalApi.getPromptContent(promptId, version);
      updatePrompt({ content, savedPromptId: promptId, savedVersion: version });
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (prompt.savedPromptId) {
        await evalApi.savePromptVersion(prompt.savedPromptId, { content: prompt.content, notes: saveNotes });
      } else {
        const manifest = await evalApi.createPrompt({ name: prompt.label, content: prompt.content, notes: saveNotes });
        updatePrompt({ savedPromptId: manifest.id });
        setSavedPrompts(prev => [...prev, manifest]);
      }
      setShowSaveForm(false);
      setSaveNotes('');
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--border)', flexShrink: 0 }}
      >
        <div className="flex rounded overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {(['editor', 'file', 'saved'] as const).map(m => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className="px-3 py-1 text-xs capitalize transition-colors"
              style={{
                background: prompt.mode === m ? 'var(--accent)' : 'var(--bg-elevated)',
                color: prompt.mode === m ? '#000' : 'var(--text-secondary)',
              }}
              aria-pressed={prompt.mode === m}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Token count */}
        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
          ~{tokenCount} tokens
        </span>
      </div>

      {/* Saved mode: version dropdown */}
      {prompt.mode === 'saved' && (
        <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)', flexShrink: 0 }}>
          <select
            className="flex-1 text-xs rounded px-2 py-1.5 border"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            onChange={e => {
              const [pId, ver] = e.target.value.split('@');
              handleSavedSelect(pId, parseInt(ver));
            }}
            value={prompt.savedPromptId ? `${prompt.savedPromptId}@${prompt.savedVersion ?? 1}` : ''}
            aria-label="Select saved prompt version"
          >
            <option value="">-- Select saved prompt --</option>
            {savedPrompts.map(sp =>
              sp.versions.map(v => (
                <option key={`${sp.id}@${v.version}`} value={`${sp.id}@${v.version}`}>
                  {sp.name} v{v.version}{v.notes ? ` – ${v.notes}` : ''}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      {/* Text area */}
      <textarea
        value={prompt.content}
        onChange={e => updatePrompt({ content: e.target.value })}
        placeholder="Enter your system prompt here…"
        className="flex-1 w-full resize-none p-3 text-sm font-mono focus:outline-none"
        style={{
          background: 'var(--bg-base)',
          color: 'var(--text-primary)',
          border: 'none',
          lineHeight: 1.6,
        }}
        aria-label="Prompt content"
        spellCheck={false}
        readOnly={prompt.mode === 'saved'}
      />

      {/* Metadata bar */}
      <div
        className="flex items-center justify-between px-3 py-2 border-t gap-2"
        style={{ borderColor: 'var(--border)', flexShrink: 0, background: 'var(--bg-surface)' }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            onClick={() => setShowSaveForm(s => !s)}
            className="text-xs px-3 py-1 rounded transition-colors"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            aria-label="Save prompt"
          >
            Save Version
          </button>
        </div>
      </div>

      {/* Save form */}
      {showSaveForm && (
        <div className="px-3 py-2 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)', flexShrink: 0 }}>
          <input
            value={saveNotes}
            onChange={e => setSaveNotes(e.target.value)}
            placeholder="Version notes…"
            className="flex-1 text-xs px-2 py-1.5 rounded border"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            aria-label="Version notes"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#000' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => setShowSaveForm(false)}
            className="text-xs px-2 py-1.5 rounded"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
