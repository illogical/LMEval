import { useState, useEffect } from 'react';
import './App.css';
import { Header } from './components/layout/Header';
import { PromptPanel } from './components/prompt/PromptPanel';
import { useModels } from './hooks/useModels';
import { chatCompletion } from './api/lmapi';
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

function App() {
  const [prompts, setPrompts] = useState<[PromptState, PromptState]>([
    initialPrompt(),
    initialPrompt(),
  ]);
  const [userMessage, setUserMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [runDurationMs, setRunDurationMs] = useState<number | undefined>(undefined);

  const { models, loading: modelsLoading } = useModels();

  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].value);
    }
  }, [models, selectedModel]);

  async function handleRun() {
    if (isRunning || !selectedModel) return;

    setIsRunning(true);
    setRunStatus('loading');
    setRunDurationMs(undefined);
    const startTime = Date.now();

    setPrompts(prev => [
      { ...prev[0], status: 'loading', response: null, error: undefined },
      { ...prev[1], status: 'loading', response: null, error: undefined },
    ]);

    const makeReq = (i: number): LmapiChatCompletionRequest => ({
      model: selectedModel,
      messages: [
        { role: 'system', content: prompts[i].content },
        { role: 'user', content: userMessage },
      ],
      stream: false,
    });

    const [resultA, resultB] = await Promise.allSettled([
      chatCompletion(makeReq(0)),
      chatCompletion(makeReq(1)),
    ]);

    const resolve = (
      result: PromiseSettledResult<LmapiChatCompletionResponse>
    ): Partial<PromptState> =>
      result.status === 'fulfilled'
        ? {
            response: result.value.choices[0]?.message.content ?? '',
            status: 'done',
            durationMs: result.value.lmapi?.duration_ms,
            error: undefined,
          }
        : { status: 'error', error: (result.reason as Error).message };

    setPrompts(prev => [
      { ...prev[0], ...resolve(resultA) },
      { ...prev[1], ...resolve(resultB) },
    ]);

    const anyError =
      resultA.status === 'rejected' || resultB.status === 'rejected';
    setRunStatus(anyError ? 'error' : 'done');
    setRunDurationMs(Date.now() - startTime);
    setIsRunning(false);
  }

  const runDisabled =
    isRunning ||
    !selectedModel ||
    modelsLoading;

  return (
    <div className="app-layout">
      <Header
        models={models}
        modelsLoading={modelsLoading}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
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
          onChange={val =>
            setPrompts(prev => [{ ...prev[0], content: val }, prev[1]])
          }
        />
        <PromptPanel
          label="B"
          isEditor
          content={prompts[1].content}
          onChange={val =>
            setPrompts(prev => [prev[0], { ...prev[1], content: val }])
          }
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
      <div className="response-area">
        <PromptPanel
          label="A"
          response={prompts[0].response}
          status={prompts[0].status}
          error={prompts[0].error}
          durationMs={prompts[0].durationMs}
        />
        <PromptPanel
          label="B"
          response={prompts[1].response}
          status={prompts[1].status}
          error={prompts[1].error}
          durationMs={prompts[1].durationMs}
        />
      </div>
    </div>
  );
}

export default App;
