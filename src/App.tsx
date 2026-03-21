import { useState, useEffect } from 'react';
import './App.css';
import { Header } from './components/layout/Header';
import { PromptPanel } from './components/prompt/PromptPanel';
import { ModelNav } from './components/model/ModelNav';
import { useModelsByServer } from './hooks/useModelsByServer';
import type { SelectedModel } from './hooks/useModelsByServer';
import { modelKey } from './hooks/useModelsByServer';
import { chatCompletionOnServer } from './api/lmapi';
import type { LmapiChatCompletionRequest, LmapiChatCompletionResponse } from './types/lmapi';

interface PromptState {
  content: string;
  response: string | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  durationMs?: number;
}

const initialPrompt = (): PromptState => ({
  content: '',
  response: null,
  status: 'idle',
});

function resolveResult(
  result: PromiseSettledResult<LmapiChatCompletionResponse>
): Partial<PromptState> {
  return result.status === 'fulfilled'
    ? {
        response: result.value.choices[0]?.message.content ?? '',
        status: 'done',
        durationMs: result.value.lmapi?.duration_ms,
        error: undefined,
      }
    : { status: 'error', error: (result.reason as Error).message, response: null };
}

function App() {
  const [prompts, setPrompts] = useState<[PromptState, PromptState]>([
    initialPrompt(),
    initialPrompt(),
  ]);
  const [userMessage, setUserMessage] = useState('');
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);
  const [activeModelIdx, setActiveModelIdx] = useState(0);
  const [responses, setResponses] = useState<Map<string, PromptState>>(new Map());
  const [modelStatuses, setModelStatuses] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [runDurationMs, setRunDurationMs] = useState<number | undefined>(undefined);

  const { servers, loading: serversLoading } = useModelsByServer();

  // Auto-select first available model
  useEffect(() => {
    if (servers.length > 0 && selectedModels.length === 0) {
      const firstServer = servers[0];
      const firstModel = firstServer?.models[0];
      if (firstModel) setSelectedModels([{ serverName: firstServer.name, modelName: firstModel }]);
    }
  }, [servers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prune stale selections when server list refreshes
  useEffect(() => {
    if (serversLoading) return;
    const available = new Set(servers.flatMap(s => s.models.map(m => `${s.name}::${m}`)));
    const pruned = selectedModels.filter(m => available.has(modelKey(m)));
    if (pruned.length !== selectedModels.length) {
      setSelectedModels(pruned);
    }
  }, [servers, serversLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep activeModelIdx in bounds
  useEffect(() => {
    if (activeModelIdx >= selectedModels.length && selectedModels.length > 0) {
      setActiveModelIdx(selectedModels.length - 1);
    }
  }, [selectedModels, activeModelIdx]);

  async function handleRun() {
    if (isRunning || selectedModels.length === 0) return;

    setIsRunning(true);
    setRunStatus('loading');
    setRunDurationMs(undefined);
    const startTime = Date.now();

    const localResults = new Map<string, PromptState>();
    const localStatuses: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};

    for (const sel of selectedModels) {
      const key = modelKey(sel);
      localStatuses[key] = 'loading';
      localResults.set(`${key}:A`, { ...initialPrompt(), status: 'loading' });
      localResults.set(`${key}:B`, { ...initialPrompt(), status: 'loading' });
    }
    setResponses(new Map(localResults));
    setModelStatuses({ ...localStatuses });

    let firstCompleted = false;

    function update(key: string, patch: Partial<PromptState>) {
      const existing = localResults.get(key) ?? initialPrompt();
      localResults.set(key, { ...existing, ...patch });
      setResponses(new Map(localResults));
    }

    async function runModel(sel: SelectedModel) {
      const key = modelKey(sel);
      const makeReq = (i: 0 | 1): LmapiChatCompletionRequest => ({
        model: sel.modelName,
        messages: [
          { role: 'system', content: prompts[i].content },
          { role: 'user', content: userMessage },
        ],
        stream: false,
      });

      const [rA, rB] = await Promise.allSettled([
        chatCompletionOnServer(makeReq(0), sel.serverName),
        chatCompletionOnServer(makeReq(1), sel.serverName),
      ]);

      update(`${key}:A`, resolveResult(rA));
      update(`${key}:B`, resolveResult(rB));

      const hasErr = rA.status === 'rejected' || rB.status === 'rejected';
      localStatuses[key] = hasErr ? 'error' : 'done';
      setModelStatuses({ ...localStatuses });

      if (!firstCompleted) {
        firstCompleted = true;
        const idx = selectedModels.findIndex(m => modelKey(m) === key);
        if (idx !== -1) setActiveModelIdx(idx);
      }
    }

    // Group by server to run sequentially within each server, servers run in parallel
    const groups: Record<string, SelectedModel[]> = {};
    for (const sel of selectedModels) {
      (groups[sel.serverName] ??= []).push(sel);
    }
    await Promise.allSettled(
      Object.values(groups).map(async models => {
        for (const m of models) await runModel(m);
      })
    );

    const anyError = Object.values(localStatuses).some(s => s === 'error');
    setRunStatus(anyError ? 'error' : 'done');
    setRunDurationMs(Date.now() - startTime);
    setIsRunning(false);
  }

  function handleNavigateToModel(sel: SelectedModel) {
    const idx = selectedModels.findIndex(m => modelKey(m) === modelKey(sel));
    if (idx !== -1) setActiveModelIdx(idx);
  }

  const runDisabled = isRunning || selectedModels.length === 0 || serversLoading;

  const activeModel = selectedModels[activeModelIdx] ?? selectedModels[0];
  const activeKey = activeModel ? modelKey(activeModel) : '';
  const responseA = responses.get(`${activeKey}:A`) ?? initialPrompt();
  const responseB = responses.get(`${activeKey}:B`) ?? initialPrompt();

  const showModelTag = selectedModels.length > 1 && activeModel != null;
  const modelTag = activeModel ? `${activeModel.modelName} · ${activeModel.serverName}` : undefined;

  return (
    <div className="app-layout">
      <Header
        servers={servers}
        serversLoading={serversLoading}
        selectedModels={selectedModels}
        onSelectionChange={setSelectedModels}
        modelStatuses={modelStatuses}
        onNavigateToModel={handleNavigateToModel}
        onRun={handleRun}
        runDisabled={runDisabled}
        runStatus={runStatus}
        runDurationMs={runDurationMs}
      />
      <div className="main-area">
        <PromptPanel
          label="A"
          isEditor
          content={prompts[0].content}
          onChange={val => setPrompts(prev => [{ ...prev[0], content: val }, prev[1]])}
        />
        <PromptPanel
          label="B"
          isEditor
          content={prompts[1].content}
          onChange={val => setPrompts(prev => [prev[0], { ...prev[1], content: val }])}
        />
      </div>
      <div className="user-message-bar">
        <div className="panel-label">User Message</div>
        <textarea
          value={userMessage}
          onChange={e => setUserMessage(e.target.value)}
          rows={3}
          placeholder="Enter the user message to send with both prompts…"
          aria-label="User message"
        />
      </div>
      <div className="bottom-area">
        {selectedModels.length > 1 && (
          <ModelNav
            models={selectedModels}
            activeIdx={activeModelIdx}
            onSelect={setActiveModelIdx}
            statuses={modelStatuses}
          />
        )}
        <div className="response-area">
          <PromptPanel
            label="A"
            modelTag={showModelTag ? modelTag : undefined}
            response={responseA.response}
            status={responseA.status}
            error={responseA.error}
            durationMs={responseA.durationMs}
          />
          <PromptPanel
            label="B"
            modelTag={showModelTag ? modelTag : undefined}
            response={responseB.response}
            status={responseB.status}
            error={responseB.error}
            durationMs={responseB.durationMs}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
