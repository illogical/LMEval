import { useState, useEffect } from 'react';
import { listModels } from '../../api/eval';
import './JudgeConfig.css';

interface JudgeConfigProps {
  judgeModelId: string | null;
  onJudgeModelChange: (id: string | null) => void;
  enablePairwise: boolean;
  onPairwiseChange: (v: boolean) => void;
  runsPerCell: number;
  onRunsPerCellChange: (n: number) => void;
}

export function JudgeConfig({
  judgeModelId, onJudgeModelChange,
  enablePairwise, onPairwiseChange,
  runsPerCell, onRunsPerCellChange,
}: JudgeConfigProps) {
  const [modelOptions, setModelOptions] = useState<Array<{ server: string; model: string }>>([]);

  useEffect(() => {
    listModels()
      .then(data => {
        const opts = data.servers.flatMap(s => s.models.map(m => ({ server: s.name, model: m })));
        setModelOptions(opts);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="judge-config">
      <div className="jc-field">
        <label className="jc-label">Judge Model</label>
        <select
          className="jc-select"
          value={judgeModelId ?? ''}
          onChange={e => onJudgeModelChange(e.target.value || null)}
          aria-label="Judge model"
        >
          <option value="">No judge (deterministic only)</option>
          {modelOptions.map(opt => (
            <option key={`${opt.server}::${opt.model}`} value={`${opt.server}::${opt.model}`}>
              {opt.model} ({opt.server})
            </option>
          ))}
        </select>
      </div>

      <div className="jc-field jc-row">
        <label className="jc-label">Pairwise Comparison</label>
        <input
          type="checkbox"
          checked={enablePairwise}
          onChange={e => onPairwiseChange(e.target.checked)}
          aria-label="Enable pairwise"
          className="jc-checkbox"
        />
        <span className="jc-hint">Compare prompt A vs B directly</span>
      </div>

      <div className="jc-field jc-row">
        <label className="jc-label">Runs per Cell</label>
        <input
          type="number"
          min={1}
          max={10}
          value={runsPerCell}
          onChange={e => onRunsPerCellChange(Math.max(1, Math.min(10, Number(e.target.value))))}
          className="jc-number"
          aria-label="Runs per cell"
        />
      </div>
    </div>
  );
}
