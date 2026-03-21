import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Download } from 'lucide-react';
import { Scoreboard } from '../components/results/Scoreboard';
import { CompareView } from '../components/results/CompareView';
import { DetailView } from '../components/results/DetailView';
import { MetricsView } from '../components/results/MetricsView';
import { TimelineView } from '../components/results/TimelineView';
import { RegressionBanner } from '../components/results/RegressionBanner';
import { getEvaluationResults, getEvaluationSummary, exportEvaluation, saveBaseline } from '../api/eval';
import type { EvalMatrixCell, EvaluationSummary } from '../types/eval';
import './ResultsPage.css';

type Tab = 'scoreboard' | 'compare' | 'detail' | 'metrics' | 'timeline';

export function ResultsPage() {
  const { evalId } = useParams<{ evalId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('scoreboard');
  const [cells, setCells] = useState<EvalMatrixCell[]>([]);
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [selectedCell, setSelectedCell] = useState<EvalMatrixCell | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!evalId) return;
    setLoading(true);
    Promise.all([
      getEvaluationResults(evalId),
      getEvaluationSummary(evalId),
    ])
      .then(([resultsData, summaryData]) => {
        setCells(resultsData.cells);
        setSummary(summaryData);
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [evalId]);

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

  async function handleBaseline() {
    if (!evalId) return;
    const slug = prompt('Enter a name for this baseline:');
    if (!slug) return;
    await saveBaseline(evalId, slug).catch(console.error);
    alert('Baseline saved!');
  }

  function handleCellClick(cell: EvalMatrixCell) {
    setSelectedCell(cell);
    setActiveTab('detail');
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'scoreboard', label: 'Scoreboard' },
    { id: 'compare', label: 'Compare' },
    { id: 'detail', label: 'Detail' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'timeline', label: 'Timeline' },
  ];

  if (loading) return <div className="rp-loading">Loading results…</div>;
  if (error) return <div className="rp-error">{error}</div>;
  if (!summary) return <div className="rp-error">No results found</div>;

  return (
    <div className="results-page">
      <div className="rp-header">
        <div className="rp-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`rp-tab${activeTab === tab.id ? ' rp-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="rp-actions">
          <button className="rp-action-btn" onClick={() => handleExport('md')} title="Export Markdown">
            <Download size={14} /> MD
          </button>
          <button className="rp-action-btn" onClick={() => handleExport('html')} title="Export HTML">
            <Download size={14} /> HTML
          </button>
          <button className="rp-action-btn rp-baseline-btn" onClick={handleBaseline}>
            Save Baseline
          </button>
          <button className="rp-summary-btn" onClick={() => navigate(`/eval/summary/${evalId}`)}>
            Summary & Suggestions <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {summary.regression && <div className="rp-banner"><RegressionBanner regression={summary.regression} /></div>}

      <div className="rp-content">
        {activeTab === 'scoreboard' && (
          <Scoreboard summary={summary} cells={cells} onCellClick={handleCellClick} />
        )}
        {activeTab === 'compare' && <CompareView cells={cells} />}
        {activeTab === 'detail' && <DetailView cell={selectedCell} />}
        {activeTab === 'metrics' && <MetricsView summary={summary} />}
        {activeTab === 'timeline' && <TimelineView summary={summary} />}
      </div>
    </div>
  );
}
