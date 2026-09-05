import type { EvaluationSummary, TestCase } from '../../types/eval';
import { BreakdownView } from '../results/BreakdownView';
import { GateMetricsPanel } from './GateMetricsPanel';
import { modelShortName } from '../../lib/labels';
import './PerModelAnalysis.css';

interface PerModelAnalysisProps {
  summary: EvaluationSummary;
  testCases: TestCase[];
  onViewCell?: (cellId: string) => void;
}

/** Reuses BreakdownView wholesale (score-vs-latency scatter, per-perspective
 * chart, hardest cases, consistency, performance) rather than re-deriving a
 * second chart set for the Summary page, plus a per-model gate panel when
 * A9's perModelTaskMetrics is present. */
export function PerModelAnalysis({ summary, testCases, onViewCell }: PerModelAnalysisProps) {
  return (
    <div className="pma-panel">
      {summary.perModelTaskMetrics && (
        <div className="pma-gates">
          {Object.entries(summary.perModelTaskMetrics).map(([modelId, tm]) => (
            <GateMetricsPanel key={modelId} title={modelShortName(modelId)} tm={tm} />
          ))}
        </div>
      )}
      <BreakdownView summary={summary} testCases={testCases} onViewCell={onViewCell} />
    </div>
  );
}
