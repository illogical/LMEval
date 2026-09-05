import type { EvaluationConfig, EvaluationSummary } from '../../types/eval';
import { buildGateVerdict, buildVerdict } from '../../lib/verdict';
import './SummaryOverview.css';

interface SummaryOverviewProps {
  config: EvaluationConfig;
  summary: EvaluationSummary;
  analysisOverview?: string;
}

/** Reuses VerdictHeader's gate-first headline logic verbatim rather than
 * re-deriving "clears the gate" / "best fit" language a second time. */
export function SummaryOverview({ config, summary, analysisOverview }: SummaryOverviewProps) {
  const gateHeadline = buildGateVerdict(config, summary);
  const { headline: scoreHeadline, detail } = buildVerdict(config, summary);
  const headline = gateHeadline ?? scoreHeadline;
  const scoreAsDetail = gateHeadline ? scoreHeadline : detail;

  return (
    <div className="so-panel">
      <div className="so-headline">{headline}</div>
      {scoreAsDetail && <div className="so-detail">{scoreAsDetail}</div>}
      {analysisOverview && <p className="so-overview">{analysisOverview}</p>}
    </div>
  );
}
