import { useEffect, useState } from 'react';
import { useEval } from '../../context/EvalContext';
import { evalApi } from '../../api/eval';
import type { EvalTemplate } from '../../types/eval';

export function TemplateSelector() {
  const { state, dispatch } = useEval();
  const { template, prompts, activePromptIdx } = state;
  const [templates, setTemplates] = useState<EvalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [customJson, setCustomJson] = useState('');
  const [jsonError, setJsonError] = useState('');

  useEffect(() => {
    evalApi.listTemplates()
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (id: string) => {
    const t = templates.find(t => t.id === id) ?? null;
    dispatch({ type: 'SET_TEMPLATE', template: t });
    if (t) {
      setCustomJson(JSON.stringify(t, null, 2));
    }
  };

  const handleAutoGenerate = async () => {
    const content = prompts[activePromptIdx]?.content;
    if (!content) return;
    setGenerating(true);
    try {
      const generated = await evalApi.generateTemplate(content);
      setTemplates(prev => [generated, ...prev.filter(t => t.id !== generated.id)]);
      dispatch({ type: 'SET_TEMPLATE', template: generated });
      setCustomJson(JSON.stringify(generated, null, 2));
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const applyCustom = () => {
    setJsonError('');
    try {
      const parsed = JSON.parse(customJson) as EvalTemplate;
      dispatch({ type: 'SET_TEMPLATE', template: parsed });
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Selector */}
      <div className="flex items-center gap-2">
        {loading ? (
          <div className="flex-1 h-7 rounded animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
        ) : (
          <select
            value={template?.id ?? ''}
            onChange={e => handleSelect(e.target.value)}
            className="flex-1 text-xs rounded px-2 py-1.5 border focus:outline-none"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            aria-label="Select evaluation template"
          >
            <option value="">-- No template --</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.isBuiltIn ? ' (built-in)' : ''}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleAutoGenerate}
          disabled={generating || !prompts[activePromptIdx]?.content}
          className="text-xs px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-50 shrink-0"
          style={{ background: 'var(--info)', color: '#fff' }}
          aria-label="Auto-generate template from current prompt"
          title="Auto-generate template from current prompt"
        >
          {generating ? 'Generating…' : 'Auto-Generate'}
        </button>
      </div>

      {template && (
        <div className="text-xs rounded p-2" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
          {template.description}
        </div>
      )}

      {/* Customize */}
      {template && (
        <button
          onClick={() => setCustomizing(c => !c)}
          className="self-start text-xs px-2 py-1 rounded transition-colors"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
          aria-expanded={customizing}
        >
          {customizing ? 'Hide' : 'Customize'}
        </button>
      )}

      {customizing && (
        <div className="flex flex-col gap-2">
          <textarea
            value={customJson}
            onChange={e => setCustomJson(e.target.value)}
            rows={6}
            className="w-full text-xs font-mono rounded border p-2 resize-y focus:outline-none"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: jsonError ? 'var(--error)' : 'var(--border)',
              color: 'var(--text-primary)',
            }}
            spellCheck={false}
            aria-label="Template JSON editor"
          />
          {jsonError && <div className="text-xs" style={{ color: 'var(--error)' }}>{jsonError}</div>}
          <button
            onClick={applyCustom}
            className="self-start text-xs px-3 py-1.5 rounded font-medium"
            style={{ background: 'var(--accent)', color: '#000' }}
            aria-label="Apply customized template"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
