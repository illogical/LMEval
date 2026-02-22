import { useEval } from '../../context/EvalContext';

export function PromptTabs() {
  const { state, dispatch } = useEval();
  const { prompts, activePromptIdx } = state;

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 border-b overflow-x-auto"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', flexShrink: 0 }}
      role="tablist"
      aria-label="Prompt tabs"
    >
      {prompts.map((p, i) => (
        <div key={p.id} className="flex items-center gap-1 shrink-0">
          <button
            role="tab"
            aria-selected={i === activePromptIdx}
            onClick={() => dispatch({ type: 'SET_ACTIVE_PROMPT', idx: i })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              i === activePromptIdx
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            style={{
              background: i === activePromptIdx ? 'var(--bg-elevated)' : 'transparent',
              borderBottom: i === activePromptIdx ? `2px solid ${p.color}` : '2px solid transparent',
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: p.color }}
              aria-hidden="true"
            />
            {p.label}
          </button>
          {prompts.length > 1 && i === activePromptIdx && (
            <button
              onClick={() => dispatch({ type: 'REMOVE_PROMPT', idx: i })}
              className="text-[var(--text-secondary)] hover:text-[var(--error)] transition-colors text-xs px-1 rounded"
              aria-label={`Remove ${p.label}`}
              title="Remove prompt"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {prompts.length < 6 && (
        <button
          onClick={() => dispatch({ type: 'ADD_PROMPT' })}
          className="px-2 py-1 text-xs rounded transition-colors shrink-0"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Add prompt tab"
          title="Add prompt"
        >
          + Add
        </button>
      )}
    </div>
  );
}
