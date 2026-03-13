import { useEval } from '../../context/EvalContext';
import { formatScore, formatLatency } from '../../lib/scoring';

interface DetailViewProps {
  cellId?: string;
}

export function DetailView({ cellId }: DetailViewProps) {
  const { state } = useEval();
  const { results } = state;

  const cell = results?.matrix.find(c => c.id === cellId);
  const judgeResults = results?.judgeResults.filter(j => j.cellId === cellId) ?? [];

  if (!results) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        No results yet.
      </div>
    );
  }

  if (!cell) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        Click a cell in the heatmap to see details.
      </div>
    );
  }

  const { metrics, response } = cell;

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      {/* Header */}
      <div>
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {cell.modelId}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Prompt v{cell.promptVersion} · Test: {cell.testCaseId} · Run {cell.runNumber}
        </div>
      </div>

      {/* Metrics table */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Metrics</div>
        <table className="w-full text-xs border-collapse">
          <tbody>
            {[
              ['Duration', formatLatency(metrics.durationMs)],
              ['Tokens/sec', metrics.tokensPerSecond.toFixed(1)],
              ['Input Tokens', String(metrics.inputTokens)],
              ['Output Tokens', String(metrics.outputTokens)],
              ['Format Compliant', metrics.formatCompliant === null ? '—' : metrics.formatCompliant ? '✓' : '✗'],
              ['JSON Valid', metrics.jsonSchemaValid === null ? '—' : metrics.jsonSchemaValid ? '✓' : '✗'],
              ['Tool Calls Valid', metrics.toolCallsValid === null ? '—' : metrics.toolCallsValid ? '✓' : '✗'],
              ['Server', metrics.serverName],
            ].map(([label, value]) => (
              <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="py-1 pr-3 font-medium" style={{ color: 'var(--text-secondary)', width: '40%' }}>{label}</td>
                <td className="py-1 font-mono" style={{ color: 'var(--text-primary)' }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Response */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Response</div>
        <div
          className="rounded border p-3 text-xs font-mono whitespace-pre-wrap"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)', maxHeight: 200, overflowY: 'auto' }}
        >
          {response.content || <span style={{ color: 'var(--text-secondary)' }}>(no content)</span>}
        </div>
      </div>

      {/* Tool calls */}
      {response.toolCalls && response.toolCalls.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Tool Calls</div>
          <div className="flex flex-col gap-2">
            {response.toolCalls.map((tc, i) => (
              <div
                key={i}
                className="rounded border p-3"
                style={{ background: 'var(--bg-elevated)', borderColor: tc.valid ? 'var(--success)' : 'var(--error)' }}
              >
                <div className="text-xs font-bold mb-1" style={{ color: tc.valid ? 'var(--success)' : 'var(--error)' }}>
                  {tc.functionName} {tc.valid ? '✓' : '✗'}
                </div>
                <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
                  {JSON.stringify(tc.arguments, null, 2)}
                </pre>
                {tc.errors && tc.errors.map((e, j) => (
                  <div key={j} className="text-xs mt-1" style={{ color: 'var(--error)' }}>{e}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Judge scores */}
      {judgeResults.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Judge Scores</div>
          <div className="flex flex-col gap-2">
            {judgeResults.map(j => (
              <div
                key={j.perspectiveId}
                className="rounded border p-3"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{j.perspectiveId}</span>
                  <span className="font-bold font-mono" style={{ color: 'var(--accent)' }}>{formatScore(j.score)}</span>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{j.justification}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Composite score */}
      {cell.compositeScore != null && (
        <div
          className="flex items-center justify-between rounded border p-3"
          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--accent)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Composite Score</span>
          <span className="text-2xl font-bold font-mono" style={{ color: 'var(--accent)' }}>
            {formatScore(cell.compositeScore)}
          </span>
        </div>
      )}
    </div>
  );
}
