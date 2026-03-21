import { useParams } from 'react-router-dom';
import { Zap } from 'lucide-react';
import './SummaryPage.css';

export function SummaryPage() {
  const { evalId } = useParams<{ evalId: string }>();

  return (
    <div className="summary-page">
      <div className="sp-content">
        <div className="sp-icon">
          <Zap size={48} />
        </div>
        <h2 className="sp-title">AI-Powered Summary</h2>
        <p className="sp-subtitle">Coming Soon</p>
        <div className="sp-features">
          <div className="sp-feature">
            <strong>Automated Analysis</strong>
            <p>AI will analyze your evaluation results and identify patterns, strengths, and weaknesses.</p>
          </div>
          <div className="sp-feature">
            <strong>Improvement Suggestions</strong>
            <p>Get specific, actionable suggestions for improving your prompts based on the results.</p>
          </div>
          <div className="sp-feature">
            <strong>Regression Detection</strong>
            <p>Automatically detect regressions compared to your baseline and get fix recommendations.</p>
          </div>
        </div>
        <p className="sp-eval-id">Eval ID: {evalId}</p>
      </div>
    </div>
  );
}
