import { useState } from 'react';
import { ArrowRight, Download, ChevronDown } from 'lucide-react';
import type { EvaluationConfig, EvaluationSummary, RegressionResult, BaselineSummary } from '../../types/eval';
import { buildGateVerdict, buildVerdict } from '../../lib/verdict';
import './VerdictHeader.css';

interface VerdictHeaderProps {
  config: EvaluationConfig;
  summary: EvaluationSummary;
  regression?: RegressionResult;
  baselines: BaselineSummary[];
  selectedBaselineSlug: string;
  onSelectBaseline: (slug: string) => void;
  onExport: (format: 'html' | 'md') => void;
  onSaveBaseline: (slug: string) => Promise<void>;
  onOpenSummary: () => void;
}

export function VerdictHeader({
  config, summary, regression, baselines, selectedBaselineSlug, onSelectBaseline,
  onExport, onSaveBaseline, onOpenSummary,
}: VerdictHeaderProps) {
  const [baselineInput, setBaselineInput] = useState(false);
  const [slugDraft, setSlugDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const gateHeadline = buildGateVerdict(config, summary);
  const { headline: scoreHeadline, detail } = buildVerdict(config, summary);
  // R8: gate verdict is the primary read when available; the score-based
  // headline becomes supporting detail rather than disappearing.
  const headline = gateHeadline ?? scoreHeadline;
  const scoreAsDetail = gateHeadline ? scoreHeadline : null;

  const caveats: string[] = [];
  if ((config.runsPerCell ?? 1) <= 1) caveats.push('n=1 run per cell — differences under ±0.3 are noise');
  if (summary.failedCells > 0) caveats.push(`${summary.failedCells} of ${summary.totalCells} cells failed`);
  if (summary.truncationRate != null && summary.truncationRate > 0) {
    caveats.push(`${(summary.truncationRate * 100).toFixed(0)}% of responses were truncated (not "stop")`);
  }
  if (summary.resolvedInference == null) {
    caveats.push('inference parameters unspecified — not usable as a baseline or promotion input');
  }

  const scoreDelta = regression?.metrics.find(m => m.metric === 'compositeScore');

  async function handleSave() {
    if (!slugDraft.trim()) return;
    setSaving(true);
    try {
      await onSaveBaseline(slugDraft.trim());
      setBaselineInput(false);
      setSlugDraft('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="verdict-header">
      <div className="vh-top">
        <div className="vh-verdict">
          <span className="vh-headline">{headline}</span>
          {scoreAsDetail && <span className="vh-detail"> — {scoreAsDetail}</span>}
          {detail && !scoreAsDetail && <span className="vh-detail"> — {detail}</span>}
        </div>
        <div className="vh-actions">
          {baselines.length > 0 && (
            <div className="vh-baseline-picker">
              <select
                className="vh-select"
                value={selectedBaselineSlug}
                onChange={e => onSelectBaseline(e.target.value)}
              >
                <option value="">vs. baseline…</option>
                {baselines.map(b => (
                  <option key={b.slug} value={b.slug}>{b.slug}</option>
                ))}
              </select>
              <ChevronDown size={12} className="vh-select-chevron" />
            </div>
          )}
          {baselineInput ? (
            <div className="vh-baseline-input">
              <input
                className="vh-slug-input"
                placeholder="baseline name…"
                value={slugDraft}
                onChange={e => setSlugDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                autoFocus
              />
              <button className="rp-action-btn" onClick={handleSave} disabled={saving || !slugDraft.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="rp-action-btn" onClick={() => setBaselineInput(false)}>Cancel</button>
            </div>
          ) : (
            <button className="rp-action-btn rp-baseline-btn" onClick={() => setBaselineInput(true)}>
              Save Baseline
            </button>
          )}
          <button className="rp-action-btn" onClick={() => onExport('md')} title="Export Markdown">
            <Download size={14} /> MD
          </button>
          <button className="rp-action-btn" onClick={() => onExport('html')} title="Export HTML">
            <Download size={14} /> HTML
          </button>
          <button className="rp-summary-btn" onClick={onOpenSummary}>
            Summary & Suggestions <ArrowRight size={14} />
          </button>
        </div>
      </div>
      {(caveats.length > 0 || scoreDelta) && (
        <div className="vh-chips">
          {scoreDelta && scoreDelta.status !== 'unchanged' && (
            <span className={`vh-chip ${scoreDelta.status === 'improved' ? 'vh-chip-good' : 'vh-chip-bad'}`}>
              {scoreDelta.status === 'improved' ? '↑' : '↓'} {scoreDelta.delta >= 0 ? '+' : ''}{scoreDelta.delta.toFixed(2)} vs baseline
            </span>
          )}
          {caveats.map(c => (
            <span key={c} className="vh-chip vh-chip-warn">{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}
