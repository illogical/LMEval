import { useState, useEffect } from 'react';
import { listPresets, createPreset, deletePreset } from '../../api/eval';
import type { EvalPreset } from '../../types/eval';
import './PresetSelector.css';

interface PresetSelectorProps {
  currentState: {
    templateId: string | null;
    testSuiteId: string | null;
    judgeModelId: string | null;
    enablePairwise: boolean;
    runsPerCell: number;
    modelIds: string[];
  };
  onLoad: (preset: EvalPreset) => void;
}

export function PresetSelector({ currentState, onLoad }: PresetSelectorProps) {
  const [presets, setPresets] = useState<EvalPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);

  useEffect(() => {
    listPresets().then(setPresets).catch(() => {});
  }, []);

  async function handleSave() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const preset = await createPreset({
        name: newName.trim(),
        modelIds: currentState.modelIds,
        templateId: currentState.templateId ?? undefined,
        testSuiteId: currentState.testSuiteId ?? undefined,
        judgeModelId: currentState.judgeModelId ?? undefined,
        enablePairwise: currentState.enablePairwise,
        runsPerCell: currentState.runsPerCell,
      });
      setPresets(prev => [preset, ...prev]);
      setNewName('');
      setShowSaveForm(false);
    } catch (err) {
      console.error('Failed to save preset:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deletePreset(id).catch(() => {});
    setPresets(prev => prev.filter(p => p.id !== id));
  }

  return (
    <div className="preset-selector">
      <div className="ps-actions">
        <select
          className="ps-select"
          onChange={e => {
            const p = presets.find(x => x.id === e.target.value);
            if (p) onLoad(p);
            e.target.value = '';
          }}
          defaultValue=""
          aria-label="Load preset"
        >
          <option value="">Load preset…</option>
          {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <button className="ps-save-btn" onClick={() => setShowSaveForm(!showSaveForm)}>
          {showSaveForm ? 'Cancel' : '💾 Save as Preset'}
        </button>
      </div>

      {showSaveForm && (
        <div className="ps-save-form">
          <input
            className="ps-name-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Preset name…"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button className="ps-confirm-btn" onClick={handleSave} disabled={saving || !newName.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {presets.length > 0 && (
        <div className="ps-list">
          {presets.map(p => (
            <div key={p.id} className="ps-item" onClick={() => onLoad(p)}>
              <span className="ps-name">{p.name}</span>
              <button className="ps-delete" onClick={e => handleDelete(p.id, e)} title="Delete preset">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
