import { useEffect, useMemo, useState } from 'react';
import type { EvalMatrixCell, EvaluationConfig, EvaluationSummary, TestCase } from '../../types/eval';
import { PromptDiffView } from '../prompt/PromptDiffView';
import { formatScore } from '../../lib/scoring';
import { modelShortName, testCaseLabel } from '../../lib/labels';
import './CompareView.css';

export type CompareAxis = 'model' | 'prompt';

interface CompareViewProps {
  cells: EvalMatrixCell[];
  testCases: TestCase[];
  config: EvaluationConfig;
  summary: EvaluationSummary;
  /** Set when arriving via a heatmap-cell deep link; pre-selects A (and B, when possible). */
  deepLink?: { cellId: string } | null;
  onConsumeDeepLink?: () => void;
}

function cellPerspectiveScores(cell: EvalMatrixCell): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const jr of cell.judgeResults ?? []) scores[jr.perspectiveId] = jr.score;
  for (const ar of cell.assertionResults ?? []) {
    if (ar.type === 'llm-rubric' && ar.score != null && ar.metric) {
      scores[ar.metric] = 1 + Math.max(0, Math.min(1, ar.score)) * 4;
    }
  }
  return scores;
}

function promptKey(promptId: string, promptVersion: number) {
  return `${promptId}:${promptVersion}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied (insecure origin, permission) — leave the label alone
      // rather than claiming a copy that did not happen.
    }
  }

  return (
    <button className="cv-copy-btn" onClick={copy} disabled={!text} title="Copy response to clipboard">
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

/** Latency and token accounting for one response, below the panel. */
function ResponseStats({ cell }: { cell?: EvalMatrixCell }) {
  if (!cell) return null;
  const parts: string[] = [];
  if (cell.durationMs != null) parts.push(`${(cell.durationMs / 1000).toFixed(2)}s`);
  if (cell.inputTokens != null || cell.outputTokens != null) {
    parts.push(`${cell.inputTokens ?? '?'} in / ${cell.outputTokens ?? '?'} out tok`);
  }
  if (cell.tokensPerSecond != null) parts.push(`${cell.tokensPerSecond.toFixed(1)} tok/s`);
  if (cell.finishReason && cell.finishReason !== 'stop') parts.push(`finish: ${cell.finishReason}`);
  if (parts.length === 0) return null;
  return <div className="cv-stats">{parts.join(' · ')}</div>;
}

/** One response column: header, copy affordance, body, and stats footer. */
function ResponsePanel({
  headerClass, label, cell, emptyLabel = 'No response',
}: {
  headerClass?: string;
  label: string;
  cell?: EvalMatrixCell;
  emptyLabel?: string;
}) {
  const response = cell?.response ?? '';
  return (
    <div className="cv-panel">
      <div className={`cv-panel-header${headerClass ? ` ${headerClass}` : ''}`}>
        <span className="cv-panel-title">{label}</span>
        <CopyButton text={response} />
      </div>
      <pre className="cv-response">{response || (cell ? emptyLabel : 'No completed cell')}</pre>
      <ResponseStats cell={cell} />
    </div>
  );
}

export function CompareView({ cells, testCases, config, summary, deepLink, onConsumeDeepLink }: CompareViewProps) {
  const completed = useMemo(() => cells.filter(c => c.status === 'completed'), [cells]);

  const modelIds = useMemo(() => [...new Set(completed.map(c => c.modelId))].sort(), [completed]);
  const promptKeys = useMemo(
    () => [...new Set(completed.map(c => promptKey(c.promptId, c.promptVersion)))],
    [completed]
  );
  const testCaseIds = useMemo(() => [...new Set(completed.map(c => c.testCaseId))], [completed]);

  const defaultAxis: CompareAxis = config.comparisonMode === 'prompt' ? 'prompt' : 'model';
  const [axis, setAxis] = useState<CompareAxis>(defaultAxis);
  const [holdTestCase, setHoldTestCase] = useState(testCaseIds[0] ?? '');
  const [holdPrompt, setHoldPrompt] = useState(promptKeys[0] ?? '');
  const [holdModel, setHoldModel] = useState(modelIds[0] ?? '');
  const [selA, setSelA] = useState('');
  const [selB, setSelB] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [nUp, setNUp] = useState(false);

  // Resolve the axis values available under the current "holding" filters.
  const axisValues = axis === 'model' ? modelIds : promptKeys;

  function cellFor(axisValue: string): EvalMatrixCell | undefined {
    return completed.find(c => {
      if (c.testCaseId !== holdTestCase) return false;
      if (axis === 'model') {
        return c.modelId === axisValue && (!holdPrompt || promptKey(c.promptId, c.promptVersion) === holdPrompt);
      }
      return promptKey(c.promptId, c.promptVersion) === axisValue && (!holdModel || c.modelId === holdModel);
    });
  }

  function axisValueLabel(axisValue: string): string {
    const c = cellFor(axisValue);
    const base = axis === 'model' ? modelShortName(axisValue) : `v${axisValue.split(':')[1]}`;
    if (!c) return base;
    const scoreText = c.compositeScore != null ? formatScore(c.compositeScore) : '—';
    const passIcon = c.assertionResults?.length
      ? (c.assertionResults.every(a => a.pass) ? '✓' : `✗${c.assertionResults.filter(a => !a.pass).length}`)
      : '';
    return `${base} — ${scoreText}${passIcon ? ` ${passIcon}` : ''}`;
  }

  // Initialize / repair selections whenever axis or hold filters change.
  useEffect(() => {
    if (!axisValues.includes(selA)) setSelA(axisValues[0] ?? '');
    if (!axisValues.includes(selB) || selB === selA) {
      setSelB(axisValues.find(v => v !== (axisValues.includes(selA) ? selA : axisValues[0])) ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, holdTestCase, holdPrompt, holdModel]);

  // Consume a heatmap deep link: land on the clicked cell as A, on Model axis,
  // holding its test case (and prompt, if multi-prompt) fixed.
  useEffect(() => {
    if (!deepLink) return;
    const cell = cells.find(c => c.id === deepLink.cellId);
    if (cell) {
      setAxis('model');
      setHoldTestCase(cell.testCaseId);
      setHoldPrompt(promptKey(cell.promptId, cell.promptVersion));
      setSelA(cell.modelId);
      const counterpart = modelIds.find(m => m !== cell.modelId);
      if (counterpart) setSelB(counterpart);
    }
    onConsumeDeepLink?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink]);

  function handleSelectA(value: string) {
    if (value === selB) setSelB(selA);
    setSelA(value);
  }
  function handleSelectB(value: string) {
    if (value === selA) setSelA(selB);
    setSelB(value);
  }

  const cellA = selA ? cellFor(selA) : undefined;
  const cellB = selB ? cellFor(selB) : undefined;

  const pairwise = cellA && cellB
    ? summary.pairwiseRankings?.find(
        r => (r.cellIdA === cellA.id && r.cellIdB === cellB.id) || (r.cellIdA === cellB.id && r.cellIdB === cellA.id)
      )
    : undefined;

  function renderDeltaRibbon() {
    if (!cellA || !cellB) return null;
    const scoreDelta = cellA.compositeScore != null && cellB.compositeScore != null
      ? cellB.compositeScore - cellA.compositeScore
      : undefined;

    const persA = cellPerspectiveScores(cellA);
    const persB = cellPerspectiveScores(cellB);
    const perspectiveKeys = [...new Set([...Object.keys(persA), ...Object.keys(persB)])];

    const passA = new Map((cellA.assertionResults ?? []).map(a => [`${a.type}::${a.metric ?? ''}`, a.pass]));
    const passB = new Map((cellB.assertionResults ?? []).map(a => [`${a.type}::${a.metric ?? ''}`, a.pass]));
    const assertionDiffs: string[] = [];
    for (const key of new Set([...passA.keys(), ...passB.keys()])) {
      const a = passA.get(key);
      const b = passB.get(key);
      if (a !== b) {
        const label = key.split('::')[1] || key.split('::')[0];
        assertionDiffs.push(`${label}: A ${a ? '✓' : '✗'} → B ${b ? '✓' : '✗'}`);
      }
    }

    return (
      <div className="cv-ribbon">
        {scoreDelta != null && (
          <div className={`cv-ribbon-item ${scoreDelta === 0 ? '' : scoreDelta > 0 ? 'cv-ribbon-good' : 'cv-ribbon-bad'}`}>
            <span className="cv-ribbon-label">Composite</span>
            <span className="cv-ribbon-value">{scoreDelta >= 0 ? '+' : ''}{scoreDelta.toFixed(2)}</span>
          </div>
        )}
        {perspectiveKeys.map(key => {
          const a = persA[key];
          const b = persB[key];
          if (a == null && b == null) return null;
          const delta = a != null && b != null ? b - a : undefined;
          return (
            <div key={key} className={`cv-ribbon-item ${delta == null ? '' : delta === 0 ? '' : delta > 0 ? 'cv-ribbon-good' : 'cv-ribbon-bad'}`}>
              <span className="cv-ribbon-label">{key}</span>
              <span className="cv-ribbon-value">{delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}` : '—'}</span>
            </div>
          );
        })}
        {assertionDiffs.length > 0 && (
          <div className="cv-ribbon-assertions">
            {assertionDiffs.map(d => <span key={d} className="cv-ribbon-assertion">{d}</span>)}
          </div>
        )}
        {pairwise && (
          <div className="cv-pairwise">
            <span className="cv-pairwise-winner">Judge picked {pairwise.winner === 'A' ? 'A' : pairwise.winner === 'B' ? 'B' : 'a tie'}</span>
            {pairwise.justification && <span className="cv-pairwise-just">— {pairwise.justification}</span>}
          </div>
        )}
      </div>
    );
  }

  if (completed.length === 0) {
    return <div className="cv-empty">No completed cells to compare yet</div>;
  }

  return (
    <div className="compare-view">
      <div className="cv-controls">
        <div className="cv-control">
          <label className="cv-label" htmlFor="cv-axis">Compare across</label>
          <select id="cv-axis" className="cv-select" value={axis} onChange={e => setAxis(e.target.value as CompareAxis)}>
            <option value="model">Models</option>
            <option value="prompt" disabled={promptKeys.length < 2}>Prompts</option>
          </select>
        </div>
        <div className="cv-control">
          <label className="cv-label" htmlFor="cv-hold-tc">Holding: test case</label>
          <select id="cv-hold-tc" className="cv-select" value={holdTestCase} onChange={e => setHoldTestCase(e.target.value)}>
            {testCaseIds.map((tc, i) => (
              <option key={tc} value={tc}>{testCaseLabel(tc, testCases, i)}</option>
            ))}
          </select>
        </div>
        {axis === 'model' && promptKeys.length > 1 && (
          <div className="cv-control">
            <label className="cv-label" htmlFor="cv-hold-prompt">Holding: prompt</label>
            <select id="cv-hold-prompt" className="cv-select" value={holdPrompt} onChange={e => setHoldPrompt(e.target.value)}>
              {promptKeys.map(pk => <option key={pk} value={pk}>v{pk.split(':')[1]}</option>)}
            </select>
          </div>
        )}
        {axis === 'prompt' && modelIds.length > 1 && (
          <div className="cv-control">
            <label className="cv-label" htmlFor="cv-hold-model">Holding: model</label>
            <select id="cv-hold-model" className="cv-select" value={holdModel} onChange={e => setHoldModel(e.target.value)}>
              {modelIds.map(m => <option key={m} value={m}>{modelShortName(m)}</option>)}
            </select>
          </div>
        )}
        <div className="cv-view-toggle">
          <button className={`cv-toggle-btn ${!nUp ? 'cv-toggle-active' : ''}`} onClick={() => setNUp(false)}>2-up</button>
          <button className={`cv-toggle-btn ${nUp ? 'cv-toggle-active' : ''}`} onClick={() => setNUp(true)} disabled={axisValues.length <= 2}>All</button>
        </div>
      </div>

      {!nUp && (
        <div className="cv-selectors">
          <div className="cv-selector">
            <label className="cv-label" htmlFor="cv-select-a">A</label>
            <select id="cv-select-a" className="cv-select" value={selA} onChange={e => handleSelectA(e.target.value)}>
              {axisValues.map(v => <option key={v} value={v}>{axisValueLabel(v)}</option>)}
            </select>
          </div>
          <div className="cv-vs">vs</div>
          <div className="cv-selector">
            <label className="cv-label" htmlFor="cv-select-b">B</label>
            <select id="cv-select-b" className="cv-select" value={selB} onChange={e => handleSelectB(e.target.value)}>
              {axisValues.map(v => <option key={v} value={v}>{axisValueLabel(v)}</option>)}
            </select>
          </div>
          {cellA && cellB && (
            <button className="cv-diff-btn" onClick={() => setShowDiff(!showDiff)}>
              {showDiff ? 'Hide Diff' : 'Show Diff'}
            </button>
          )}
        </div>
      )}

      {!nUp && cellA && cellB && (
        <>
          {renderDeltaRibbon()}
          <div className="cv-panels">
            <ResponsePanel headerClass="cv-panel-a" label={`A: ${axisValueLabel(selA)}`} cell={cellA} />
            <ResponsePanel headerClass="cv-panel-b" label={`B: ${axisValueLabel(selB)}`} cell={cellB} />
          </div>
          {showDiff && <PromptDiffView contentA={cellA.response ?? ''} contentB={cellB.response ?? ''} />}
        </>
      )}

      {!nUp && (!cellA || !cellB) && (
        <div className="cv-empty">No completed cell for this combination — try a different test case.</div>
      )}

      {nUp && (
        <div className="cv-nup-grid" style={{ gridTemplateColumns: `repeat(${axisValues.length}, minmax(220px, 1fr))` }}>
          {axisValues.map(v => (
            <ResponsePanel key={v} label={axisValueLabel(v)} cell={cellFor(v)} />
          ))}
        </div>
      )}
    </div>
  );
}
