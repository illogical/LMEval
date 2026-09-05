import './ResultsSkeleton.css';

/** Shimmer placeholder matching Scoreboard's leaderboard + heatmap shape, shown
 * while ResultsPage's initial fetch (config/cells/summary/testcases) is in flight. */
export function ResultsSkeleton() {
  return (
    <div className="rs-skeleton" aria-busy="true" aria-label="Loading results">
      <div className="rs-sk-header" />
      <div className="rs-sk-leaderboard">
        {[0, 1, 2].map(i => <div key={i} className="rs-sk-card" />)}
      </div>
      <div className="rs-sk-heatmap">
        {Array.from({ length: 4 * 5 }).map((_, i) => <div key={i} className="rs-sk-cell" />)}
      </div>
    </div>
  );
}
