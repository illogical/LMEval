import './ProgressOverview.css';

interface ProgressOverviewProps {
  progress: number;  // 0-100
  completedCells: number;
  totalCells: number;
  phase?: string;
  etaMs?: number;
}

export function ProgressOverview({ progress, completedCells, totalCells, phase, etaMs }: ProgressOverviewProps) {
  return (
    <div className="progress-overview" aria-label="Overall progress">
      <div className="po-bar-wrapper">
        <div className="po-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="po-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="po-pct">{progress}%</span>
      </div>
      <div className="po-meta">
        <span className="po-cells">{completedCells} / {totalCells} cells</span>
        {phase && <span className="po-phase">{phase}</span>}
        {etaMs != null && etaMs > 0 && (
          <span className="po-eta">ETA {Math.ceil(etaMs / 1000)}s</span>
        )}
      </div>
    </div>
  );
}
