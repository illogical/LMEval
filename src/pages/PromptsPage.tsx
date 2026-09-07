import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FolderOpen, Sparkles } from 'lucide-react';
import { PromptVersionSelector } from '../components/prompt/PromptVersionSelector';
import { PromptDiffView } from '../components/prompt/PromptDiffView';
import { useEvalWizard } from '../contexts/EvalWizardContext';
import { useEvalHeaderAction } from '../contexts/EvalHeaderActionContext';
import { useModelsByServer } from '../hooks/useModelsByServer';
import { ModelSelector } from '../components/model/ModelSelector';
import { createPrompt, addPromptVersion } from '../api/eval';
import type { SelectedModel } from '../contexts/EvalWizardContext';
import type { PromptManifest, EvalComparisonMode } from '../types/eval';
import './PromptsPage.css';

// ── Types ─────────────────────────────────────────────────
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ModeOption {
  mode: EvalComparisonMode;
  label: string;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: 'model', label: 'Model Comparison', description: 'Which model is best for this fixed prompt?' },
  { mode: 'prompt', label: 'Prompt Comparison', description: 'Did my prompt edit actually make it better?' },
  { mode: 'matrix', label: 'Full Matrix', description: 'Vary both prompts and models freely.' },
];

// ── EvaluationModeStrip ───────────────────────────────────
function EvaluationModeStrip({
  mode,
  onChange,
}: {
  mode: EvalComparisonMode;
  onChange: (mode: EvalComparisonMode) => void;
}) {
  return (
    <div className="pp-mode-strip" role="radiogroup" aria-label="Evaluation mode">
      {MODE_OPTIONS.map(opt => (
        <button
          key={opt.mode}
          type="button"
          role="radio"
          aria-checked={mode === opt.mode}
          className={`pp-mode-card${mode === opt.mode ? ' pp-mode-card--active' : ''}`}
          onClick={() => onChange(opt.mode)}
        >
          <span className="pp-mode-card-label">{opt.label}</span>
          <span className="pp-mode-card-desc">{opt.description}</span>
        </button>
      ))}
    </div>
  );
}

interface SelectorBarProps {
  label: string;
  showControls: boolean;
  onLoad: (manifest: PromptManifest, content: string, version: number) => void;
  onFileContent: (content: string) => void;
  children?: React.ReactNode; // extra controls at the right
}

// ── SelectorBar ───────────────────────────────────────────
function SelectorBar({ label, showControls, onLoad, onFileContent, children }: SelectorBarProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file.name.match(/\.(md|txt)$/i)) return;
    const reader = new FileReader();
    reader.onload = ev => onFileContent(ev.target?.result as string);
    reader.readAsText(file);
  }

  return (
    <div
      className={`pp-selector-bar${isDragOver ? ' pp-selector-bar--drag' : ''}`}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
    >
      <span className="pp-selector-label">Prompt {label}</span>

      {showControls && (
        <>
          <PromptVersionSelector onLoad={onLoad} />
          <span className="pp-drop-hint">
            Drop .md/.txt or{' '}
            <button className="pp-browse-btn" onClick={() => fileInputRef.current?.click()}>
              browse
            </button>
          </span>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md"
        hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        aria-label={`Upload prompt ${label} file`}
      />

      {children && <div className="pp-selector-actions">{children}</div>}
    </div>
  );
}

// ── PromptsPage ───────────────────────────────────────────
export function PromptsPage() {
  const navigate = useNavigate();
  const { state, dispatch } = useEvalWizard();
  const { setHeaderAction } = useEvalHeaderAction();
  const { servers, loading: serversLoading } = useModelsByServer();
  const [modelStatuses] = useState<Record<string, string>>({});

  // Load-controls toggle (shared for both A and B)
  const [showLoadControls, setShowLoadControls] = useState(false);

  // Prompt B draft (inline editing is always active)
  const [draftB, setDraftB] = useState(state.promptB.content);
  const [debouncedB, setDebouncedB] = useState(state.promptB.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // Sync draftB when promptB is loaded from outside (selector/drop)
  useEffect(() => {
    const id = setTimeout(() => setDraftB(state.promptB.content), 0);
    return () => clearTimeout(id);
  }, [state.promptB.content]);

  // Debounce draftB → debouncedB (300ms)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedB(draftB), 300);
    return () => clearTimeout(id);
  }, [draftB]);

  const handleNext = useCallback(() => {
    dispatch({ type: 'SET_STEP', payload: 2 });
    navigate('/eval/config');
  }, [dispatch, navigate]);

  const isModelComparison = state.comparisonMode === 'model';
  const hasEnoughModels = isModelComparison
    ? state.selectedModels.length >= 2
    : state.selectedModels.length > 0;
  const canProceed = state.promptA.content.trim().length > 0 && hasEnoughModels;
  const showPromptComparisonNudge =
    !isModelComparison && state.selectedModels.length === 1;

  let blockedHint: string | null = null;
  if (!canProceed) {
    if (state.promptA.content.trim().length === 0) {
      blockedHint = 'Enter at least one prompt and select a model to continue';
    } else if (isModelComparison && state.selectedModels.length < 2) {
      blockedHint = 'Model Comparison needs at least 2 models selected';
    } else {
      blockedHint = 'Select a model to continue';
    }
  }

  // Header action: Next button
  useEffect(() => {
    setHeaderAction(
      <div className="pp-header-action">
        {blockedHint && <p className="pp-hint">{blockedHint}</p>}
        {!blockedHint && showPromptComparisonNudge && (
          <p className="pp-hint pp-hint--nudge">Add another model to see if this holds up across models too</p>
        )}
        <button className="pp-next-btn" onClick={handleNext} disabled={!canProceed}>
          Next: Prepare <ArrowRight size={16} />
        </button>
      </div>
    );
    return () => setHeaderAction(null);
  }, [canProceed, blockedHint, showPromptComparisonNudge, handleNext, setHeaderAction]);

  async function handleSaveCopy() {
    setSaveStatus('saving');
    try {
      let manifest: PromptManifest;
      if (state.promptB.manifest) {
        manifest = await addPromptVersion(state.promptB.manifest.id, draftB);
      } else {
        manifest = await createPrompt('Prompt B (draft)', draftB);
      }
      const newVersion = manifest.versions[manifest.versions.length - 1].version;
      dispatch({
        type: 'SET_PROMPT_B',
        payload: { id: manifest.id, content: draftB, version: newVersion, manifest },
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  const hasUnsavedEdits = draftB !== state.promptB.content;

  return (
    <div className="prompts-page">
      {/* Evaluation mode */}
      <EvaluationModeStrip
        mode={state.comparisonMode}
        onChange={mode => dispatch({ type: 'SET_COMPARISON_MODE', payload: mode })}
      />

      {state.purposeTemplateName && (
        <div className="pp-provenance-badge">
          <Sparkles size={12} /> from template: {state.purposeTemplateName}
        </div>
      )}

      {/* Selector bars */}
      <div className="pp-selectors">
        <SelectorBar
          label="A"
          showControls={showLoadControls}
          onLoad={(manifest, content, version) => dispatch({
            type: 'SET_PROMPT_A',
            payload: { id: manifest.id, content, version, manifest },
          })}
          onFileContent={val => dispatch({ type: 'SET_PROMPT_A', payload: { content: val } })}
        />
        {!isModelComparison && (
          <SelectorBar
            label="B"
            showControls={showLoadControls}
            onLoad={(manifest, content, version) => dispatch({
              type: 'SET_PROMPT_B',
              payload: { id: manifest.id, content, version, manifest },
            })}
            onFileContent={val => { dispatch({ type: 'SET_PROMPT_B', payload: { content: val } }); setDraftB(val); }}
          >
            {hasUnsavedEdits && <span className="pp-editor-unsaved">unsaved</span>}
            <button
              className="pp-save-btn"
              onClick={handleSaveCopy}
              disabled={saveStatus === 'saving' || !draftB.trim()}
            >
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error' : 'Save copy'}
            </button>
          </SelectorBar>
        )}

        {/* Single toggle for load controls (both A & B) */}
        <button
          className={`pp-load-toggle${showLoadControls ? ' pp-load-toggle--active' : ''}`}
          onClick={() => setShowLoadControls(v => !v)}
          title={showLoadControls ? 'Hide load controls' : 'Load a prompt file'}
          aria-pressed={showLoadControls}
        >
          <FolderOpen size={15} />
        </button>
      </div>

      {/* Main content: single editor in Model Comparison mode, diff otherwise */}
      <div className="pp-content">
        {isModelComparison ? (
          <div className="pp-single-editor">
            <span className="pp-single-editor-label">Prompt</span>
            <textarea
              className="pp-single-editor-textarea"
              value={state.promptA.content}
              onChange={e => dispatch({ type: 'SET_PROMPT_A', payload: { content: e.target.value } })}
              spellCheck={false}
              aria-label="Prompt content"
              placeholder="Enter the system prompt to evaluate across models…"
            />
          </div>
        ) : (
          <div className="pp-diff">
            <PromptDiffView
              contentA={state.promptA.content}
              contentB={debouncedB}
              editableB
              draftB={draftB}
              onChangeB={setDraftB}
            />
          </div>
        )}
      </div>

      {/* Models */}
      <div className="pp-models">
        <div className="pp-section-title">Models</div>
        <ModelSelector
          servers={servers}
          loading={serversLoading}
          selectedModels={state.selectedModels as SelectedModel[]}
          onSelectionChange={models => dispatch({ type: 'SET_MODELS', payload: models as SelectedModel[] })}
          modelStatuses={modelStatuses as Record<string, 'idle' | 'loading' | 'done' | 'error'>}
          onNavigateToModel={() => {}}
        />
      </div>
    </div>
  );
}
