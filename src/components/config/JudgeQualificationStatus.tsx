import { useEffect, useState } from 'react';
import { qualificationStatus, startQualification, cancelQualification } from '../../api/campaigns';
import type { JudgeQualificationStatus as Status } from '../../types/eval';
import './JudgeQualificationStatus.css';

const labels: Record<Status['state'], string> = { missing: 'Never tested', running: 'Qualification in progress', qualified: 'Qualified', unqualified: 'Not qualified', stale: 'Stale', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' };
export function JudgeQualificationStatus({ modelId, compact = false }: { modelId: string; compact?: boolean }) {
  // A keyed child isolates requests from a previously selected model.
  return <Qualification key={modelId} modelId={modelId} compact={compact} />;
}
function Qualification({ modelId, compact }: { modelId: string; compact: boolean }) {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const next = await qualificationStatus(modelId);
        if (disposed) return;
        setStatus(next); setError(''); failures = 0;
        if (next.state === 'running') timer = setTimeout(poll, 2000);
      } catch (e) {
        if (disposed) return;
        setError((e as Error).message);
        timer = setTimeout(poll, Math.min(30000, 2000 * 2 ** failures++));
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [modelId, refresh]);
  async function act(cancel: boolean) {
    setBusy(true); setError('');
    try { if (cancel && status?.run) await cancelQualification(status.run.id); else await startQualification(modelId); setRefresh(n => n + 1); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section aria-label="Judge qualification" className="qualification-panel">
    <strong role="status" className="qualification-state" data-state={status?.state}>{status ? labels[status.state] : 'Loading qualification…'}</strong>
    <p>Qualification makes three calls per human anchor. Run it when candidate matrices are idle to avoid competing for GPU capacity.</p>
    {error && <p role="alert">{error}</p>}
    {status?.run && <p>{status.run.completedCalls} / {status.run.totalCalls} calls parsed · Updated {new Date(status.run.updatedAt).toLocaleString()}{status.run.cancelRequestedAt && ' · Cancellation requested; waiting for the current call.'}</p>}
    {status?.run?.error && <p>{status.run.error}</p>}
    {status?.record && <details open={!compact}><summary>Last completed qualification metrics{!status.current && ' (stale)'}</summary>
      <dl><dt>Spearman (minimum 0.60)</dt><dd>{status.record.spearman.toFixed(3)}</dd>
        <dt>Faithfulness within one point (minimum 80%)</dt><dd>{(status.record.faithfulnessWithin1Pct * 100).toFixed(1)}%</dd>
        <dt>Mean inflation (absolute maximum 0.50)</dt><dd>{status.record.meanInflation.toFixed(3)}</dd>
        {Object.entries(status.record.selfConsistencyMAD).map(([dim, value]) => <div key={dim}><dt>{dim} MAD (maximum 0.50)</dt><dd>{value.toFixed(3)}</dd></div>)}
      </dl><p>{status.record.qualified ? 'Thresholds passed' : 'Thresholds not met'} · {new Date(status.record.qualifiedAt).toLocaleString()}</p>
    </details>}
    <button type="button" disabled={busy || !status || !!(status.state === 'running' && status.run?.cancelRequestedAt)} onClick={() => void act(status?.state === 'running')}>{status?.state === 'running' ? 'Cancel qualification' : 'Run qualification'}</button>
    <button type="button" onClick={() => setRefresh(n => n + 1)}>Refresh qualification</button>
  </section>;
}
