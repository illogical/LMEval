import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { TemplateSelector } from '../components/config/TemplateSelector';
import { TestCaseEditor } from '../components/config/TestCaseEditor';
import { JudgeConfig } from '../components/config/JudgeConfig';
import { ExecutionPreview } from '../components/config/ExecutionPreview';
import { PresetSelector } from '../components/config/PresetSelector';
import { useEvalWizard } from '../contexts/EvalWizardContext';
import { useEvalHeaderAction } from '../contexts/EvalHeaderActionContext';
import { createEvaluation, createPrompt, createPurposeTemplate, getPurposeTemplate, getTemplate, getTestSuite, listEvaluations } from '../api/eval';
import type { EvalPurposeTemplate, TestSuite } from '../types/eval';
import './ConfigPage.css';

export function ConfigPage() {
  const navigate = useNavigate();
  const { state, dispatch } = useEvalWizard();
  const { setHeaderAction } = useEvalHeaderAction();
  const [running, setRunning] = useState(false);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [judgeRequired, setJudgeRequired] = useState(false);
  const [purposeTemplate, setPurposeTemplate] = useState<EvalPurposeTemplate | null>(null);
  const [regressionPreviouslyExposed, setRegressionPreviouslyExposed] = useState(false);
  const [selectedSuite, setSelectedSuite] = useState<TestSuite | null>(null);
  const [perspectiveCount, setPerspectiveCount] = useState(0);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showSaveTemplateForm, setShowSaveTemplateForm] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  useEffect(() => {
    if (!state.purposeTemplateId) { setJudgeRequired(false); setPurposeTemplate(null); return; }
    let cancelled = false;
    getPurposeTemplate(state.purposeTemplateId)
      .then(t => { if (!cancelled) { setPurposeTemplate(t); setJudgeRequired(t.assertionStrategy.type === 'grounded-summary'); } })
      .catch(() => { if (!cancelled) { setPurposeTemplate(null); setJudgeRequired(false); } });
    return () => { cancelled = true; };
  }, [state.purposeTemplateId]);

  useEffect(() => {
    const suiteId = purposeTemplate?.defaultTestSuiteId;
    const current = [state.promptA, state.promptB].filter(prompt => prompt.id);
    if (!suiteId || state.benchmarkMode !== 'promotion-check' || current.length === 0) {
      setRegressionPreviouslyExposed(false);
      return;
    }
    let cancelled = false;
    listEvaluations().then(evaluations => {
      if (cancelled) return;
      setRegressionPreviouslyExposed(evaluations.some(evaluation =>
        evaluation.benchmarkProvenance?.suiteId === suiteId
        && evaluation.benchmarkProvenance.includedSplits.includes('regression')
        && current.every(prompt => evaluation.benchmarkProvenance?.promptVersions.some(version => version.promptId === prompt.id && version.version === prompt.version))
      ));
    }).catch(() => { if (!cancelled) setRegressionPreviouslyExposed(false); });
    return () => { cancelled = true; };
  }, [purposeTemplate?.defaultTestSuiteId, state.benchmarkMode, state.promptA, state.promptB]);

  useEffect(() => {
    if (!state.testSuiteId) { setSelectedSuite(null); return; }
    let cancelled = false;
    getTestSuite(state.testSuiteId).then(suite => { if (!cancelled) setSelectedSuite(suite); }).catch(() => { if (!cancelled) setSelectedSuite(null); });
    return () => { cancelled = true; };
  }, [state.testSuiteId]);

  // Perspective count drives the judge-call estimate in the Execution Preview.
  useEffect(() => {
    if (!state.templateId || !state.judgeModelId) { setPerspectiveCount(0); return; }
    let cancelled = false;
    getTemplate(state.templateId)
      .then(t => { if (!cancelled) setPerspectiveCount(t.perspectives?.length ?? 0); })
      .catch(() => { if (!cancelled) setPerspectiveCount(0); });
    return () => { cancelled = true; };
  }, [state.templateId, state.judgeModelId]);

  async function handleSaveAsTemplate() {
    if (!newTemplateName.trim()) return;
    setSavingTemplate(true);
    try {
      const strategyType = state.judgeModelId && state.templateId ? 'grounded-summary' as const : 'custom' as const;
      await createPurposeTemplate({
        name: newTemplateName.trim(),
        description: '',
        seedPromptContent: state.promptA.content,
        defaultComparisonMode: state.comparisonMode,
        assertionStrategy: strategyType === 'grounded-summary'
          ? { type: 'grounded-summary', config: { templateId: state.templateId! } }
          : { type: 'custom', config: { description: newTemplateName.trim() } },
        starterTestCases: state.inlineTestCases,
      });
      setNewTemplateName('');
      setShowSaveTemplateForm(false);
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 2500);
    } catch (err) {
      console.error('Failed to save template:', err);
    } finally {
      setSavingTemplate(false);
    }
  }

  const promptCount = [state.promptA, state.promptB].filter(p => p.content.trim()).length;
  const modelCount = state.selectedModels.length;
  function calcTestCaseCount(): number {
    if (selectedSuite) {
      return selectedSuite.builtIn && state.benchmarkMode === 'calibration'
        ? selectedSuite.testCases.filter(testCase => testCase.caseTags?.includes('split:calibration')).length
        : selectedSuite.testCases.length;
    }
    if (state.testSuiteId) return 1;
    if (state.inlineTestCases.length > 0) return state.inlineTestCases.length;
    if (state.userMessage) return 1;
    return 1;
  }
  const testCaseCount = calcTestCaseCount();

  // Hard blockers stop the run; warnings let it proceed but flag a weak result.
  const blockers: string[] = [];
  if (promptCount === 0) blockers.push('At least one prompt is required — go back to Step 1 and enter a prompt.');
  if (modelCount === 0) blockers.push('Select at least one model in Step 1.');
  if (state.comparisonMode === 'model' && modelCount < 2) {
    blockers.push('Model Comparison needs at least 2 models to compare.');
  }
  if (state.comparisonMode === 'prompt' && promptCount < 2) {
    blockers.push('Prompt Comparison needs content in both Prompt A and Prompt B.');
  }

  const warnings: string[] = [];
  if (blockers.length === 0 && judgeRequired && !state.judgeModelId) {
    warnings.push('This template grades with an LLM judge, but no judge model is selected — only deterministic checks will run.');
  }
  if (blockers.length === 0 && !state.testSuiteId && state.inlineTestCases.length === 0 && !state.userMessage.trim()) {
    warnings.push('No test cases defined — the run will send an empty user message.');
  }
  if (blockers.length === 0 && selectedSuite?.provenance?.reviewStatus === 'pending-human-review') {
    warnings.push('This benchmark is pending human review, so its result is advisory and not promotion-capable.');
  }

  const runDisabled = running || blockers.length > 0;

  const handleRun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);

    try {
      // Auto-save any prompt slot that has content but no saved ID
      let promptAId = state.promptA.id;
      let promptBId = state.promptB.id;

      const needsSaveA = !promptAId && !!state.promptA.content.trim();
      const needsSaveB = !promptBId && !!state.promptB.content.trim();
      if (needsSaveA || needsSaveB) setSavingPrompts(true);

      if (needsSaveA) {
        const manifest = await createPrompt(`Draft Prompt A`, state.promptA.content);
        promptAId = manifest.id;
        dispatch({ type: 'SET_PROMPT_A', payload: { id: manifest.id, manifest } });
      }
      if (needsSaveB) {
        const manifest = await createPrompt(`Draft Prompt B`, state.promptB.content);
        promptBId = manifest.id;
        dispatch({ type: 'SET_PROMPT_B', payload: { id: manifest.id, manifest } });
      }
      setSavingPrompts(false);

      const promptIds = [promptAId, promptBId].filter((id): id is string => id != null);

      const modelIds = state.selectedModels.map(m => `${m.serverName}::${m.modelName}`);

      const result = await createEvaluation({
        name: `Eval ${new Date().toLocaleString()}`,
        promptIds,
        modelIds,
        comparisonMode: state.comparisonMode,
        purposeTemplateId: state.purposeTemplateId ?? undefined,
        templateId: state.templateId ?? undefined,
        testSuiteId: state.testSuiteId ?? undefined,
        benchmarkMode: state.testSuiteId ? state.benchmarkMode : undefined,
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
      setSavingPrompts(false);
      setRunning(false);
    }
  }, [running, state, dispatch, navigate]);

  // Inject Run button into the step indicator header
  const blockerTooltip = blockers.join(' ');
  useEffect(() => {
    setHeaderAction(
      <button
        className="cp-run-header-btn"
        onClick={handleRun}
        disabled={runDisabled}
        title={blockerTooltip || 'Start the evaluation'}
        aria-describedby={blockerTooltip ? 'cp-blockers' : undefined}
      >
        <Play size={15} />
        {savingPrompts ? 'Saving prompts…' : running ? 'Starting…' : 'Run Evaluation'}
      </button>
    );
    return () => setHeaderAction(null);
  }, [running, savingPrompts, runDisabled, blockerTooltip, handleRun, setHeaderAction]);

  return (
    <div className="config-page">
      <div className="cp-content">
        <div className="cp-col">
          <div className="cp-card">
            <h3 className="cp-section-title">Evaluation Template</h3>
            <TemplateSelector
              value={state.templateId}
              onChange={id => dispatch({ type: 'SET_CONFIG', payload: { templateId: id } })}
              promptContent={state.promptA.content}
            />
          </div>

          <div className="cp-card">
            <h3 className="cp-section-title">
              Test Cases
              {state.inlineTestCases.length > 0 && (
                <span className="cp-count-badge">{state.inlineTestCases.length}</span>
              )}
            </h3>
            <TestCaseEditor
              userMessage={state.userMessage}
              onUserMessageChange={msg => dispatch({ type: 'SET_CONFIG', payload: { userMessage: msg } })}
              testSuiteId={state.testSuiteId}
              onTestSuiteChange={id => dispatch({ type: 'SET_CONFIG', payload: { testSuiteId: id, inlineTestCases: id ? [] : state.inlineTestCases, benchmarkMode: 'calibration' } })}
              inlineTestCases={state.inlineTestCases}
              onInlineTestCasesChange={cases => dispatch({ type: 'SET_CONFIG', payload: { inlineTestCases: cases, testSuiteId: cases.length ? null : state.testSuiteId } })}
              purposeCategory={purposeTemplate?.purposeCategory}
              recommendedSuiteId={purposeTemplate?.defaultTestSuiteId}
              starterTestCases={purposeTemplate?.starterTestCases ?? []}
              benchmarkMode={state.benchmarkMode}
              onBenchmarkModeChange={mode => dispatch({ type: 'SET_CONFIG', payload: { benchmarkMode: mode } })}
              regressionPreviouslyExposed={regressionPreviouslyExposed}
            />
          </div>

          <div className="cp-card">
            <h3 className="cp-section-title">
              Judge Configuration
              {judgeRequired && <span className="cp-required-badge">Required for this template</span>}
            </h3>
            <JudgeConfig
              judgeModelId={state.judgeModelId}
              onJudgeModelChange={id => dispatch({ type: 'SET_CONFIG', payload: { judgeModelId: id } })}
              enablePairwise={state.enablePairwise}
              onPairwiseChange={v => dispatch({ type: 'SET_CONFIG', payload: { enablePairwise: v } })}
              runsPerCell={state.runsPerCell}
              onRunsPerCellChange={n => dispatch({ type: 'SET_CONFIG', payload: { runsPerCell: n } })}
            />
          </div>

          <div className="cp-card">
            <h3 className="cp-section-title">Save as Template</h3>
            <div className="cp-save-template">
              {!showSaveTemplateForm ? (
                <button
                  className="cp-save-template-btn"
                  onClick={() => setShowSaveTemplateForm(true)}
                  disabled={!state.promptA.content.trim()}
                >
                  {templateSaved ? '✓ Saved' : '📋 Save as Template'}
                </button>
              ) : (
                <div className="cp-save-template-form">
                  <input
                    className="cp-save-template-input"
                    value={newTemplateName}
                    onChange={e => setNewTemplateName(e.target.value)}
                    placeholder="Template name…"
                    onKeyDown={e => e.key === 'Enter' && handleSaveAsTemplate()}
                  />
                  <button onClick={handleSaveAsTemplate} disabled={savingTemplate || !newTemplateName.trim()}>
                    {savingTemplate ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setShowSaveTemplateForm(false)}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="cp-sidebar">
          <div className="cp-card">
            <h3 className="cp-section-title">Execution Preview</h3>
            <ExecutionPreview
              promptCount={promptCount}
              modelCount={modelCount || 1}
              testCaseCount={testCaseCount}
              runsPerCell={state.runsPerCell}
              judgePerspectiveCount={perspectiveCount}
            />
          </div>

          {blockers.length > 0 && (
            <div className="cp-card cp-blockers" id="cp-blockers" role="alert">
              <h3 className="cp-section-title">Before you can run</h3>
              <ul className="cp-issue-list">
                {blockers.map(b => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="cp-card cp-warnings">
              <h3 className="cp-section-title">Worth checking</h3>
              <ul className="cp-issue-list">
                {warnings.map(w => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="cp-card">
            <h3 className="cp-section-title">Presets</h3>
            <PresetSelector
              currentState={{
                templateId: state.templateId,
                testSuiteId: state.testSuiteId,
                judgeModelId: state.judgeModelId,
                enablePairwise: state.enablePairwise,
                runsPerCell: state.runsPerCell,
                modelIds: state.selectedModels.map(m => `${m.serverName}::${m.modelName}`),
                comparisonMode: state.comparisonMode,
              }}
              onLoad={preset => dispatch({ type: 'LOAD_PRESET', payload: preset })}
            />
          </div>

          {error && <p className="cp-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
