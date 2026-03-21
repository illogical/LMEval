import { useState, useEffect } from 'react';
import { listTemplates, generateTemplate } from '../../api/eval';
import type { EvalTemplate } from '../../types/eval';
import './TemplateSelector.css';

interface TemplateSelectorProps {
  value: string | null;
  onChange: (id: string | null) => void;
  promptContent?: string;
}

export function TemplateSelector({ value, onChange, promptContent }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<EvalTemplate[]>([]);
  const [generating, setGenerating] = useState(false);
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>({});

  useEffect(() => {
    listTemplates().then(setTemplates).catch(() => {});
  }, []);

  const selected = templates.find(t => t.id === value);

  async function handleGenerate() {
    if (!promptContent) return;
    setGenerating(true);
    try {
      await generateTemplate(promptContent);
      const refreshed = await listTemplates();
      setTemplates(refreshed);
    } catch (err) {
      console.error('Failed to generate template:', err);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="template-selector">
      <div className="ts-row">
        <select
          className="ts-select"
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          aria-label="Select evaluation template"
        >
          <option value="">No template (simple scoring)</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name}{t.builtIn ? ' (built-in)' : ''}</option>
          ))}
        </select>

        {promptContent && (
          <button className="ts-btn ts-btn-generate" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : '✨ Auto-Generate'}
          </button>
        )}

        {selected && (
          <button className="ts-btn ts-btn-customize" onClick={() => setShowWeights(!showWeights)}>
            ⚙ Customize
          </button>
        )}
      </div>

      {selected && (
        <p className="ts-description">{selected.description}</p>
      )}

      {showWeights && selected && (
        <div className="ts-weights">
          <p className="ts-weights-title">Perspective Weights</p>
          {selected.perspectives.map(p => (
            <div key={p.id} className="ts-weight-row">
              <label className="ts-weight-label">{p.name}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={weights[p.id] ?? p.weight}
                onChange={e => setWeights(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
                className="ts-weight-slider"
              />
              <span className="ts-weight-val">{((weights[p.id] ?? p.weight) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
