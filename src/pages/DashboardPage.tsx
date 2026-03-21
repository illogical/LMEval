import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ElapsedTimer } from '../components/dashboard/ElapsedTimer';
import { ProgressOverview } from '../components/dashboard/ProgressOverview';
import { ModelProgressGrid } from '../components/dashboard/ModelProgressGrid';
import { LiveFeed } from '../components/dashboard/LiveFeed';
import { useEvalSocket } from '../hooks/useEvalSocket';
import { getEvaluationSummary } from '../api/eval';
import type { EvalMatrixCell } from '../types/eval';
import './DashboardPage.css';

interface ModelProgress {
  modelId: string;
  serverName?: string;
  done: number;
  total: number;
  avgLatencyMs?: number;
  tokensPerSec?: number;
}

export function DashboardPage() {
  const { evalId } = useParams<{ evalId: string }>();
  const navigate = useNavigate();
  const { progress, events, isCompleted } = useEvalSocket(evalId ?? null);
  const startTimeRef = useRef(Date.now());
  const [completedCells, setCompletedCells] = useState<EvalMatrixCell[]>([]);
  const [modelProgress, setModelProgress] = useState<ModelProgress[]>([]);
  const [totalCells, setTotalCells] = useState(0);
  const [doneCells, setDoneCells] = useState(0);

  useEffect(() => {
    for (const event of events) {
      if (event.type === 'cell:completed' || event.type === 'cell:failed') {
        const cell = event.data as unknown as EvalMatrixCell;
        setCompletedCells(prev => [...prev, cell]);
      }
      if (event.type === 'eval:progress') {
        const d = event.data as { completedCells?: number; totalCells?: number };
        if (d.totalCells) setTotalCells(d.totalCells);
        if (d.completedCells != null) setDoneCells(d.completedCells);
      }
    }
  }, [events]);

  // Build model progress from completed cells
  useEffect(() => {
    const groups = new Map<string, { done: number; total: number; latencies: number[]; tpsVals: number[] }>();
    for (const cell of completedCells) {
      const existing = groups.get(cell.modelId) ?? { done: 0, total: 0, latencies: [], tpsVals: [] };
      existing.done += 1;
      if (cell.durationMs) existing.latencies.push(cell.durationMs);
      if (cell.tokensPerSecond) existing.tpsVals.push(cell.tokensPerSecond);
      groups.set(cell.modelId, existing);
    }
    const progresses: ModelProgress[] = Array.from(groups.entries()).map(([modelId, g]) => ({
      modelId,
      serverName: completedCells.find(c => c.modelId === modelId)?.serverName,
      done: g.done,
      total: Math.max(g.done, Math.ceil(totalCells / (groups.size || 1))),
      avgLatencyMs: g.latencies.length > 0 ? g.latencies.reduce((a, b) => a + b, 0) / g.latencies.length : undefined,
      tokensPerSec: g.tpsVals.length > 0 ? g.tpsVals.reduce((a, b) => a + b, 0) / g.tpsVals.length : undefined,
    }));
    setModelProgress(progresses);
  }, [completedCells, totalCells]);

  useEffect(() => {
    if (isCompleted && evalId) {
      // Optionally auto-navigate after a short delay
      // setTimeout(() => navigate(`/eval/results/${evalId}`), 1500);
    }
  }, [isCompleted, evalId, navigate]);

  return (
    <div className="dashboard-page">
      <div className="dp-header">
        <div className="dp-header-left">
          <h2 className="dp-title">Evaluation Running</h2>
          <ElapsedTimer startTime={startTimeRef.current} stopped={isCompleted} />
        </div>
        <div className="dp-header-right">
          {isCompleted && (
            <button className="dp-results-btn" onClick={() => navigate(`/eval/results/${evalId}`)}>
              View Results <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="dp-progress">
        <ProgressOverview
          progress={progress}
          completedCells={doneCells}
          totalCells={totalCells}
          phase={isCompleted ? 'Completed' : 'Running completions'}
        />
      </div>

      <div className="dp-content">
        <div className="dp-models">
          <div className="dp-section-title">Model Progress</div>
          <ModelProgressGrid models={modelProgress} />
          {modelProgress.length === 0 && (
            <p className="dp-waiting">Waiting for first results…</p>
          )}
        </div>

        <div className="dp-feed">
          <div className="dp-section-title">Live Feed</div>
          <LiveFeed cells={completedCells} />
        </div>
      </div>
    </div>
  );
}
