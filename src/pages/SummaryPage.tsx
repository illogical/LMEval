import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SummaryOverview } from '../components/summary/SummaryOverview';
import { GateMetricsPanel } from '../components/summary/GateMetricsPanel';
import { PerModelAnalysis } from '../components/summary/PerModelAnalysis';
import { ImprovementSuggestions } from '../components/summary/ImprovementSuggestions';
import {
  getEvaluation, getEvaluationSummary, getEvaluationTestCases, getHealth,
  getSummaryAnalysis, generateSummaryAnalysis, addPromptVersion, listPromptVersions,
  addSessionVersion, createEvaluation,
} from '../api/eval';
import type { EvaluationConfig, EvaluationSummary, TestCase } from '../types/eval';
import type { SummaryAnalysis } from '../types/session';
import './SummaryPage.css';

export function SummaryPage() {
  const { evalId } = useParams<{ evalId: string }>();
  const navigate = useNavigate();

  const [config, setConfig] = useState<EvaluationConfig | null>(null);
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [refinementModelConfigured, setRefinementModelConfigured] = useState(false);
  const [analysis, setAnalysis] = useState<SummaryAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!evalId) return;
    setLoading(true);
    Promise.all([
      getEvaluation(evalId),
      getEvaluationSummary(evalId),
      getEvaluationTestCases(evalId),
      getHealth(),
      getSummaryAnalysis(evalId),
    ])
      .then(([configData, summaryData, testCasesData, health, analysisData]) => {
        setConfig(configData);
        setSummary(summaryData);
        setTestCases(testCasesData);
        setRefinementModelConfigured(health.refinementModelConfigured);
        setAnalysis(analysisData);
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [evalId]);

  const handleGenerate = useCallback(async () => {
    if (!evalId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await generateSummaryAnalysis(evalId);
      setAnalysis(result);
    } catch (err) {
      setGenerateError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [evalId]);

  const handleApply = useCallback(async (suggestionId: string, rerun: boolean) => {
    if (!config || !analysis) return;
    const suggestion = analysis.suggestions.find(s => s.id === suggestionId);
    if (!suggestion) return;

    setApplyingId(suggestionId);
    setApplyError(null);
    setApplySuccess(null);
    try {
      const slotIndex = suggestion.targetSlot === 'A' ? 0 : 1;
      const promptId = config.promptIds[slotIndex];
      if (!promptId) throw new Error(`No prompt in slot ${suggestion.targetSlot} to revise`);

      const updated = await addPromptVersion(promptId, suggestion.revisedContent, suggestion.rationale || undefined);
      const newVersion = updated.versions.at(-1)?.version ?? 1;
      let newSessionVersion: number | undefined;

      // Only meaningful for a two-prompt (A/B) session — a single-prompt
      // model-comparison config has no second slot to carry forward.
      if (config.sessionId && config.promptIds.length >= 2) {
        const otherIndex = 1 - slotIndex;
        const otherPromptId = config.promptIds[otherIndex];
        const otherVersions = await listPromptVersions(otherPromptId);
        const otherVersion = otherVersions.at(-1)?.version ?? 1;

        const slotA = slotIndex === 0
          ? { promptId, promptVersion: newVersion }
          : { promptId: otherPromptId, promptVersion: otherVersion };
        const slotB = slotIndex === 1
          ? { promptId, promptVersion: newVersion }
          : { promptId: otherPromptId, promptVersion: otherVersion };

        const updatedSession = await addSessionVersion(config.sessionId, {
          description: suggestion.rationale || undefined,
          promptA: slotA,
          promptB: slotB,
        });
        newSessionVersion = updatedSession.latestVersion;
      }

      if (rerun) {
        const result = await createEvaluation({
          name: config.name,
          promptIds: config.promptIds,
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
          benchmarkMode: config.benchmarkMode,
          sessionId: config.sessionId,
          sessionVersion: newSessionVersion ?? config.sessionVersion,
        });
        navigate(`/eval/run/${result.id}`);
        return;
      }

      setApplySuccess(`Applied — Prompt ${suggestion.targetSlot} updated to v${newVersion}.`);
    } catch (err) {
      setApplyError((err as Error).message);
    } finally {
      setApplyingId(null);
    }
  }, [config, analysis, navigate]);

  if (loading) return <div className="sp-loading">Loading summary…</div>;
  if (error) return <div className="sp-error">{error}</div>;
  if (!config || !summary) return <div className="sp-error">No results found</div>;

  return (
    <div className="summary-page">
      <div className="sp-content">
        <SummaryOverview config={config} summary={summary} analysisOverview={analysis?.overview} />

        {summary.taskMetrics && (
          <GateMetricsPanel title="Task Metrics" tm={summary.taskMetrics} defaultOpen />
        )}

        <section className="sp-section">
          <h3 className="sp-section-title">Per-Model Analysis</h3>
          <PerModelAnalysis summary={summary} testCases={testCases} />
        </section>

        <section className="sp-section">
          <h3 className="sp-section-title">Improvement Suggestions</h3>
          <ImprovementSuggestions
            analysis={analysis}
            refinementModelConfigured={refinementModelConfigured}
            generating={generating}
            generateError={generateError}
            onGenerate={handleGenerate}
            applyingId={applyingId}
            onApply={handleApply}
          />
          {applySuccess && <p className="sp-apply-success">{applySuccess}</p>}
          {applyError && <p className="sp-apply-error">{applyError}</p>}
        </section>
      </div>
    </div>
  );
}
