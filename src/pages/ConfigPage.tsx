import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { TemplateSelector } from '../components/config/TemplateSelector';
import { TestCaseEditor } from '../components/config/TestCaseEditor';
import { JudgeConfig } from '../components/config/JudgeConfig';
import { ExecutionPreview } from '../components/config/ExecutionPreview';
import { PresetSelector } from '../components/config/PresetSelector';
import { useEvalWizard } from '../contexts/EvalWizardContext';
import { createEvaluation, createPrompt } from '../api/eval';
import './ConfigPage.css';

export function ConfigPage() {
  const navigate = useNavigate();
  const { state, dispatch } = useEvalWizard();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptCount = [state.promptA, state.promptB].filter(p => p.content.trim()).length;
  const modelCount = state.selectedModels.length;
  function calcTestCaseCount(): number {
    if (state.testSuiteId) return 1;
    if (state.inlineTestCases.length > 0) return state.inlineTestCases.length;
    if (state.userMessage) return 1;
    return 1;
  }
  const testCaseCount = calcTestCaseCount();

  async function handleRun() {
    if (running) return;
    setRunning(true);
    setError(null);

    try {
      // Auto-save any prompt slot that has content but no saved ID
      let promptAId = state.promptA.id;
      let promptBId = state.promptB.id;

      if (!promptAId && state.promptA.content.trim()) {
        const manifest = await createPrompt(`Draft Prompt A`, state.promptA.content);
        promptAId = manifest.id;
        dispatch({ type: 'SET_PROMPT_A', payload: { id: manifest.id, manifest } });
      }
      if (!promptBId && state.promptB.content.trim()) {
        const manifest = await createPrompt(`Draft Prompt B`, state.promptB.content);
        promptBId = manifest.id;
        dispatch({ type: 'SET_PROMPT_B', payload: { id: manifest.id, manifest } });
      }

      const promptIds = [promptAId, promptBId].filter((id): id is string => id != null);

      const modelIds = state.selectedModels.map(m => `${m.serverName}::${m.modelName}`);

      const result = await createEvaluation({
        name: `Eval ${new Date().toLocaleString()}`,
        promptIds,
        modelIds,
        templateId: state.templateId ?? undefined,
        testSuiteId: state.testSuiteId ?? undefined,
        inlineTestCases: state.inlineTestCases.length > 0 ? state.inlineTestCases : undefined,
        userMessage: state.userMessage || undefined,
        judgeModelId: state.judgeModelId ?? undefined,
        enablePairwise: state.enablePairwise,
        runsPerCell: state.runsPerCell,
      });

      dispatch({ type: 'START_EVAL', payload: { evalId: result.id } });
      navigate(`/eval/run/${result.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="config-page">
      <div className="cp-content">
        <div className="cp-col">
          <div className="cp-section">
            <h3 className="cp-section-title">Evaluation Template</h3>
            <TemplateSelector
              value={state.templateId}
              onChange={id => dispatch({ type: 'SET_CONFIG', payload: { templateId: id } })}
              promptContent={state.promptA.content}
            />
          </div>

          <div className="cp-section">
            <h3 className="cp-section-title">Test Cases</h3>
            <TestCaseEditor
              userMessage={state.userMessage}
              onUserMessageChange={msg => dispatch({ type: 'SET_CONFIG', payload: { userMessage: msg } })}
              testSuiteId={state.testSuiteId}
              onTestSuiteChange={id => dispatch({ type: 'SET_CONFIG', payload: { testSuiteId: id } })}
              inlineTestCases={state.inlineTestCases}
              onInlineTestCasesChange={cases => dispatch({ type: 'SET_CONFIG', payload: { inlineTestCases: cases } })}
            />
          </div>

          <div className="cp-section">
            <h3 className="cp-section-title">Judge Configuration</h3>
            <JudgeConfig
              judgeModelId={state.judgeModelId}
              onJudgeModelChange={id => dispatch({ type: 'SET_CONFIG', payload: { judgeModelId: id } })}
              enablePairwise={state.enablePairwise}
              onPairwiseChange={v => dispatch({ type: 'SET_CONFIG', payload: { enablePairwise: v } })}
              runsPerCell={state.runsPerCell}
              onRunsPerCellChange={n => dispatch({ type: 'SET_CONFIG', payload: { runsPerCell: n } })}
            />
          </div>
        </div>

        <div className="cp-sidebar">
          <div className="cp-section">
            <h3 className="cp-section-title">Execution Preview</h3>
            <ExecutionPreview
              promptCount={promptCount}
              modelCount={modelCount || 1}
              testCaseCount={testCaseCount}
              runsPerCell={state.runsPerCell}
            />
          </div>

          <div className="cp-section">
            <h3 className="cp-section-title">Presets</h3>
            <PresetSelector
              currentState={{
                templateId: state.templateId,
                testSuiteId: state.testSuiteId,
                judgeModelId: state.judgeModelId,
                enablePairwise: state.enablePairwise,
                runsPerCell: state.runsPerCell,
                modelIds: state.selectedModels.map(m => `${m.serverName}::${m.modelName}`),
              }}
              onLoad={preset => dispatch({ type: 'LOAD_PRESET', payload: preset })}
            />
          </div>

          {error && <p className="cp-error">{error}</p>}

          <button className="cp-run-btn" onClick={handleRun} disabled={running || modelCount === 0}>
            <Play size={16} />
            {running ? 'Starting…' : 'Run Evaluation'}
          </button>
        </div>
      </div>
    </div>
  );
}
