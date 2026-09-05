import { useState } from 'react';
import { ArrowRight, Download, ChevronDown } from 'lucide-react';
import type { EvaluationConfig, EvaluationSummary, RegressionResult, BaselineSummary } from '../../types/eval';
import { formatScore, formatLatency } from '../../lib/scoring';
import { modelShortName } from '../../lib/labels';
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

/**
 * R8: when a built-in purpose template's gate verdict is available, it is the
 * primary read — pass/fail before ranked score. "granite4.1:8b is the only
 * candidate that clears the classification gate" rather than "scored 4.2."
 * This only fires for comparisonMode: 'model' (a gate is a property of a
 * model's output quality, not of a prompt pairing) with exactly one model
 * summary standing in for the run's overall gate outcome; multi-model gate
 * comparison (which models individually clear/miss the gate) is A11's
 * per-task reporting work, not this pass's VerdictHeader scope.
 */
function buildGateVerdict(config: EvaluationConfig, summary: EvaluationSummary): string | null {
  const gate = summary.taskMetrics?.gate;
  if (!gate) return null;
  const top = [...summary.modelSummaries].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
  const subject = top ? modelShortName(top.modelId) : (config.name || 'This candidate');
  if (gate.pass) {
    return `${subject} clears the ${summary.taskMetrics!.taskType} gate`;
  }
  return `${subject} does NOT clear the ${summary.taskMetrics!.taskType} gate — ${gate.failures[0] ?? 'see task metrics'}`;
}

function buildVerdict(config: EvaluationConfig, summary: EvaluationSummary): { headline: string; detail: string } {
  const models = [...summary.modelSummaries].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const top = models[0];
  const runnerUp = models[1];

  if (config.comparisonMode === 'prompt' && config.promptIds.length >= 2) {
    const a = summary.promptSummaries.find(p => p.promptId === config.promptIds[0]);
    const b = summary.promptSummaries.find(p => p.promptId === config.promptIds[1]);
    if (a?.avgCompositeScore != null && b?.avgCompositeScore != null) {
      const delta = b.avgCompositeScore - a.avgCompositeScore;
      const verb = delta > 0 ? 'improves on' : delta < 0 ? 'falls behind' : 'ties';
      return {
        headline: `Prompt B ${verb} Prompt A by ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`,
        detail: `${formatScore(a.avgCompositeScore)} → ${formatScore(b.avgCompositeScore)}`,
      };
    }
  }

  if (config.comparisonMode === 'model' || !config.comparisonMode) {
    if (top) {
      const name = modelShortName(top.modelId);
      const scoreText = top.avgCompositeScore != null ? `${formatScore(top.avgCompositeScore)}/5` : 'no score';
      const detailParts = [
        `${scoreText}`,
        `${(top.successRate * 100).toFixed(0)}% pass`,
        `${formatLatency(top.avgDurationMs)} avg`,
      ];
      let detail = detailParts.join(' · ');
      if (runnerUp && top.avgCompositeScore != null && runnerUp.avgCompositeScore != null) {
        const gap = top.avgCompositeScore - runnerUp.avgCompositeScore;
        detail += `. Runner-up ${modelShortName(runnerUp.modelId)} trails by ${gap.toFixed(1)}`;
      }
      return { headline: `${name} is the best fit`, detail };
    }
  }

  // matrix mode / fallback: report the two axes independently rather than
  // fabricating a per-(prompt×model) combo the summary data can't back up.
  const bestPrompt = [...summary.promptSummaries].sort(
    (a, b) => (b.avgCompositeScore ?? 0) - (a.avgCompositeScore ?? 0)
  )[0];
  const parts: string[] = [];
  if (top) parts.push(`Best model: ${modelShortName(top.modelId)}${top.avgCompositeScore != null ? ` (${formatScore(top.avgCompositeScore)})` : ''}`);
  if (bestPrompt) parts.push(`Best prompt: v${bestPrompt.promptVersion}${bestPrompt.avgCompositeScore != null ? ` (${formatScore(bestPrompt.avgCompositeScore)})` : ''}`);
  return { headline: parts.join(' · ') || 'Evaluation complete', detail: '' };
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
