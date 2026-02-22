import { useEffect, useRef, useState } from 'react';
import { useEval } from '../../context/EvalContext';
import { evalApi } from '../../api/eval';

interface HistoryPoint {
  evalId: string;
  score: number;
  date: string;
}

export function TimelineView() {
  const { state } = useEval();
  const { prompts, activePromptIdx } = state;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const activePrompt = prompts[activePromptIdx];

  useEffect(() => {
    if (!activePrompt?.savedPromptId) return;
    setLoading(true);
    evalApi.getPromptHistory(activePrompt.savedPromptId)
      .then(h => setHistory(h as HistoryPoint[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activePrompt?.savedPromptId]);

  useEffect(() => {
    if (!canvasRef.current || history.length < 2) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = 160;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, W, H);

    const scores = history.map(h => h.score);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    const pad = 24;

    const toX = (i: number) => pad + (i / (history.length - 1)) * (W - pad * 2);
    const toY = (s: number) => H - pad - ((s - minS) / Math.max(maxS - minS, 1)) * (H - pad * 2);

    ctx.beginPath();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    history.forEach((h, i) => {
      const x = toX(i);
      const y = toY(h.score);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Points
    history.forEach((h, i) => {
      ctx.beginPath();
      ctx.arc(toX(i), toY(h.score), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
    });

    // Labels
    ctx.fillStyle = '#a1a1aa';
    ctx.font = `${9}px sans-serif`;
    ctx.textAlign = 'center';
    history.forEach((h, i) => {
      ctx.fillText(
        new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        toX(i),
        H - 4
      );
    });
  }, [history]);

  if (!activePrompt?.savedPromptId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        Save a prompt to view its score history.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        Loading history…
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        No history yet for this prompt.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
        Score History: {activePrompt.label}
      </div>
      <canvas
        ref={canvasRef}
        className="w-full rounded"
        style={{ height: 160, display: 'block', background: 'var(--bg-elevated)' }}
        aria-label="Score history line chart"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Date', 'Eval ID', 'Score'].map(h => (
                <th key={h} className="px-2 py-1.5 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.evalId} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {new Date(h.date).toLocaleDateString()}
                </td>
                <td className="px-2 py-1.5 font-mono truncate max-w-32" style={{ color: 'var(--text-primary)' }}>
                  {h.evalId.slice(0, 12)}…
                </td>
                <td className="px-2 py-1.5 font-bold font-mono" style={{ color: 'var(--accent)' }}>
                  {h.score.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
