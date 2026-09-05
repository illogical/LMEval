import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, GitCompare, RotateCw } from 'lucide-react';
import type { EvalMatrixCell, TestCase } from '../../types/eval';
import { formatLatency } from '../../lib/scoring';
import { testCaseLabel } from '../../lib/labels';
import './DetailView.css';

interface DetailViewProps {
  cell: EvalMatrixCell | null;
  cells: EvalMatrixCell[];
  testCases: TestCase[];
  onSelectCell: (cell: EvalMatrixCell) => void;
  onCompareCell?: (cellId: string) => void;
  onRetryCell?: (cellId: string) => void | Promise<void>;
  retryingCellId?: string | null;
}

export function DetailView({ cell, cells, testCases, onSelectCell, onCompareCell, onRetryCell, retryingCellId }: DetailViewProps) {
  const [rawResponseOpenFor, setRawResponseOpenFor] = useState<string | null>(null);

  if (!cell) return <div className="dv-empty">Click a cell in the heatmap, or a failure in Breakdown, to view details</div>;

  const index = cells.findIndex(c => c.id === cell.id);
  const prev = index > 0 ? cells[index - 1] : undefined;
  const next = index >= 0 && index < cells.length - 1 ? cells[index + 1] : undefined;

  return (
    <div className="detail-view">
      <div className="dv-header">
        <div className="dv-header-top">
          <div>
            <div className="dv-model">{cell.modelId}</div>
            <div className="dv-meta">
              <span>{testCaseLabel(cell.testCaseId, testCases)}</span>
              <span>run {cell.run}</span>
              {cell.status === 'failed' && <span className="dv-failed">FAILED</span>}
            </div>
          </div>
          <div className="dv-nav">
            {onCompareCell && (
              <button className="dv-nav-btn dv-compare-btn" onClick={() => onCompareCell(cell.id)}>
                <GitCompare size={13} /> Compare this cell
              </button>
            )}
            <button className="dv-nav-btn" disabled={!prev} onClick={() => prev && onSelectCell(prev)} title="Previous cell">
              <ChevronLeft size={14} />
            </button>
            <button className="dv-nav-btn" disabled={!next} onClick={() => next && onSelectCell(next)} title="Next cell">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <section className="dv-section">
        <h4 className="dv-section-title">Response</h4>
        <pre className="dv-response">{cell.response ?? cell.error ?? 'No response'}</pre>
      </section>

      {cell.status === 'failed' && (cell.error || cell.errorType || cell.retryAttempts?.length || onRetryCell) && (
        <section className="dv-section">
          <div className="dv-failure-header">
            <h4 className="dv-section-title">Failure</h4>
            {onRetryCell && (
              <button
                className="dv-retry-btn"
                disabled={retryingCellId === cell.id}
                onClick={() => onRetryCell(cell.id)}
              >
                <RotateCw size={12} className={retryingCellId === cell.id ? 'dv-retry-spin' : undefined} />
                {retryingCellId === cell.id ? 'Retrying…' : 'Retry this cell'}
              </button>
            )}
          </div>
          <table className="dv-table">
            <tbody>
              {cell.errorType && <tr><td>Error Type</td><td className="dv-err">{cell.errorType}</td></tr>}
              {cell.error && <tr><td>Error</td><td className="dv-err">{cell.error}</td></tr>}
            </tbody>
          </table>
          {cell.retryAttempts && cell.retryAttempts.length > 0 && (
            <div className="dv-retries">
              <div className="dv-retries-title">{cell.retryAttempts.length} retry attempt{cell.retryAttempts.length === 1 ? '' : 's'}</div>
              {cell.retryAttempts.map(r => (
                <div key={r.attemptNumber} className="dv-retry-row">
                  <span className="dv-retry-num">#{r.attemptNumber}</span>
                  <span className="dv-retry-err">{r.error}</span>
                  <span className="dv-retry-ts">{new Date(r.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {cell.assertionResults && cell.assertionResults.length > 0 && (
        <section className="dv-section">
          <h4 className="dv-section-title">Assertions</h4>
          <table className="dv-table">
            <tbody>
              {cell.assertionResults.map((ar, i) => (
                <tr key={`${ar.type}-${ar.metric ?? i}`}>
                  <td>{ar.metric ?? ar.type}</td>
                  <td className={ar.pass ? 'dv-ok' : 'dv-err'}>
                    {ar.pass ? '✓' : '✗'} {ar.type}
                    {ar.score != null && ` (${ar.score.toFixed(2)})`}
                    {ar.reason && <span className="dv-judge-just"> — {ar.reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {cell.deterministicMetrics && (
        <section className="dv-section">
          <h4 className="dv-section-title">Deterministic Checks</h4>
          <table className="dv-table">
            <tbody>
              {cell.deterministicMetrics.keywordsFound.length > 0 && (
                <tr>
                  <td>Keywords Found</td>
                  <td className="dv-ok">{cell.deterministicMetrics.keywordsFound.join(', ')}</td>
                </tr>
              )}
              {cell.deterministicMetrics.keywordsMissing.length > 0 && (
                <tr>
                  <td>Keywords Missing</td>
                  <td className="dv-err">{cell.deterministicMetrics.keywordsMissing.join(', ')}</td>
                </tr>
              )}
              {cell.deterministicMetrics.forbiddenFound.length > 0 && (
                <tr>
                  <td>Forbidden Found</td>
                  <td className="dv-err">{cell.deterministicMetrics.forbiddenFound.join(', ')}</td>
                </tr>
              )}
              {cell.deterministicMetrics.jsonSchemaValid != null && (
                <tr>
                  <td>JSON Schema</td>
                  <td className={cell.deterministicMetrics.jsonSchemaValid ? 'dv-ok' : 'dv-err'}>
                    {cell.deterministicMetrics.jsonSchemaValid ? '✓ Valid' : '✗ Invalid'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {cell.judgeResults && cell.judgeResults.length > 0 && (
        <section className="dv-section">
          <h4 className="dv-section-title">Judge Scores</h4>
          {cell.judgeResults.map(jr => {
            const rawKey = `${cell.id}::${jr.perspectiveId}`;
            const rawOpen = rawResponseOpenFor === rawKey;
            return (
              <div key={jr.perspectiveId} className="dv-judge-row">
                <div className="dv-judge-header">
                  <span className="dv-judge-name">{jr.perspectiveId}</span>
                  <span className="dv-judge-score">{jr.score.toFixed(1)}</span>
                </div>
                {jr.justification && <p className="dv-judge-just">{jr.justification}</p>}
                {jr.rawResponse && (
                  <>
                    <button
                      className="dv-collapse-toggle"
                      onClick={() => setRawResponseOpenFor(rawOpen ? null : rawKey)}
                    >
                      {rawOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Raw judge response
                    </button>
                    {rawOpen && <pre className="dv-raw-response">{jr.rawResponse}</pre>}
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="dv-section">
        <h4 className="dv-section-title">Performance</h4>
        <table className="dv-table">
          <tbody>
            {cell.durationMs != null && <tr><td>Latency</td><td>{formatLatency(cell.durationMs)}</td></tr>}
            {cell.inputTokens != null && <tr><td>Input Tokens</td><td>{cell.inputTokens}</td></tr>}
            {cell.outputTokens != null && <tr><td>Output Tokens</td><td>{cell.outputTokens}</td></tr>}
            {cell.tokensPerSecond != null && <tr><td>Tokens/sec</td><td>{cell.tokensPerSecond.toFixed(1)}</td></tr>}
            {cell.finishReason && <tr><td>Finish Reason</td><td>{cell.finishReason}</td></tr>}
            {cell.serverName && <tr><td>Server</td><td>{cell.serverName}</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
