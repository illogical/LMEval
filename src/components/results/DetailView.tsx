import type { EvalMatrixCell } from '../../types/eval';
import { formatLatency } from '../../lib/scoring';
import './DetailView.css';

interface DetailViewProps {
  cell: EvalMatrixCell | null;
}

export function DetailView({ cell }: DetailViewProps) {
  if (!cell) return <div className="dv-empty">Click a cell in the heatmap to view details</div>;

  return (
    <div className="detail-view">
      <div className="dv-header">
        <div className="dv-model">{cell.modelId}</div>
        <div className="dv-meta">
          <span>Test: {cell.testCaseId}</span>
          {cell.status === 'failed' && <span className="dv-failed">FAILED</span>}
        </div>
      </div>

      <section className="dv-section">
        <h4 className="dv-section-title">Response</h4>
        <pre className="dv-response">{cell.response ?? cell.error ?? 'No response'}</pre>
      </section>

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
          {cell.judgeResults.map(jr => (
            <div key={jr.perspectiveId} className="dv-judge-row">
              <div className="dv-judge-header">
                <span className="dv-judge-name">{jr.perspectiveId}</span>
                <span className="dv-judge-score">{jr.score.toFixed(1)}</span>
              </div>
              {jr.justification && <p className="dv-judge-just">{jr.justification}</p>}
            </div>
          ))}
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
          </tbody>
        </table>
      </section>
    </div>
  );
}
