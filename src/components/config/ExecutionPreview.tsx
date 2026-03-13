import { useEval } from '../../context/EvalContext';

const WARN_THRESHOLD = 50;
const TOKENS_PER_CELL_ESTIMATE = 500;
const MS_PER_CELL_ESTIMATE = 3000;

export function ExecutionPreview() {
  const { state } = useEval();
  const { prompts, selectedModels, testCases, runsPerCombination } = state;

  const numPrompts = prompts.length;
  const numModels = selectedModels.length;
  const numTests = Math.max(testCases.length, 1);
  const totalCells = numPrompts * numModels * numTests * runsPerCombination;
  const estimatedTokens = totalCells * TOKENS_PER_CELL_ESTIMATE;
  const estimatedMs = totalCells * MS_PER_CELL_ESTIMATE;

  const formatMs = (ms: number) => {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  };

  const formatK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Matrix grid */}
      <div
        className="rounded border p-3"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
      >
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
          Execution Matrix
        </div>
        <div className="grid grid-cols-4 gap-1 text-xs text-center">
          {[
            { label: 'Prompts', value: numPrompts, color: 'var(--accent)' },
            { label: 'Models', value: numModels, color: 'var(--info)' },
            { label: 'Test Cases', value: numTests, color: 'var(--success)' },
            { label: 'Runs', value: runsPerCombination, color: 'var(--text-secondary)' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded p-2"
              style={{ background: 'var(--bg-surface)' }}
            >
              <div className="text-lg font-bold font-mono" style={{ color }}>{value}</div>
              <div style={{ color: 'var(--text-secondary)' }}>{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-center font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
          = {totalCells} completions
        </div>
      </div>

      {/* Warning */}
      {totalCells > WARN_THRESHOLD && (
        <div className="rounded border px-3 py-2 text-xs" style={{ background: '#451a03', borderColor: 'var(--warning)', color: '#fde68a' }}>
          ⚠️ Large evaluation: {totalCells} completions may take significant time and tokens.
        </div>
      )}

      {/* Estimates */}
      <div className="grid grid-cols-3 gap-2 text-xs text-center">
        {[
          { label: 'Est. Tokens', value: formatK(estimatedTokens) },
          { label: 'Est. Time', value: numModels === 0 ? '—' : formatMs(estimatedMs) },
          { label: 'Cells', value: String(totalCells) },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded p-2"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            <div className="font-bold font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{value}</div>
            <div>{label}</div>
          </div>
        ))}
      </div>

      {numModels === 0 && (
        <div className="text-xs text-center py-2" style={{ color: 'var(--text-secondary)' }}>
          Select at least one model to run an evaluation.
        </div>
      )}
    </div>
  );
}
