import { useState } from 'react';
import { useEval } from '../../context/EvalContext';
import type { TestCase } from '../../types/eval';

let idCounter = 1;
const newCase = (userMessage = ''): TestCase => ({
  id: `tc-${Date.now()}-${idCounter++}`,
  name: `Case ${idCounter}`,
  userMessage,
});

export function TestCaseEditor() {
  const { state, dispatch } = useEval();
  const { testCases } = state;
  const [mode, setMode] = useState<'quick' | 'suite'>('quick');
  const [quickText, setQuickText] = useState('');

  const applyQuick = () => {
    const lines = quickText.split('\n').filter(l => l.trim());
    const cases = lines.map(l => newCase(l.trim()));
    if (cases.length) dispatch({ type: 'SET_TEST_CASES', cases });
  };

  const addRow = () => {
    dispatch({ type: 'SET_TEST_CASES', cases: [...testCases, newCase()] });
  };

  const removeRow = (id: string) => {
    dispatch({ type: 'SET_TEST_CASES', cases: testCases.filter(c => c.id !== id) });
  };

  const updateRow = (id: string, patch: Partial<TestCase>) => {
    dispatch({
      type: 'SET_TEST_CASES',
      cases: testCases.map(c => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <div className="flex rounded overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {(['quick', 'suite'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3 py-1 text-xs capitalize transition-colors"
              style={{
                background: mode === m ? 'var(--accent)' : 'var(--bg-elevated)',
                color: mode === m ? '#000' : 'var(--text-secondary)',
              }}
              aria-pressed={mode === m}
            >
              {m === 'quick' ? 'Quick' : 'Suite'}
            </button>
          ))}
        </div>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-secondary)' }}>
          {testCases.length} case{testCases.length !== 1 ? 's' : ''}
        </span>
      </div>

      {mode === 'quick' ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={quickText}
            onChange={e => setQuickText(e.target.value)}
            placeholder={"Enter one user message per line:\nWhat is the capital of France?\nSummarize this document…"}
            rows={4}
            className="w-full text-xs font-mono rounded border p-2 resize-y focus:outline-none"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            aria-label="Quick test case input"
          />
          <button
            onClick={applyQuick}
            disabled={!quickText.trim()}
            className="self-start text-xs px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#000' }}
            aria-label="Apply quick test cases"
          >
            Apply
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto max-h-56">
          {testCases.length === 0 && (
            <div className="text-xs py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
              No test cases yet. Click "+ Add Row" to add one.
            </div>
          )}
          {testCases.map(tc => (
            <div
              key={tc.id}
              className="flex items-center gap-2 rounded border p-2"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
            >
              <input
                value={tc.name}
                onChange={e => updateRow(tc.id, { name: e.target.value })}
                className="w-24 text-xs px-1 py-0.5 rounded border bg-transparent focus:outline-none"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                placeholder="Name"
                aria-label={`Test case name for ${tc.id}`}
              />
              <input
                value={tc.userMessage}
                onChange={e => updateRow(tc.id, { userMessage: e.target.value })}
                className="flex-1 text-xs px-1 py-0.5 rounded border bg-transparent focus:outline-none font-mono"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                placeholder="User message…"
                aria-label={`User message for ${tc.name}`}
              />
              <button
                onClick={() => removeRow(tc.id)}
                className="text-xs px-1.5 py-0.5 rounded hover:text-rose-400 transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                aria-label={`Remove test case ${tc.name}`}
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={addRow}
            className="self-start text-xs px-3 py-1.5 rounded mt-1 transition-colors"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            aria-label="Add test case row"
          >
            + Add Row
          </button>
        </div>
      )}
    </div>
  );
}
