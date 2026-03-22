import { useEffect, useState } from 'react';
import { getEvaluation } from '../../api/eval';
import type { EvaluationConfig } from '../../types/eval';

interface EvalSummaryBarProps {
  evalId: string;
}

export function EvalSummaryBar({ evalId }: EvalSummaryBarProps) {
  const [config, setConfig] = useState<EvaluationConfig | null>(null);

  useEffect(() => {
    getEvaluation(evalId).then(setConfig).catch(() => {});
  }, [evalId]);

  if (!config) return null;

  const promptCount = config.promptIds.length;
  const modelCount = config.modelIds.length;
  const testCaseCount =
    config.inlineTestCases && config.inlineTestCases.length > 0
      ? config.inlineTestCases.length
      : 1;

  return (
    <div className="eval-summary-bar" aria-label="Evaluation summary">
      <span className="esb-name">{config.name}</span>
      <span className="esb-sep">·</span>
      <span className="esb-stat">{promptCount} prompt{promptCount !== 1 ? 's' : ''}</span>
      <span className="esb-sep">·</span>
      <span className="esb-stat">{modelCount} model{modelCount !== 1 ? 's' : ''}</span>
      <span className="esb-sep">·</span>
      <span className="esb-stat">{testCaseCount} test case{testCaseCount !== 1 ? 's' : ''}</span>
    </div>
  );
}
