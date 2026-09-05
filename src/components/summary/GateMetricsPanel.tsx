import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TaskMetrics } from '../../types/eval';
import './GateMetricsPanel.css';

interface GateMetricsPanelProps {
  title: string;
  tm: TaskMetrics;
  defaultOpen?: boolean;
}

function gateBadgeClass(verdict: TaskMetrics['gate']['verdict']): string {
  switch (verdict) {
    case 'pass': return 'gmp-badge-pass';
    case 'fail': return 'gmp-badge-fail';
    case 'inconclusive': return 'gmp-badge-inconclusive';
    default: return 'gmp-badge-advisory';
  }
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="gmp-stat">
      <span className="gmp-stat-value">{value}</span>
      <span className="gmp-stat-label">{label}</span>
    </div>
  );
}

/** Renders one TaskMetrics's gate verdict + key stats — the Summary-page home
 * for the same data ReportService.renderTaskMetrics() already formats for
 * the Markdown export, and VerdictHeader already headlines for a single-model
 * result. Used both for the whole-run summary.taskMetrics and, once per
 * model, for summary.perModelTaskMetrics (A9). */
export function GateMetricsPanel({ title, tm, defaultOpen = false }: GateMetricsPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { gate } = tm;

  return (
    <div className="gmp-panel">
      <button className="gmp-header" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="gmp-title">{title}</span>
        <span className={`gmp-badge ${gateBadgeClass(gate.verdict)}`}>
          {gate.verdict}
          {gate.verdict === 'inconclusive' && gate.neededCases != null && ` (~${gate.neededCases} more cases needed)`}
        </span>
      </button>

      {open && (
        <div className="gmp-body">
          <div className="gmp-stat-row">
            {tm.taskType === 'classification' && (
              <>
                <StatTile label="Accuracy" value={`${(tm.accuracy * 100).toFixed(1)}%`} />
                <StatTile label="Macro-F1" value={tm.macroF1.toFixed(3)} />
                <StatTile label="Invalid-label rate" value={`${(tm.invalidLabelRate * 100).toFixed(1)}%`} />
                <StatTile label="Format compliance" value={`${(tm.formatComplianceRate * 100).toFixed(1)}%`} />
                {tm.runToRunAgreement != null && <StatTile label="Run-to-run agreement" value={`${(tm.runToRunAgreement * 100).toFixed(1)}%`} />}
              </>
            )}
            {tm.taskType === 'tagging' && (
              <>
                <StatTile label="Micro-F1" value={tm.microF1.toFixed(3)} />
                <StatTile label="Macro label-F1" value={tm.macroLabelF1.toFixed(3)} />
                <StatTile label="Jaccard mean" value={tm.jaccardMean.toFixed(3)} />
                <StatTile label="Exact-set match" value={`${(tm.exactSetMatchRate * 100).toFixed(1)}%`} />
                <StatTile label="Unknown-tag rate" value={`${(tm.unknownTagRate * 100).toFixed(1)}%`} />
              </>
            )}
            {tm.taskType === 'summarization' && (
              <>
                <StatTile label="Median weighted" value={tm.medianRubric.weighted.toFixed(2)} />
                <StatTile label="Faithfulness" value={tm.medianRubric.faithfulness.toFixed(2)} />
                <StatTile label="Critical unsupported-claim rate" value={`${(tm.criticalUnsupportedClaimRate * 100).toFixed(1)}%`} />
                <StatTile label="Judge qualified" value={tm.judgeQualified === true ? 'yes' : tm.judgeQualified === false ? 'no' : 'unknown'} />
              </>
            )}
          </div>

          {gate.failures.length > 0 && (
            <ul className="gmp-failures">
              {gate.failures.map(f => <li key={f}>{f}</li>)}
            </ul>
          )}

          {tm.taskType === 'classification' && (
            <div className="gmp-table-wrap">
              <table className="gmp-table">
                <thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th></tr></thead>
                <tbody>
                  {Object.entries(tm.perClass).map(([label, m]) => (
                    <tr key={label}><td>{label}</td><td>{m.precision.toFixed(2)}</td><td>{m.recall.toFixed(2)}</td><td>{m.f1.toFixed(2)}</td><td>{m.support}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tm.taskType === 'tagging' && (
            <div className="gmp-table-wrap">
              <table className="gmp-table">
                <thead><tr><th>Tag</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th></tr></thead>
                <tbody>
                  {Object.entries(tm.perLabel).map(([tag, m]) => (
                    <tr key={tag}><td>{tag}</td><td>{m.precision.toFixed(2)}</td><td>{m.recall.toFixed(2)}</td><td>{m.f1.toFixed(2)}</td><td>{m.support}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tm.taskType === 'summarization' && (
            <div className="gmp-table-wrap">
              <table className="gmp-table">
                <tbody>
                  <tr><td>No preamble</td><td>{(tm.deterministic.noPreambleRate * 100).toFixed(1)}%</td></tr>
                  <tr><td>No heading</td><td>{(tm.deterministic.noHeadingRate * 100).toFixed(1)}%</td></tr>
                  <tr><td>No fence</td><td>{(tm.deterministic.noFenceRate * 100).toFixed(1)}%</td></tr>
                  <tr><td>Compression in range</td><td>{(tm.deterministic.compressionInRangeRate * 100).toFixed(1)}%</td></tr>
                  <tr><td>Protected tokens preserved</td><td>{(tm.deterministic.protectedTokensPreservedRate * 100).toFixed(1)}%</td></tr>
                  <tr><td>No forbidden claims</td><td>{(tm.deterministic.noForbiddenClaimsRate * 100).toFixed(1)}%</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
