import { useState, useRef, useEffect } from 'react';
import { useEval } from '../../context/EvalContext';

interface TopBarProps {
  onRun: () => void;
  onExportHtml: () => void;
  onExportMd: () => void;
  onSaveBaseline: () => void;
  onLoadPrevious: () => void;
}

export function TopBar({ onRun, onExportHtml, onExportMd, onSaveBaseline, onLoadPrevious }: TopBarProps) {
  const { state, dispatch } = useEval();
  const { evalName, status, prompts, selectedModels, testCases, runsPerCombination, currentEvalId } = state;
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(evalName);
  const [exportOpen, setExportOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName) nameRef.current?.focus();
  }, [editingName]);

  const totalCells = prompts.length * selectedModels.length * Math.max(testCases.length, 1) * runsPerCombination;

  const statusDot = {
    idle: 'bg-zinc-500',
    running: 'bg-amber-500 animate-pulse-dot',
    completed: 'bg-teal-500',
    failed: 'bg-rose-500',
  }[status];

  const statusLabel = { idle: 'Idle', running: 'Running', completed: 'Completed', failed: 'Failed' }[status];

  const handleNameBlur = () => {
    setEditingName(false);
    dispatch({ type: 'SET_EVAL_NAME', name: nameVal.trim() || 'Untitled Evaluation' });
  };

  return (
    <header
      className="flex items-center justify-between px-4 py-2 border-b"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', flexShrink: 0 }}
    >
      {/* Left: name + status */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-2.5 h-2.5 rounded-full ${statusDot} shrink-0`} aria-label={`Status: ${statusLabel}`} />
        {editingName ? (
          <input
            ref={nameRef}
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={e => { if (e.key === 'Enter') nameRef.current?.blur(); }}
            className="bg-transparent border-b border-[var(--accent)] text-[var(--text-primary)] font-semibold text-sm focus:outline-none min-w-0 w-48"
            aria-label="Evaluation name"
          />
        ) : (
          <button
            onClick={() => { setNameVal(evalName); setEditingName(true); }}
            className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors cursor-text truncate"
            title="Click to edit evaluation name"
          >
            {evalName}
          </button>
        )}

        {/* Matrix badge */}
        <span
          className="text-xs px-2 py-0.5 rounded font-mono shrink-0"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          aria-label="Evaluation matrix size"
        >
          {prompts.length}P × {selectedModels.length}M × {Math.max(testCases.length, 1)}T × {runsPerCombination}R ={' '}
          <span style={{ color: 'var(--accent)' }}>{totalCells}</span>
        </span>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Export dropdown */}
        <div className="relative">
          <button
            onClick={() => setExportOpen(o => !o)}
            disabled={!currentEvalId}
            className="px-3 py-1.5 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
            aria-haspopup="true"
            aria-expanded={exportOpen}
          >
            Export ▾
          </button>
          {exportOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-40 rounded border z-50 shadow-xl"
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
              role="menu"
            >
              <button
                className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-surface)] transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onClick={() => { onExportHtml(); setExportOpen(false); }}
                role="menuitem"
              >
                Export HTML Report
              </button>
              <button
                className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-surface)] transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onClick={() => { onExportMd(); setExportOpen(false); }}
                role="menuitem"
              >
                Export Markdown
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onSaveBaseline}
          disabled={!currentEvalId || status !== 'completed'}
          className="px-3 py-1.5 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
          aria-label="Save as baseline"
        >
          Save Baseline
        </button>

        <button
          onClick={onLoadPrevious}
          className="px-3 py-1.5 text-xs rounded border transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
          aria-label="Load previous evaluation"
        >
          Load Previous
        </button>

        <button
          onClick={onRun}
          disabled={status === 'running' || selectedModels.length === 0}
          className="px-4 py-1.5 text-xs font-semibold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: status === 'running' ? 'var(--bg-elevated)' : 'var(--accent)',
            color: status === 'running' ? 'var(--text-secondary)' : '#000',
          }}
          aria-label="Run evaluation"
        >
          {status === 'running' ? 'Running…' : 'Run Evaluation'}
        </button>
      </div>
    </header>
  );
}
