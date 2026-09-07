import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { listModels, listPrompts, listTestSuites, listPurposeTemplates } from '../api/eval';
import { listCampaigns, getCampaign, saveCampaign, campaignFeedback, startCampaign, cancelCampaign } from '../api/campaigns';
import { JudgeQualificationStatus } from '../components/config/JudgeQualificationStatus';
import type { CampaignTask, ModelSelectionCampaignInput, ModelSelectionCampaign, PromptManifest, TestSuite, CampaignFeedback, CampaignValidationResult, ModelRecommendation } from '../types/eval';
import './CampaignsPage.css';

const tasks: CampaignTask[] = ['classification', 'tagging', 'summarization'];
function Frame({ children }: { children: ReactNode }) { return <main className="campaign-page"><nav><Link to="/">Home</Link> / <Link to="/campaigns">Campaigns</Link></nav>{children}</main>; }
const message = (e: unknown) => (e as Error).message;
export function CampaignsPage() {
  const [items, setItems] = useState<ModelSelectionCampaign[]>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { let alive = true; listCampaigns().then(data => { if (alive) { setItems(data); setError(''); } }).catch(e => { if (alive) setError(message(e)); }); return () => { alive = false; }; }, [refresh]);
  return <Frame><h1>Model selection campaigns</h1><p>Refine prompts on an incumbent, compare models with the selected prompt, then confirm the recommendation. Tasks run sequentially.</p>
    <Link className="campaign-action" to="/campaigns/new">New Campaign</Link>
    {error && <p role="alert">{error} <button onClick={() => setRefresh(n => n + 1)}>Retry</button></p>}
    {!items && !error && <p>Loading campaigns…</p>}{items?.length === 0 && <p>No campaigns yet. Save a draft to review your experiment before starting.</p>}
    <div className="campaign-grid">{items?.map(c => <article key={c.id}><h2><Link to={`/campaigns/${c.id}`}>{c.tasks.join(' · ')}</Link></h2><strong>{c.status}</strong><p>Incumbent: {c.incumbentModelId}</p><p>{c.candidateSlate.length} candidates · {new Date(c.updatedAt).toLocaleString()}</p>{Object.values(c.recommendations).map(r => <p key={r.task}>{r.task}: {r.recommendedModelId}{r.advisory && ' (advisory)'}</p>)}</article>)}</div>
  </Frame>;
}

const empty: ModelSelectionCampaignInput = { tasks: ['classification'], incumbentModelId: '', candidateSlate: [], promptPinsByTask: {}, testSuiteIdByTask: {} };
export function CampaignBuilderPage() {
  const [search] = useSearchParams(); const editId = search.get('edit'); const source = editId ?? search.get('clone');
  const navigate = useNavigate();
  const [input, setInput] = useState<ModelSelectionCampaignInput>(empty);
  const [models, setModels] = useState<string[]>([]); const [prompts, setPrompts] = useState<PromptManifest[]>([]); const [suites, setSuites] = useState<TestSuite[]>([]);
  const [error, setError] = useState(''); const [validation, setValidation] = useState<CampaignValidationResult>(); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([listModels(), listPrompts(), listTestSuites(), listPurposeTemplates(), source ? getCampaign(source) : Promise.resolve(null)]).then(([m, p, s, purposes, campaign]) => {
      if (!alive) return;
      setModels(m.servers.flatMap(server => server.models.map(model => `${server.name}::${model}`))); setPrompts(p); setSuites(s);
      if (campaign) {
        if (editId && campaign.status !== 'draft') throw new Error('Started campaigns are immutable. Clone to retry.');
        setInput({ ...campaign, promptPinsByTask: campaign.promptPinsByTask ?? Object.fromEntries(Object.entries(campaign.promptIdsByTask).map(([task, ids]) => [task, ids.map(promptId => ({ promptId, version: p.find(x => x.id === promptId)?.versions.at(-1)?.version ?? 0 }))])) });
      } else setInput({ ...empty, testSuiteIdByTask: Object.fromEntries(purposes.map(t => [t.purposeCategory, t.defaultTestSuiteId ?? ''])) });
      setLoaded(true);
    }).catch(e => { if (alive) setError(message(e)); });
    return () => { alive = false; };
  }, [source, editId]);
  function field<K extends keyof ModelSelectionCampaignInput>(key: K, value: ModelSelectionCampaignInput[K]) { setInput(prev => ({ ...prev, [key]: value })); }
  const options = <><option value="">Choose model</option>{models.map(m => <option key={m}>{m}</option>)}</>;
  async function save() {
    setBusy(true); setError('');
    try { const c = await saveCampaign(input, editId ?? undefined); navigate(`/campaigns/${c.id}`); }
    catch (e) { setError(message(e)); setValidation((e as Error & { validation?: CampaignValidationResult }).validation); }
    finally { setBusy(false); }
  }
  return <Frame><h1>{editId ? 'Edit campaign draft' : 'New campaign'}</h1><p>Save a reproducible draft first. Three repetitions per case measure output variability; they do not add independent memories.</p>
    {error && <p role="alert">{error}</p>}{validation?.issues.map((i, n) => <p role={i.severity === 'error' ? 'alert' : undefined} key={n}>{i.message}</p>)}
    {!loaded ? <p>Loading configuration…</p> : <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>Incumbent model<select required value={input.incumbentModelId} onChange={e => field('incumbentModelId', e.target.value)}>{options}</select></label>
      <fieldset><legend>Candidate slate (at least two unique models)</legend>{input.candidateSlate.map((candidate, index) => <div className="candidate-row" key={index}>
        <label>Candidate {index + 1}<select required value={candidate.modelId} onChange={e => field('candidateSlate', input.candidateSlate.map((c, n) => n === index ? { ...c, modelId: e.target.value, lmapiServer: e.target.value.split('::')[0] } : c))}>{options}</select></label>
        {(['parameterSize', 'quantization', 'contextLength'] as const).map(key => <label key={key}>{key}<input type={key === 'contextLength' ? 'number' : 'text'} min={1} value={candidate[key] ?? ''} onChange={e => field('candidateSlate', input.candidateSlate.map((c, n) => n === index ? { ...c, [key]: key === 'contextLength' ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value } : c))} /></label>)}
        <button type="button" onClick={() => field('candidateSlate', input.candidateSlate.filter((_, n) => n !== index))}>Remove candidate {index + 1}</button>
      </div>)}<button type="button" onClick={() => field('candidateSlate', [...input.candidateSlate, { modelId: '', lmapiServer: '' }])}>Add candidate</button></fieldset>
      <fieldset><legend>Tasks</legend>{tasks.map(task => <label className="inline" key={task}><input type="checkbox" checked={input.tasks.includes(task)} onChange={e => field('tasks', e.target.checked ? [...input.tasks, task] : input.tasks.filter(t => t !== task))} />{task}</label>)}</fieldset>
      {input.tasks.map(task => <fieldset key={task}><legend>{task}: ordered prompt versions and benchmark</legend>
        <label>Suite for {task}<select required value={input.testSuiteIdByTask[task] ?? ''} onChange={e => field('testSuiteIdByTask', { ...input.testSuiteIdByTask, [task]: e.target.value })}><option value="">Choose suite</option>{suites.filter(s => s.purposeCategory === task).map(s => <option key={s.id} value={s.id}>{s.name} · {s.provenance?.reviewStatus ?? 'Review unknown'}</option>)}</select></label>
        {(input.promptPinsByTask[task] ?? []).map((pin, index) => <div className="candidate-row" key={index}>
          <label>{task} prompt {index + 1}<select required value={pin.promptId} onChange={e => field('promptPinsByTask', { ...input.promptPinsByTask, [task]: input.promptPinsByTask[task].map((p, n) => n === index ? { promptId: e.target.value, version: prompts.find(x => x.id === e.target.value)?.versions.at(-1)?.version ?? 0 } : p) })}><option value="">Choose prompt</option>{prompts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Version<select required value={pin.version} onChange={e => field('promptPinsByTask', { ...input.promptPinsByTask, [task]: input.promptPinsByTask[task].map((p, n) => n === index ? { ...p, version: Number(e.target.value) } : p) })}>{prompts.find(p => p.id === pin.promptId)?.versions.map(v => <option key={v.version} value={v.version}>v{v.version}</option>)}</select></label>
          <button type="button" onClick={() => field('promptPinsByTask', { ...input.promptPinsByTask, [task]: input.promptPinsByTask[task].filter((_, n) => n !== index) })}>Remove prompt {index + 1}</button>
        </div>)}<button type="button" onClick={() => field('promptPinsByTask', { ...input.promptPinsByTask, [task]: [...(input.promptPinsByTask[task] ?? []), { promptId: '', version: 0 }] })}>Add {task} prompt</button>
      </fieldset>)}
      {input.tasks.includes('summarization') && <fieldset><legend>Summarization judge</legend><label>Judge model<select required value={input.judgeModelId ?? ''} onChange={e => field('judgeModelId', e.target.value)}>{options}</select></label>{input.judgeModelId && <JudgeQualificationStatus modelId={input.judgeModelId} />}</fieldset>}
      <label>Declared total VRAM (GB, optional)<input type="number" min={1} value={input.totalVramBudgetGb ?? ''} onChange={e => field('totalVramBudgetGb', e.target.value ? Number(e.target.value) : undefined)} /></label><p>Declared metadata only. LMEval cannot measure model residency or determine whether this budget is exceeded.</p>
      <button disabled={busy || input.tasks.length === 0} type="submit">{busy ? 'Saving…' : 'Save draft'}</button>
    </form>}
  </Frame>;
}

function CampaignQualityChart({ recommendation: r }: { recommendation: ModelRecommendation }) {
  const max = r.task === 'summarization' ? 5 : 1;
  const threshold = r.task === 'summarization' ? 4.2 : r.task === 'classification' ? 0.9 : 0.85;
  const y = (v: number) => 180 - v / max * 150;
  const metrics = r.ordering.primaryMetrics ?? { [r.recommendedModelId]: { value: r.primaryMetric.value, ci95: r.primaryMetric.ci95 } };
  const modelIds = Object.keys(metrics);
  const latencies = modelIds.map(model => r.ordering.p95LatencyMs[model] ?? 0);
  const minLatency = Math.min(...latencies); const maxLatency = Math.max(...latencies);
  const x = (model: string) => 60 + ((r.ordering.p95LatencyMs[model] ?? 0) - minLatency) / Math.max(1, maxLatency - minLatency) * 300;
  const rank = (model: string) => r.ordering.tieGroups.find(group => group.modelIds.includes(model))?.rank;
  return <><svg role="img" aria-label={`${r.primaryMetric.name} and 95% intervals versus p95 latency by candidate`} viewBox="0 0 400 220">
    <line x1="45" y1="15" x2="45" y2="180" stroke="currentColor" /><line x1="45" y1="180" x2="380" y2="180" stroke="currentColor" />
    <line x1="45" y1={y(threshold)} x2="380" y2={y(threshold)} stroke="currentColor" strokeDasharray="5 4" /><text x="50" y={y(threshold) - 4} fill="currentColor">Primary reference {threshold}</text>
    {modelIds.map(model => { const metric = metrics[model]; const cx = x(model); return <g key={model}><line x1={cx} y1={y(metric.ci95[0])} x2={cx} y2={y(metric.ci95[1])} stroke="currentColor" strokeWidth="3"/><circle cx={cx} cy={y(metric.value)} r="7" fill={rank(model) === 1 ? 'var(--accent, #7c9fff)' : 'var(--text-secondary, #aaa)'}><title>{model}: {metric.value.toFixed(3)}, CI {metric.ci95[0].toFixed(3)}–{metric.ci95[1].toFixed(3)}, p95 {Math.round(r.ordering.p95LatencyMs[model] ?? 0)} ms, tie group {rank(model) ?? 'discarded'}</title></circle></g>; })}
    <text x="55" y="20" fill="currentColor">{max}</text><text x="145" y="210" fill="currentColor">p95 latency →</text>
  </svg><p>The dashed reference is the task's headline threshold. Final gate status also applies the task's secondary metrics and confidence rules.</p></>;
}
function Recommendation({ recommendation: r }: { recommendation: ModelRecommendation }) {
  const [low, high] = r.primaryMetric.ci95;
  return <article><h2>{r.task}: {r.recommendedModelId}</h2><strong>{r.advisory ? 'Advisory — not promotable' : r.confirmation.passed ? 'Confirmation passed' : 'Confirmation did not pass'}</strong>
    <p>{r.primaryMetric.name}: {r.primaryMetric.value.toFixed(3)} (95% CI {low.toFixed(3)}–{high.toFixed(3)}). p95 latency: {Math.round(r.p95LatencyMs)} ms.</p>
    <CampaignQualityChart recommendation={r} />
    <table><caption>Statistical tie groups; order within a group uses latency budget and stability</caption><thead><tr><th>Group</th><th>Model</th><th>p95 ms</th><th>Run agreement</th></tr></thead><tbody>{r.ordering.tieGroups.flatMap(g => g.modelIds.map(m => <tr key={m}><td>{g.rank}</td><td>{m}</td><td>{Math.round(r.ordering.p95LatencyMs[m])}</td><td>{r.ordering.stability[m]?.runToRunAgreement ?? 'Not measured'}</td></tr>))}</tbody></table>
    <p>{r.ordering.latencyBudgetNote}</p><details><summary>Discarded by gate ({r.discardedByGate.length})</summary>{r.discardedByGate.map(m => <p key={m.modelId}>{m.modelId}: {m.reason}</p>)}</details>
    <p>Confirmation: {r.confirmation.ranModelId} · {r.confirmation.reason ?? (r.confirmation.passed ? 'Passed' : 'Not passed')}</p>{r.fallbackReason && <p>{r.fallbackReason}</p>}{r.confirmationAttempts?.map(attempt => <p key={attempt.evaluationId}>{attempt.modelId}: {attempt.passed ? 'passed' : 'did not pass'} · <a href={`${import.meta.env.BASE_URL}eval/results/${attempt.evaluationId}`}>Results</a>{attempt.reason && ` · ${attempt.reason}`}</p>)}
    <details><summary>Provenance and inference</summary><p>{r.promptId} v{r.promptVersion} · {r.suiteId} v{r.suiteVersion} · temperature {r.inference.temperature} · token cap {r.inference.maxTokens}</p><pre>{JSON.stringify(r.provenance, null, 2)}</pre></details>
  </article>;
}

export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const [feedback, setFeedback] = useState<CampaignFeedback>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0); const [codes, setCodes] = useState<string[]>([]); const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout>; let failures = 0;
    async function poll() {
      try { const next = await campaignFeedback(id); if (!alive) return; setFeedback(next); setError(''); failures = 0; if (['pending', 'running'].includes(next.campaign.status)) timer = setTimeout(poll, 3000); }
      catch (e) { if (!alive) return; setError(message(e)); timer = setTimeout(poll, Math.min(30000, 3000 * 2 ** failures++)); }
    }
    void poll(); return () => { alive = false; clearTimeout(timer); };
  }, [id, refresh]);
  async function act(cancel: boolean) { setBusy(true); setError(''); try { if (cancel) await cancelCampaign(id); else await startCampaign(id, codes); setConfirmCancel(false); setRefresh(n => n + 1); } catch (e) { setError(message(e)); const next = await campaignFeedback(id).catch(() => undefined); if (next) setFeedback(next); } finally { setBusy(false); } }
  const c = feedback?.campaign; const v = feedback?.validation;
  return <Frame><h1>Campaign review</h1><button onClick={() => setRefresh(n => n + 1)}>Refresh</button>{error && <p role="alert">{error}</p>}
    {!c ? <p>Loading campaign…</p> : <><p><strong>{c.status}</strong> · {c.id} · Updated {new Date(c.updatedAt).toLocaleString()}</p>{c.error && <p role="alert">{c.error}</p>}
      <p>Prompt sweep: vary prompts, fix {c.incumbentModelId}. Model sweep: fix the selected prompt version, vary {c.candidateSlate.length} models. Confirmation: test the selected model; try one runner-up if its gate fails.</p>
      {!c.promptPinsByTask && <p>Legacy campaign: exact prompt pins are missing. Clone and review current versions before starting.</p>}
      <details open={c.status === 'draft'}><summary>Fixed configuration</summary>{c.tasks.map(t => <p key={t}>{t}: {c.promptPinsByTask?.[t]?.map(p => `${p.promptId} v${p.version}`).join(', ') ?? c.promptIdsByTask[t]?.join(', ')} · Suite {c.testSuiteIdByTask[t]}</p>)}<p>Candidates: {c.candidateSlate.map(m => m.modelId).join(', ')}</p><p>Three repetitions; production task inference. Summarization includes 12 rubric calls per candidate response. Prompt selection and short confirmation use calibration cases; the model sweep includes the full benchmark.</p>{c.judgeModelId && <JudgeQualificationStatus modelId={c.judgeModelId} compact />}</details>
      {c.status === 'draft' && <><Link to={`/campaigns/new?edit=${c.id}`}>Edit draft</Link><table><caption>Estimated model calls, including rubric grading and optional runner-up confirmation</caption><thead><tr><th>Task</th><th>Prompt sweep</th><th>Model sweep</th><th>Confirmation</th><th>Total</th></tr></thead><tbody>{v?.callEstimate.map(e => <tr key={e.task}><td>{e.task}</td><td>{e.phaseOne}</td><td>{e.phaseTwo}</td><td>{e.phaseThreeMinimum}–{e.phaseThreeMaximum}</td><td>{e.totalMinimum}–{e.totalMaximum}</td></tr>)}</tbody></table>
        {v?.issues.map((i, n) => <div key={`${i.code}-${n}`}>{i.requiresAcknowledgement ? <label className="inline"><input type="checkbox" checked={codes.includes(i.code)} onChange={e => setCodes(prev => e.target.checked ? [...prev, i.code] : prev.filter(c => c !== i.code))} />{i.message}</label> : <p>{i.severity}: {i.message}</p>}</div>)}
        <button disabled={busy || !v?.valid || v.issues.some(i => i.requiresAcknowledgement && !codes.includes(i.code))} onClick={() => void act(false)}>Start campaign</button></>}
      {['pending', 'running'].includes(c.status) && <><p>Work is sequential. Completed calls are execution progress, not assertion passes. Avoid overlapping heavy judge workloads.</p>{feedback?.activeEvaluation && <p role="status">{c.activeWork?.task} · {c.activeWork?.phase}: {feedback.activeEvaluation.progress.completed} successful / {feedback.activeEvaluation.progress.total} total · {feedback.activeEvaluation.progress.failed} execution failures · last update {feedback.activeEvaluation.progress.updatedAt}</p>}{confirmCancel ? <p>Cancel this campaign after preserving its current evidence? <button disabled={busy} onClick={() => void act(true)}>Confirm cancellation</button><button onClick={() => setConfirmCancel(false)}>Keep running</button></p> : <button disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel campaign</button>}</>}
      <ol>{feedback?.phases.map(p => <li key={p.evaluationId}>{p.task} · {p.phase} · {p.status} · <a href={p.browserPath}>{['pending', 'running'].includes(p.status) ? 'Run' : 'Results'}</a></li>)}</ol>
      {Object.values(c.recommendations).map(r => <Recommendation key={r.task} recommendation={r} />)}
      {c.status === 'completed' && c.bestSingleModel && <article><h2>Best single model: {c.bestSingleModel.modelId}</h2>{Object.entries(c.bestSingleModel.qualityDelta).map(([t, d]) => <p key={t}>{t} quality delta: {d.toFixed(3)}</p>)}<p>This is a quality compromise, not a deployment recommendation. {c.crossServerFlag && 'Selections span servers; hardware and workload costs have not been measured.'}</p></article>}
      {!['draft', 'pending', 'running'].includes(c.status) && <Link to={`/campaigns/new?clone=${c.id}`}>Clone configuration to retry in a new draft</Link>}
    </>}
  </Frame>;
}
