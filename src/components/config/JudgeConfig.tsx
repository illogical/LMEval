import { useEffect, useState } from 'react';
import { useEval } from '../../context/EvalContext';
import { evalApi } from '../../api/eval';

interface ModelOption {
  serverId: string;
  serverName: string;
  modelId: string;
  isRunning: boolean;
}

export function JudgeConfig() {
  const { state, dispatch } = useEval();
  const { judgeModel, pairwiseEnabled, runsPerCombination, template } = state;
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    evalApi.listModels().then(setModels).catch(() => {});
  }, []);

  const perspectives = template?.judgeConfig.perspectives ?? [];

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Judge model */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          Judge Model
        </label>
        <select
          value={judgeModel}
          onChange={e => dispatch({ type: 'SET_JUDGE_MODEL', model: e.target.value })}
          className="text-xs rounded px-2 py-1.5 border focus:outline-none"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          aria-label="Select judge model"
        >
          <option value="">-- No judge --</option>
          {models.map(m => (
            <option key={m.modelId} value={m.modelId}>{m.modelId}</option>
          ))}
        </select>
      </div>

      {/* Pairwise toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={pairwiseEnabled}
          onChange={e => dispatch({ type: 'SET_PAIRWISE', enabled: e.target.checked })}
          className="accent-amber-500"
          aria-label="Enable pairwise comparison"
        />
        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>Pairwise Comparison</span>
      </label>

      {/* Runs per combination */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          Runs per Combination: <span style={{ color: 'var(--accent)' }}>{runsPerCombination}</span>
        </label>
        <input
          type="range"
          min={1}
          max={5}
          value={runsPerCombination}
          onChange={e => dispatch({ type: 'SET_RUNS', runs: parseInt(e.target.value) })}
          className="w-full accent-amber-500"
          aria-label={`Runs per combination: ${runsPerCombination}`}
        />
        <div className="flex justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>1</span><span>3</span><span>5</span>
        </div>
      </div>

      {/* Perspective weights */}
      {perspectives.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Perspective Weights</div>
          {perspectives.map(p => (
            <div key={p.id} className="flex items-center gap-2">
              <span className="text-xs w-28 truncate" style={{ color: 'var(--text-primary)' }} title={p.name}>
                {p.name}
              </span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${p.weight * 100}%`, background: 'var(--accent)' }}
                />
              </div>
              <span className="text-xs w-8 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                {(p.weight * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
