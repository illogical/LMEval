import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { PromptPanel } from '../components/prompt/PromptPanel';
import { PromptVersionSelector } from '../components/prompt/PromptVersionSelector';
import { PromptDiffView } from '../components/prompt/PromptDiffView';
import { useEvalWizard } from '../contexts/EvalWizardContext';
import { useModelsByServer } from '../hooks/useModelsByServer';
import { ModelSelector } from '../components/model/ModelSelector';
import type { SelectedModel } from '../contexts/EvalWizardContext';
import './PromptsPage.css';

export function PromptsPage() {
  const navigate = useNavigate();
  const { state, dispatch } = useEvalWizard();
  const [showDiff, setShowDiff] = useState(false);
  const { servers, loading: serversLoading } = useModelsByServer();
  const [modelStatuses] = useState<Record<string, string>>({});

  function handleNext() {
    dispatch({ type: 'SET_STEP', payload: 2 });
    navigate('/eval/config');
  }

  const canProceed = state.promptA.content.trim().length > 0 && state.selectedModels.length > 0;

  return (
    <div className="prompts-page">
      <div className="pp-editors">
        <div className="pp-editor-col">
          <div className="pp-col-label">Prompt A</div>
          <PromptPanel
            label="A"
            isEditor
            content={state.promptA.content}
            onChange={val => dispatch({ type: 'SET_PROMPT_A', payload: { content: val } })}
          />
          <PromptVersionSelector
            onLoad={(manifest, content, version) => dispatch({
              type: 'SET_PROMPT_A',
              payload: { id: manifest.id, content, version, manifest },
            })}
          />
        </div>

        <div className="pp-editor-col">
          <div className="pp-col-label">Prompt B <span className="pp-optional">(optional)</span></div>
          <PromptPanel
            label="B"
            isEditor
            content={state.promptB.content}
            onChange={val => dispatch({ type: 'SET_PROMPT_B', payload: { content: val } })}
          />
          <PromptVersionSelector
            onLoad={(manifest, content, version) => dispatch({
              type: 'SET_PROMPT_B',
              payload: { id: manifest.id, content, version, manifest },
            })}
          />
        </div>
      </div>

      {(state.promptA.content || state.promptB.content) && (
        <div className="pp-diff-toggle">
          <button className="pp-diff-btn" onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showDiff ? 'Hide Diff' : 'Show Diff'}
          </button>
        </div>
      )}

      {showDiff && (
        <div className="pp-diff">
          <PromptDiffView contentA={state.promptA.content} contentB={state.promptB.content} />
        </div>
      )}

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

      <div className="pp-footer">
        <button
          className="pp-next-btn"
          onClick={handleNext}
          disabled={!canProceed}
        >
          Next: Configure Evaluation
          <ArrowRight size={16} />
        </button>
        {!canProceed && (
          <p className="pp-hint">Enter at least one prompt and select a model to continue</p>
        )}
      </div>
    </div>
  );
}
