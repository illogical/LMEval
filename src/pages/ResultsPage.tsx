import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Scoreboard } from '../components/results/Scoreboard';
import { CompareView } from '../components/results/CompareView';
import { DetailView } from '../components/results/DetailView';
import { BreakdownView } from '../components/results/BreakdownView';
import { TrendView } from '../components/results/TrendView';
import { VerdictHeader } from '../components/results/VerdictHeader';
import {
  getEvaluation, getEvaluationResults, getEvaluationSummary, getEvaluationTestCases,
  getEvaluationHistory, getEvaluationRegression, listBaselines, exportEvaluation, saveBaseline,
} from '../api/eval';
import type {
  EvalMatrixCell, EvaluationSummary, EvaluationConfig, TestCase, EvaluationHistoryEntry,
  BaselineSummary, RegressionResult,
} from '../types/eval';
import './ResultsPage.css';

type Tab = 'scoreboard' | 'breakdown' | 'compare' | 'detail' | 'trend';

const TABS: { id: Tab; label: string }[] = [
  { id: 'scoreboard', label: 'Scoreboard' },
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'compare', label: 'Compare' },
  { id: 'detail', label: 'Detail' },
  { id: 'trend', label: 'Trend' },
];

export function ResultsPage() {
  const { evalId } = useParams<{ evalId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('scoreboard');
  const [config, setConfig] = useState<EvaluationConfig | null>(null);
  const [cells, setCells] = useState<EvalMatrixCell[]>([]);
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [history, setHistory] = useState<EvaluationHistoryEntry[]>([]);
  const [baselines, setBaselines] = useState<BaselineSummary[]>([]);
  const [selectedBaselineSlug, setSelectedBaselineSlug] = useState('');
  const [regression, setRegression] = useState<RegressionResult | undefined>(undefined);
  const [selectedCell, setSelectedCell] = useState<EvalMatrixCell | null>(null);
  const [compareDeepLink, setCompareDeepLink] = useState<{ cellId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!evalId) return;
    setLoading(true);
    Promise.all([
      getEvaluation(evalId),
      getEvaluationResults(evalId),
      getEvaluationSummary(evalId),
      getEvaluationTestCases(evalId),
      getEvaluationHistory(evalId),
      listBaselines(),
    ])
      .then(([configData, resultsData, summaryData, testCasesData, historyData, baselinesData]) => {
        setConfig(configData);
        setCells(resultsData);
        setSummary(summaryData);
        setTestCases(testCasesData);
        setHistory(historyData);
        setBaselines(baselinesData);
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [evalId]);

  useEffect(() => {
    if (!evalId || !selectedBaselineSlug) return;
    getEvaluationRegression(evalId, selectedBaselineSlug)
      .then(setRegression)
      .catch(() => setRegression(undefined));
  }, [evalId, selectedBaselineSlug]);

  function handleSelectBaseline(slug: string) {
    setSelectedBaselineSlug(slug);
    if (!slug) setRegression(undefined);
  }

  async function handleExport(format: 'html' | 'md') {
    if (!evalId) return;
    const blob = await exportEvaluation(evalId, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eval-${evalId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const handleSaveBaseline = useCallback(async (slug: string) => {
    if (!evalId) return;
    await saveBaseline(evalId, slug);
    const refreshed = await listBaselines();
    setBaselines(refreshed);
    setSelectedBaselineSlug(slug);
  }, [evalId]);

  function handleHeatmapCellClick(cell: EvalMatrixCell) {
    setCompareDeepLink({ cellId: cell.id });
    setActiveTab('compare');
  }

  function handleViewCellInDetail(cellId: string) {
    const cell = cells.find(c => c.id === cellId);
    if (!cell) return;
    setSelectedCell(cell);
    setActiveTab('detail');
  }

  function handleCompareFromDetail(cellId: string) {
    setCompareDeepLink({ cellId });
    setActiveTab('compare');
  }

  if (loading) return <div className="rp-loading">Loading results…</div>;
  if (error) return <div className="rp-error">{error}</div>;
  if (!summary || !config) return <div className="rp-error">No results found</div>;

  const selectedBaseline = baselines.find(b => b.slug === selectedBaselineSlug);

  return (
    <div className="results-page">
      <VerdictHeader
        config={config}
        summary={summary}
        regression={regression}
        baselines={baselines}
        selectedBaselineSlug={selectedBaselineSlug}
        onSelectBaseline={handleSelectBaseline}
        onExport={handleExport}
        onSaveBaseline={handleSaveBaseline}
        onOpenSummary={() => navigate(`/eval/summary/${evalId}`)}
      />

      <div className="rp-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`rp-tab${activeTab === tab.id ? ' rp-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rp-content">
        {activeTab === 'scoreboard' && (
          <Scoreboard summary={summary} cells={cells} onCellClick={handleHeatmapCellClick} />
        )}
        {activeTab === 'breakdown' && (
          <BreakdownView summary={summary} testCases={testCases} onViewCell={handleViewCellInDetail} />
        )}
        {activeTab === 'compare' && (
          <CompareView
            cells={cells}
            testCases={testCases}
            config={config}
            summary={summary}
            deepLink={compareDeepLink}
            onConsumeDeepLink={() => setCompareDeepLink(null)}
          />
        )}
        {activeTab === 'detail' && (
          <DetailView
            cell={selectedCell}
            cells={cells}
            testCases={testCases}
            onSelectCell={setSelectedCell}
            onCompareCell={handleCompareFromDetail}
          />
        )}
        {activeTab === 'trend' && (
          <TrendView
            history={history}
            evalId={evalId!}
            summary={summary}
            config={config}
            selectedBaseline={selectedBaseline}
            onSaveBaseline={handleSaveBaseline}
          />
        )}
      </div>
    </div>
  );
}
