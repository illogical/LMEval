import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ElapsedTimer } from '../components/dashboard/ElapsedTimer';
import { LiveFeed } from '../components/dashboard/LiveFeed';
import { EvalSummaryBar } from '../components/dashboard/EvalSummaryBar';
import { PromptRunCard } from '../components/dashboard/PromptRunCard';
import { ErrorPanel } from '../components/dashboard/ErrorPanel';
import { WsStatusDot } from '../components/dashboard/WsStatusDot';
import { useEvalSocket } from '../hooks/useEvalSocket';
import { getEvaluation, getEvaluationResults } from '../api/eval';
import type { EvalMatrixCell, EvaluationConfig } from '../types/eval';
import type { ModelCellInfo } from '../components/dashboard/ModelStatusRow';
import type { CellFailure } from '../components/dashboard/ErrorPanel';
import './DashboardPage.css';

export function DashboardPage() {
  const { evalId } = useParams<{ evalId: string }>();
  const navigate = useNavigate();
  const { events, isCompleted: wsCompleted, status: wsStatus } = useEvalSocket(evalId ?? null);
  const startTimeRef = useRef(Date.now());

  const [evalConfig, setEvalConfig] = useState<EvaluationConfig | null>(null);
  const [completedCells, setCompletedCells] = useState<EvalMatrixCell[]>([]);
  const [failures, setFailures] = useState<CellFailure[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Map from "promptId::modelId" → ModelCellInfo for tracking status per cell
  const [cellStatusMap, setCellStatusMap] = useState<Map<string, ModelCellInfo>>(new Map());

  // Fetch eval config on mount
  useEffect(() => {
    if (!evalId) return;
    getEvaluation(evalId).then(cfg => {
      setEvalConfig(cfg);

      // If already done, load results from REST and skip WS
      if (cfg.status === 'completed' || cfg.status === 'failed') {
        setIsCompleted(cfg.status === 'completed');
        getEvaluationResults(evalId)
          .then(r => {
            const cells = Array.isArray(r) ? r : (r as { cells?: EvalMatrixCell[] }).cells ?? [];
            setCompletedCells(cells);
            const failed: CellFailure[] = cells
              .filter(c => c.status === 'failed')
              .map(c => ({ cellId: c.id, modelId: c.modelId, promptId: c.promptId, error: c.error ?? 'Unknown error' }));
            setFailures(failed);
            // Build cell status map from REST results
            const map = new Map<string, ModelCellInfo>();
            for (const cell of cells) {
              const key = `${cell.promptId}::${cell.modelId}`;
              map.set(key, {
                modelId: cell.modelId,
                serverName: cell.serverName,
                status: cell.status === 'completed' ? 'completed' : cell.status === 'failed' ? 'failed' : 'pending',
                durationMs: cell.durationMs,
                tokensPerSecond: cell.tokensPerSecond,
                error: cell.error,
              });
            }
            setCellStatusMap(map);
          })
          .catch(() => {});
      }
    }).catch(() => {});
  }, [evalId]);

  // Process WS events
  useEffect(() => {
    for (const event of events) {
      if (event.type === 'cell:started') {
        const d = event.data as { cellId?: string; promptId?: string; modelId?: string };
        if (d.promptId && d.modelId) {
          const key = `${d.promptId}::${d.modelId}`;
          setCellStatusMap(prev => {
            const next = new Map(prev);
            const existing = next.get(key);
            next.set(key, { ...existing, modelId: d.modelId!, status: 'running' });
            return next;
          });
        }
      }

      if (event.type === 'cell:completed') {
        const d = event.data as { cellId?: string; modelId?: string; promptId?: string; durationMs?: number; tokensPerSecond?: number; inputTokens?: number; outputTokens?: number };

        // Prefer explicit tokensPerSecond from event; fall back to computing from token/duration
        let tps: number | undefined = d.tokensPerSecond;
        if (tps == null && d.outputTokens && d.durationMs && d.durationMs > 0) {
          tps = Math.round((d.outputTokens / d.durationMs) * 1000);
        }

        // Build a minimal EvalMatrixCell for the live feed
        const partial: EvalMatrixCell = {
          id: (d as { cellId?: string }).cellId ?? `cell-${Date.now()}`,
          evalId: evalId ?? '',
          promptId: d.promptId ?? '',
          promptVersion: 1,
          modelId: d.modelId ?? '',
          testCaseId: '',
          run: 1,
          status: 'completed',
          durationMs: d.durationMs,
          tokensPerSecond: tps,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
        };
        setCompletedCells(prev => [...prev, partial]);

        if (d.promptId && d.modelId) {
          const key = `${d.promptId}::${d.modelId}`;
          setCellStatusMap(prev => {
            const next = new Map(prev);
            next.set(key, {
              modelId: d.modelId!,
              status: 'completed',
              durationMs: d.durationMs,
              tokensPerSecond: partial.tokensPerSecond,
            });
            return next;
          });
        }
      }

      if (event.type === 'cell:failed') {
        // Payload is { cellId, error } — NOT a full EvalMatrixCell
        const d = event.data as { cellId?: string; modelId?: string; promptId?: string; error?: string };
        const partial: EvalMatrixCell = {
          id: d.cellId ?? `cell-${Date.now()}`,
          evalId: evalId ?? '',
          promptId: d.promptId ?? '',
          promptVersion: 1,
          modelId: d.modelId ?? '',
          testCaseId: '',
          run: 1,
          status: 'failed',
          error: d.error ?? 'Unknown error',
        };
        setCompletedCells(prev => [...prev, partial]);

        if (d.modelId) {
          const failure: CellFailure = {
            cellId: d.cellId ?? '',
            modelId: d.modelId,
            promptId: d.promptId ?? '',
            error: d.error ?? 'Unknown error',
          };
          setFailures(prev => [...prev, failure]);

          if (d.promptId) {
            const key = `${d.promptId}::${d.modelId}`;
            setCellStatusMap(prev => {
              const next = new Map(prev);
              next.set(key, {
                modelId: d.modelId!,
                status: 'failed',
                error: d.error ?? 'Unknown error',
              });
              return next;
            });
          }
        }
      }

      if (event.type === 'eval:completed') {
        setIsCompleted(true);
      }
    }
  }, [events, evalId]);

  // Also mark complete when WS signals it
  useEffect(() => {
    if (wsCompleted) setIsCompleted(true);
  }, [wsCompleted]);

  // Build per-prompt model lists from evalConfig + cellStatusMap
  function buildModelCells(promptId: string): ModelCellInfo[] {
    if (!evalConfig) return [];
    return evalConfig.modelIds.map(modelId => {
      const key = `${promptId}::${modelId}`;
      const tracked = cellStatusMap.get(key);
      return tracked ?? { modelId, status: 'pending' };
    });
  }

  const handleRetryAll = useCallback(async () => {
    if (!evalId) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/eval/evaluations/${evalId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failedCellsOnly: true }),
      });
      if (res.ok) {
        const { evalId: newEvalId } = await res.json() as { evalId: string };
        navigate(`/eval/run/${newEvalId}`);
      }
    } catch {
      // noop
    } finally {
      setRetrying(false);
    }
  }, [evalId, navigate]);

  const promptIds = evalConfig?.promptIds ?? [];

  return (
    <div className="dashboard-page">
      {/* Header row */}
      <div className="dp-header">
        <div className="dp-header-left">
          <h2 className="dp-title">{isCompleted ? 'Evaluation Complete' : 'Evaluation Running'}</h2>
          <ElapsedTimer startTime={startTimeRef.current} stopped={isCompleted} />
          <WsStatusDot status={wsStatus} />
        </div>
        <div className="dp-header-right">
          {isCompleted && (
            <button className="dp-results-btn" onClick={() => navigate(`/eval/results/${evalId}`)}>
              View Results <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Eval summary */}
      {evalId && <EvalSummaryBar evalId={evalId} />}

      {/* Two-column prompt run cards */}
      <div className="dp-prompt-grid">
        {promptIds.length === 0 && (
          <p className="dp-waiting">Loading evaluation…</p>
        )}
        {promptIds.map((promptId, idx) => (
          <PromptRunCard
            key={promptId}
            label={idx === 0 ? 'A' : 'B'}
            promptName={`Prompt ${idx === 0 ? 'A' : 'B'}`}
            models={buildModelCells(promptId)}
          />
        ))}
      </div>

      {/* Error panel (only shown on failures) */}
      {failures.length > 0 && evalId && (
        <ErrorPanel
          failures={failures}
          evalId={evalId}
          onRetry={handleRetryAll}
          retrying={retrying}
        />
      )}

      {/* Live feed */}
      <div className="dp-feed-section">
        <div className="dp-section-title">Live Feed</div>
        <LiveFeed cells={completedCells} />
      </div>
    </div>
  );
}
