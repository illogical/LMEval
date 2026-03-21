import type { RegressionResult } from '../../types/eval';
import './RegressionBanner.css';

interface RegressionBannerProps {
  regression: RegressionResult;
}

export function RegressionBanner({ regression }: RegressionBannerProps) {
  if (!regression.hasRegressions && !regression.hasImprovements) return null;

  const improvements = regression.metrics.filter(m => m.status === 'improved');
  const regressions = regression.metrics.filter(m => m.status === 'regressed');

  return (
    <div className="regression-banner">
      {improvements.length > 0 && (
        <div className="rb-improvements">
          {improvements.map(m => (
            <span key={m.metric} className="rb-item rb-item-improved">
              ↑ {m.metric} +{Math.abs(m.delta).toFixed(2)}
            </span>
          ))}
        </div>
      )}
      {regressions.length > 0 && (
        <div className="rb-regressions">
          {regressions.map(m => (
            <span key={m.metric} className="rb-item rb-item-regressed">
              ↓ {m.metric} −{Math.abs(m.delta).toFixed(2)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
