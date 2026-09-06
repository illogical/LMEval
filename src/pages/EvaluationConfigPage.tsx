import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addPromptVersion, getEvaluation, getEvaluationFeedback, getPromptContent,
  patchEvaluationDraft, startEvaluationDraft,
} from '../api/eval';
import type { EvaluationConfig, EvaluationFeedback, EvaluationInput } from '../types/eval';

function editableInput(config: EvaluationConfig): EvaluationInput {
  return {
    name: config.name,
    promptIds: config.promptIds,
    promptVersions: config.promptVersions,
    modelIds: config.modelIds,
    comparisonMode: config.comparisonMode,
    purposeTemplateId: config.purposeTemplateId,
    testSuiteId: config.testSuiteId,
    userMessage: config.userMessage,
    inlineTestCases: config.inlineTestCases,
    templateId: config.templateId,
    judgeModelId: config.judgeModelId,
    enablePairwise: config.enablePairwise,
    runsPerCell: config.runsPerCell,
    sessionId: config.sessionId,
    sessionVersion: config.sessionVersion,
    inference: config.inference,
    benchmarkMode: config.benchmarkMode,
  };
}

export function EvaluationConfigPage() {
  const { evalId = '' } = useParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState<EvaluationConfig | null>(null);
  const [feedback, setFeedback] = useState<EvaluationFeedback | null>(null);
  const [json, setJson] = useState('');
  const [promptContents, setPromptContents] = useState<Record<string, string>>({});
  const [originalContents, setOriginalContents] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getEvaluation(evalId), getEvaluationFeedback(evalId)]).then(async ([loaded, snapshot]) => {
      setConfig(loaded);
      setFeedback(snapshot);
      setJson(JSON.stringify(editableInput(loaded), null, 2));
      const entries = await Promise.all((loaded.promptVersions ?? []).map(async pin => [pin.promptId, await getPromptContent(pin.promptId, pin.version).then(r => r.content)] as const));
      const contents = Object.fromEntries(entries);
      setPromptContents(contents);
      setOriginalContents(contents);
    }).catch(error => setMessage((error as Error).message));
  }, [evalId]);

  const editable = config?.status === 'draft';
  const unsupportedMatrix = config?.comparisonMode === 'matrix' && config.promptIds.length > 2;
  const callCount = useMemo(() => {
    if (!config) return 0;
    const tests = config.inlineTestCases?.length ?? (config.testSuiteId || config.userMessage ? 1 : 0);
    return config.promptIds.length * config.modelIds.length * tests * (config.runsPerCell ?? 1);
  }, [config]);

  async function save() {
    if (!config || !editable || unsupportedMatrix) return;
    setBusy(true);
    setMessage('');
    try {
      const input = JSON.parse(json) as EvaluationInput;
      const pins = [...(input.promptVersions ?? config.promptVersions ?? [])];
      for (let index = 0; index < pins.length; index++) {
        const pin = pins[index];
        const content = promptContents[pin.promptId];
        if (content != null && content !== originalContents[pin.promptId]) {
          const manifest = await addPromptVersion(pin.promptId, content, `Draft ${evalId} configuration edit`);
          pins[index] = { promptId: pin.promptId, version: manifest.versions.at(-1)?.version ?? pin.version };
        }
      }
      input.promptVersions = pins;
      input.promptIds = pins.map(pin => pin.promptId);
      const result = await patchEvaluationDraft(evalId, input);
      setConfig(result.evaluation);
      setFeedback(await getEvaluationFeedback(evalId));
      setJson(JSON.stringify(editableInput(result.evaluation), null, 2));
      setOriginalContents({ ...promptContents });
      setMessage('Draft saved.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setMessage('');
    try {
      await startEvaluationDraft(evalId);
      navigate(`/eval/run/${evalId}`);
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  }

  if (!config || !feedback) return <div className="config-page"><p>{message || 'Loading saved evaluation configuration…'}</p></div>;

  return (
    <div className="config-page">
      <h1>{config.name}</h1>
      <p>Status: <strong>{config.status}</strong> · estimated completion calls: {callCount}</p>
      {unsupportedMatrix && <p role="alert">This draft contains more than two prompts. It is fully reviewable here, but must be edited through the API so hidden prompts cannot be lost.</p>}
      {feedback.validation.errors.map(item => <p role="alert" key={item.code}>{item.code}: {item.message}</p>)}
      {feedback.validation.warnings.map(item => <p key={item.code}>{item.code}: {item.message}</p>)}

      <h2>Pinned prompts</h2>
      {(config.promptVersions ?? []).map(pin => (
        <section key={pin.promptId}>
          <h3>{pin.promptId} · version {pin.version}</h3>
          <textarea
            aria-label={`Prompt ${pin.promptId} content`}
            rows={10}
            value={promptContents[pin.promptId] ?? ''}
            disabled={!editable || unsupportedMatrix}
            onChange={event => setPromptContents(current => ({ ...current, [pin.promptId]: event.target.value }))}
          />
        </section>
      ))}

      <h2>Evaluation configuration</h2>
      <textarea aria-label="Evaluation configuration JSON" rows={24} value={json} disabled={!editable || unsupportedMatrix} onChange={event => setJson(event.target.value)} />
      {message && <p role="status">{message}</p>}
      {editable && !unsupportedMatrix ? (
        <div>
          <button type="button" onClick={save} disabled={busy}>Save draft</button>{' '}
          <button type="button" onClick={start} disabled={busy || !feedback.validation.valid}>Start evaluation</button>
        </div>
      ) : (
        <nav>
          <Link to={`/eval/run/${evalId}`}>Run</Link>{' · '}
          <Link to={`/eval/results/${evalId}`}>Results</Link>{' · '}
          <Link to={`/eval/summary/${evalId}`}>Summary</Link>
        </nav>
      )}
    </div>
  );
}
