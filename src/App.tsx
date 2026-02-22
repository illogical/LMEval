import { useEffect, useCallback, useState, type ErrorInfo } from 'react';
import React from 'react';
import { EvalProvider, useEval } from './context/EvalContext';
import { useEvalSocket } from './hooks/useEvalSocket';
import { evalApi } from './api/eval';

// Layout
import { ResizablePanel } from './components/layout/ResizablePanel';
import { TopBar } from './components/layout/TopBar';
import { BottomBar } from './components/layout/BottomBar';

// Prompt panel
import { PromptTabs } from './components/prompt/PromptTabs';
import { PromptEditor } from './components/prompt/PromptEditor';
import { ToolDefinitionEditor } from './components/prompt/ToolDefinitionEditor';
import { PromptDiff } from './components/prompt/PromptDiff';

// Config panel
import { ModelSelector } from './components/config/ModelSelector';
import { TestCaseEditor } from './components/config/TestCaseEditor';
import { TemplateSelector } from './components/config/TemplateSelector';
import { JudgeConfig } from './components/config/JudgeConfig';
import { ExecutionPreview } from './components/config/ExecutionPreview';

// Execution panel
import { ProgressDashboard } from './components/execution/ProgressDashboard';
import { ModelProgressRow } from './components/execution/ModelProgressRow';
import { LiveFeed } from './components/execution/LiveFeed';

// Results panel
import { Scoreboard } from './components/results/Scoreboard';
import { HeatmapMatrix } from './components/results/HeatmapMatrix';
import { CompareView } from './components/results/CompareView';
import { DetailView } from './components/results/DetailView';
import { MetricsView } from './components/results/MetricsView';
import { TimelineView } from './components/results/TimelineView';

import type { ToolDefinition } from './types/eval';
import type { EvalMatrixCell } from './types/eval';

// ─── Error Boundary ────────────────────────────────────────────────────────────
class PanelErrorBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(_e: Error, _i: ErrorInfo) {}
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center p-4 text-center">
          <div>
            <div className="text-sm font-semibold mb-2" style={{ color: 'var(--error)' }}>
              {this.props.label} error
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {(this.state.error as Error).message}
            </div>
            <button
              className="mt-3 text-xs px-3 py-1.5 rounded"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Section Header ─────────────────────────────────────────────────────────────
function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 border-b"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', flexShrink: 0 }}
    >
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </span>
      {children}
    </div>
  );
}

// ─── Inner App (has access to context) ─────────────────────────────────────────
function AppInner() {
  const { state, dispatch } = useEval();
  const { status, currentEvalId, prompts, activePromptIdx, selectedModels, testCases } = state;
  const [showDiff, setShowDiff] = useState(false);
  const [selectedCellId, setSelectedCellId] = useState<string | undefined>(undefined);
  const [toolDefs, setToolDefs] = useState<ToolDefinition[]>([]);

  // WebSocket for live updates
  const { progress, liveFeed: socketFeed, isCompleted, error: wsError } = useEvalSocket(currentEvalId);

  // Sync socket progress into context
  useEffect(() => {
    if (progress) dispatch({ type: 'UPDATE_PROGRESS', progress });
  }, [progress, dispatch]);

  useEffect(() => {
    if (socketFeed.length > 0) {
      dispatch({ type: 'ADD_LIVE_FEED', entry: socketFeed[0] });
    }
  }, [socketFeed, dispatch]);

  useEffect(() => {
    if (isCompleted && currentEvalId) {
      dispatch({ type: 'SET_STATUS', status: 'completed' });
      // Fetch results
      Promise.all([
        evalApi.getResults(currentEvalId),
        evalApi.getSummary(currentEvalId),
      ]).then(([results, summary]) => {
        dispatch({ type: 'SET_RESULTS', results });
        dispatch({ type: 'SET_SUMMARY', summary });
      }).catch(() => {});
    }
  }, [isCompleted, currentEvalId, dispatch]);

  useEffect(() => {
    if (wsError) dispatch({ type: 'SET_STATUS', status: 'failed' });
  }, [wsError, dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'Enter') { e.preventDefault(); handleRun(); }
        if (e.key === 'd') { e.preventDefault(); setShowDiff(s => !s); }
        if (e.key === 's') { e.preventDefault(); /* save handled in PromptEditor */ }
        if (e.key === '1') { e.preventDefault(); /* focus left */ }
        if (e.key === '2') { e.preventDefault(); /* focus center */ }
        if (e.key === '3') { e.preventDefault(); /* focus right */ }
      }
      if (e.key === 'Escape') setShowDiff(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleRun = useCallback(async () => {
    if (status === 'running' || selectedModels.length === 0) return;
    dispatch({ type: 'SET_STATUS', status: 'running' });
    dispatch({ type: 'UPDATE_PROGRESS', progress: { completedCells: 0, elapsedMs: 0, phase: 1 } });

    try {
      const config = await evalApi.createEvaluation({
        name: state.evalName,
        templateId: state.template?.id ?? 'general-quality',
        promptVersions: prompts.map(p => ({ promptId: p.savedPromptId ?? p.id, version: p.savedVersion ?? 1 })),
        models: selectedModels,
        inlineTestCases: testCases.length > 0 ? testCases : [{ id: 'default', name: 'Default', userMessage: 'Hello' }],
        judgeConfig: {
          enabled: !!state.judgeModel,
          model: state.judgeModel,
          perspectives: state.template?.judgeConfig.perspectives ?? [],
          pairwiseComparison: state.pairwiseEnabled,
          runsPerCombination: state.runsPerCombination,
        },
        toolDefinitions: toolDefs.length > 0 ? toolDefs : undefined,
      });
      dispatch({ type: 'SET_EVAL_ID', id: config.id });
      await evalApi.startEvaluation(config.id);
    } catch (e) {
      dispatch({ type: 'SET_STATUS', status: 'failed' });
    }
  }, [state, prompts, selectedModels, testCases, toolDefs, status, dispatch]);

  const handleExportHtml = async () => {
    if (!currentEvalId) return;
    const html = await evalApi.exportHtml(currentEvalId);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `eval-${currentEvalId}.html`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMd = async () => {
    if (!currentEvalId) return;
    const md = await evalApi.exportMarkdown(currentEvalId);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `eval-${currentEvalId}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveBaseline = async () => {
    if (!currentEvalId) return;
    const slug = prompt('Baseline name:');
    if (slug) await evalApi.saveBaseline(currentEvalId, slug);
  };

  const handleLoadPrevious = async () => {
    const evals = await evalApi.listEvaluations();
    const last = evals.filter(e => e.status === 'completed').sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
    if (!last) return;
    const [results, summary] = await Promise.all([
      evalApi.getResults(last.id),
      evalApi.getSummary(last.id),
    ]);
    dispatch({ type: 'SET_EVAL_ID', id: last.id });
    dispatch({ type: 'SET_RESULTS', results });
    dispatch({ type: 'SET_SUMMARY', summary });
    dispatch({ type: 'SET_STATUS', status: 'completed' });
  };

  const activePrompt = prompts[activePromptIdx];
  const prevPrompt = prompts[activePromptIdx - 1];

  // ─── Left Panel: Prompt area ─────────────────────────────────────────────────
  const leftPanel = (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}>
      <PromptTabs />
      {showDiff && prevPrompt ? (
        <PanelErrorBoundary label="Diff">
          <PromptDiff
            oldText={prevPrompt.content}
            newText={activePrompt.content}
            oldLabel={prevPrompt.label}
            newLabel={activePrompt.label}
          />
        </PanelErrorBoundary>
      ) : (
        <PanelErrorBoundary label="Editor">
          <PromptEditor />
        </PanelErrorBoundary>
      )}
      <PanelErrorBoundary label="Tools">
        <ToolDefinitionEditor tools={toolDefs} onChange={setToolDefs} />
      </PanelErrorBoundary>
    </div>
  );

  // ─── Center Panel: Config + Execution ───────────────────────────────────────
  const centerPanel = (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: 'var(--bg-surface)' }}>
      {status === 'running' || status === 'completed' ? (
        <>
          <PanelErrorBoundary label="Progress">
            <ProgressDashboard />
          </PanelErrorBoundary>

          {/* Per-model rows */}
          {selectedModels.length > 0 && (
            <PanelErrorBoundary label="Model Progress">
              <div>
                {selectedModels.map(modelId => {
                  const modelCells = state.liveFeed.filter(e => e.modelId === modelId);
                  const total = Math.max(testCases.length, 1) * prompts.length * state.runsPerCombination;
                  return (
                    <ModelProgressRow
                      key={modelId}
                      modelId={modelId}
                      completed={modelCells.length}
                      total={total}
                      avgLatencyMs={0}
                      tokensPerSec={0}
                    />
                  );
                })}
              </div>
            </PanelErrorBoundary>
          )}

          <SectionHeader title="Live Feed" />
          <PanelErrorBoundary label="Live Feed">
            <LiveFeed
              entries={state.liveFeed}
              onSelect={entry => {
                setSelectedCellId(entry.cellId);
                dispatch({ type: 'SET_RESULT_TAB', tab: 'details' });
              }}
            />
          </PanelErrorBoundary>
        </>
      ) : (
        <>
          <SectionHeader title="Models" />
          <PanelErrorBoundary label="Models">
            <ModelSelector />
          </PanelErrorBoundary>

          <SectionHeader title="Test Cases" />
          <PanelErrorBoundary label="Test Cases">
            <TestCaseEditor />
          </PanelErrorBoundary>

          <SectionHeader title="Template" />
          <PanelErrorBoundary label="Template">
            <TemplateSelector />
          </PanelErrorBoundary>

          <SectionHeader title="Judge" />
          <PanelErrorBoundary label="Judge">
            <JudgeConfig />
          </PanelErrorBoundary>

          <SectionHeader title="Execution Preview" />
          <PanelErrorBoundary label="Execution Preview">
            <ExecutionPreview />
          </PanelErrorBoundary>
        </>
      )}
    </div>
  );

  // ─── Right Panel: Results ────────────────────────────────────────────────────
  const RESULT_TABS = [
    { id: 'scoreboard', label: 'Scores' },
    { id: 'compare', label: 'Compare' },
    { id: 'details', label: 'Details' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'timeline', label: 'Timeline' },
  ] as const;

  const rightPanel = (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}>
      {/* Tab bar */}
      <div
        className="flex items-center border-b overflow-x-auto"
        style={{ borderColor: 'var(--border)', flexShrink: 0, background: 'var(--bg-surface)' }}
        role="tablist"
        aria-label="Results tabs"
      >
        {RESULT_TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={state.activeResultTab === tab.id}
            onClick={() => dispatch({ type: 'SET_RESULT_TAB', tab: tab.id })}
            className="px-3 py-2 text-xs font-medium transition-colors shrink-0"
            style={{
              color: state.activeResultTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: state.activeResultTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <PanelErrorBoundary label="Results">
        {state.activeResultTab === 'scoreboard' && <Scoreboard />}
        {state.activeResultTab === 'compare' && <CompareView />}
        {state.activeResultTab === 'details' && (
          selectedCellId
            ? <DetailView cellId={selectedCellId} />
            : <HeatmapMatrix onCellClick={(cell: EvalMatrixCell) => setSelectedCellId(cell.id)} />
        )}
        {state.activeResultTab === 'metrics' && <MetricsView />}
        {state.activeResultTab === 'timeline' && <TimelineView />}
      </PanelErrorBoundary>
    </div>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <TopBar
        onRun={handleRun}
        onExportHtml={handleExportHtml}
        onExportMd={handleExportMd}
        onSaveBaseline={handleSaveBaseline}
        onLoadPrevious={handleLoadPrevious}
      />
      <div className="flex-1 overflow-hidden">
        <ResizablePanel left={leftPanel} center={centerPanel} right={rightPanel} />
      </div>
      <BottomBar />
    </div>
  );
}

// ─── Root App with providers ────────────────────────────────────────────────────
function App() {
  return (
    <EvalProvider>
      <AppInner />
    </EvalProvider>
  );
}

export default App;
