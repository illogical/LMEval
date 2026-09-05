import { Sparkles, Play } from 'lucide-react';
import type { SummaryAnalysis } from '../../types/session';
import './ImprovementSuggestions.css';

interface ImprovementSuggestionsProps {
  analysis: SummaryAnalysis | null;
  refinementModelConfigured: boolean;
  generating: boolean;
  generateError: string | null;
  onGenerate: () => void;
  applyingId: string | null;
  onApply: (suggestionId: string, rerun: boolean) => void;
}

export function ImprovementSuggestions({
  analysis, refinementModelConfigured, generating, generateError, onGenerate, applyingId, onApply,
}: ImprovementSuggestionsProps) {
  if (!refinementModelConfigured) {
    return (
      <div className="is-panel is-degraded">
        <p>
          No refinement model configured — set <code>REFINEMENT_MODEL</code> to enable AI-generated
          improvement suggestions. The raw summary above is unaffected.
        </p>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="is-panel">
        <button className="is-generate-btn" onClick={onGenerate} disabled={generating}>
          <Sparkles size={14} />
          {generating ? 'Analyzing…' : 'Generate AI Suggestions'}
        </button>
        {generateError && <p className="is-error">{generateError}</p>}
      </div>
    );
  }

  return (
    <div className="is-panel">
      {(analysis.strengths.length > 0 || analysis.weaknesses.length > 0) && (
        <div className="is-lists">
          {analysis.strengths.length > 0 && (
            <div className="is-list is-strengths">
              <h5>Strengths</h5>
              <ul>{analysis.strengths.map(s => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          {analysis.weaknesses.length > 0 && (
            <div className="is-list is-weaknesses">
              <h5>Weaknesses</h5>
              <ul>{analysis.weaknesses.map(w => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {analysis.suggestions.length === 0 ? (
        <p className="is-none">No prompt-revision suggestions this time.</p>
      ) : (
        <div className="is-cards">
          {analysis.suggestions.map(s => (
            <div key={s.id} className="is-card">
              <div className="is-card-header">
                <span className="is-slot-badge">Prompt {s.targetSlot}</span>
                {s.estimatedImpact && <span className="is-impact">{s.estimatedImpact}</span>}
              </div>
              <p className="is-rationale">{s.rationale}</p>
              <details className="is-diff">
                <summary>Show revised prompt</summary>
                <pre className="is-revised">{s.revisedContent}</pre>
              </details>
              <div className="is-card-actions">
                <button
                  className="is-apply-btn"
                  disabled={applyingId === s.id}
                  onClick={() => onApply(s.id, false)}
                >
                  {applyingId === s.id ? 'Applying…' : 'Apply Suggestion'}
                </button>
                <button
                  className="is-apply-rerun-btn"
                  disabled={applyingId === s.id}
                  onClick={() => onApply(s.id, true)}
                >
                  <Play size={12} /> Apply & Re-run
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="is-regenerate-btn" onClick={onGenerate} disabled={generating}>
        {generating ? 'Regenerating…' : 'Regenerate suggestions'}
      </button>
      {generateError && <p className="is-error">{generateError}</p>}
    </div>
  );
}
