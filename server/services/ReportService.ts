import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import {
  readJson, writeText, EVALUATIONS_DIR, REPORT_TEMPLATE_PATH
} from './FileService';
import { JudgeQualificationService } from './JudgeQualificationService';
import { ModelSelectionService } from './ModelSelectionService';
import type {
  EvaluationConfig, EvaluationSummary, EvalMatrixCell, TestCase, TaskMetrics, GateResult,
} from '../../src/types/eval';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderGate(gate: GateResult): string[] {
  const lines: string[] = [];
  lines.push(`**Gate:** ${gate.verdict} (${gate.caseCount} cases${gate.neededCases != null ? `, ~${gate.neededCases} more needed` : ''})  `);
  if (gate.failures.length > 0) {
    lines.push(...gate.failures.map(f => `- ${f}`));
  }
  return lines;
}

/** A10: task-specific detail — confusion matrix + per-class table, micro/macro + per-tag table, or rubric dimensions + judge status, plus the shared gate rendering. Formatting only; all data already exists on TaskMetrics. */
function renderTaskMetrics(tm: TaskMetrics): string[] {
  const lines: string[] = [];

  if (tm.taskType === 'classification') {
    lines.push(`**Accuracy:** ${(tm.accuracy * 100).toFixed(1)}% | **Macro-F1:** ${tm.macroF1.toFixed(3)} | **Invalid-label rate:** ${(tm.invalidLabelRate * 100).toFixed(1)}% | **Format compliance:** ${(tm.formatComplianceRate * 100).toFixed(1)}%`);
    if (tm.runToRunAgreement != null) lines.push(`**Run-to-run agreement:** ${(tm.runToRunAgreement * 100).toFixed(1)}%`);
    lines.push('', '**Per-class:**', '', '| Class | Precision | Recall | F1 | Support |', '|---|---|---|---|---|');
    for (const [label, m] of Object.entries(tm.perClass)) {
      lines.push(`| ${label} | ${m.precision.toFixed(2)} | ${m.recall.toFixed(2)} | ${m.f1.toFixed(2)} | ${m.support} |`);
    }
    const predictedLabels = new Set<string>();
    for (const preds of Object.values(tm.confusionMatrix)) for (const p of Object.keys(preds)) predictedLabels.add(p);
    lines.push('', '**Confusion matrix** (rows = expected, columns = predicted):', '');
    lines.push(`| Expected \\ Predicted | ${[...predictedLabels].join(' | ')} |`);
    lines.push(`|---|${[...predictedLabels].map(() => '---').join('|')}|`);
    for (const [expected, preds] of Object.entries(tm.confusionMatrix)) {
      lines.push(`| ${expected} | ${[...predictedLabels].map(p => preds[p] ?? 0).join(' | ')} |`);
    }
  } else if (tm.taskType === 'tagging') {
    lines.push(`**Micro P/R/F1:** ${tm.microPrecision.toFixed(2)} / ${tm.microRecall.toFixed(2)} / ${tm.microF1.toFixed(2)} | **Macro label-F1:** ${tm.macroLabelF1.toFixed(2)} | **Jaccard mean:** ${tm.jaccardMean.toFixed(2)} | **Exact-set match:** ${(tm.exactSetMatchRate * 100).toFixed(1)}%`);
    lines.push(`**Unknown-tag rate:** ${(tm.unknownTagRate * 100).toFixed(1)}% | **Duplicate-tag rate:** ${(tm.duplicateTagRate * 100).toFixed(1)}% | **Format compliance:** ${(tm.formatComplianceRate * 100).toFixed(1)}%`);
    lines.push('', '**Per-tag:**', '', '| Tag | Precision | Recall | F1 | Support |', '|---|---|---|---|---|');
    for (const [tag, m] of Object.entries(tm.perLabel)) {
      lines.push(`| ${tag} | ${m.precision.toFixed(2)} | ${m.recall.toFixed(2)} | ${m.f1.toFixed(2)} | ${m.support} |`);
    }
  } else {
    const r = tm.medianRubric;
    lines.push(`**Median weighted:** ${r.weighted.toFixed(2)} | Faithfulness ${r.faithfulness.toFixed(2)} | Salient Coverage ${r.salientCoverage.toFixed(2)} | Retrieval Utility ${r.retrievalUtility.toFixed(2)} | Concision ${r.concision.toFixed(2)}`);
    lines.push(`**Critical unsupported-claim rate:** ${(tm.criticalUnsupportedClaimRate * 100).toFixed(1)}%`);
    lines.push(`**Self-judge guard violated:** ${tm.selfJudgeGuardViolated ? 'yes' : 'no'} | **Judge qualified:** ${tm.judgeQualified === true ? 'yes' : tm.judgeQualified === false ? 'no' : 'unknown'}`);
    const d = tm.deterministic;
    lines.push('', '**Deterministic checks:**', '');
    lines.push(`- No preamble: ${(d.noPreambleRate * 100).toFixed(1)}%`);
    lines.push(`- No heading: ${(d.noHeadingRate * 100).toFixed(1)}%`);
    lines.push(`- No fence: ${(d.noFenceRate * 100).toFixed(1)}%`);
    lines.push(`- Compression in range: ${(d.compressionInRangeRate * 100).toFixed(1)}%`);
    lines.push(`- Protected tokens preserved: ${(d.protectedTokensPreservedRate * 100).toFixed(1)}%`);
    lines.push(`- No forbidden claims: ${(d.noForbiddenClaimsRate * 100).toFixed(1)}%`);
  }

  lines.push('', ...renderGate(tm.gate));
  return lines;
}

// A10: groups the run's test cases by their caseTags families (split, shape,
// category) and reports each group's average pass rate, joined against the
// already-computed testCaseSummaries — no new data collection.
function renderSliceTables(testCases: TestCase[], summary: EvaluationSummary): string[] {
  if (!summary.testCaseSummaries || summary.testCaseSummaries.length === 0) return [];
  const passRateById = new Map(summary.testCaseSummaries.map(s => [s.testCaseId, s.passRate]));

  const families = new Map<string, Map<string, number[]>>(); // family -> value -> pass rates
  for (const tc of testCases) {
    for (const tag of tc.caseTags ?? []) {
      const colonIdx = tag.indexOf(':');
      if (colonIdx === -1) continue;
      const family = tag.slice(0, colonIdx);
      const value = tag.slice(colonIdx + 1);
      const passRate = passRateById.get(tc.id);
      if (passRate == null) continue;
      const byValue = families.get(family) ?? new Map<string, number[]>();
      const rates = byValue.get(value) ?? [];
      rates.push(passRate);
      byValue.set(value, rates);
      families.set(family, byValue);
    }
  }
  if (families.size === 0) return [];

  const lines: string[] = ['## Slice Breakdown', ''];
  for (const [family, byValue] of [...families.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`**${family}:**`, '', '| Value | Cases | Avg Pass Rate |', '|---|---|---|');
    for (const [value, rates] of [...byValue.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
      lines.push(`| ${value} | ${rates.length} | ${(avg * 100).toFixed(1)}% |`);
    }
    lines.push('');
  }
  return lines;
}

function renderModelSelectionSection(evalId: string, config: EvaluationConfig): string[] {
  if (config.comparisonMode !== 'model') return [];
  const rec = ModelSelectionService.findRecommendationByEvaluationId(evalId);
  if (!rec) return [];

  const lines: string[] = ['## Model Selection', ''];
  lines.push(`**Task:** ${rec.task} | **Recommended:** \`${rec.recommendedModelId}\`${rec.advisory ? ' (advisory)' : ''}`);
  if (rec.runnerUpModelIds.length > 0) lines.push(`**Runner-up(s):** ${rec.runnerUpModelIds.map(id => `\`${id}\``).join(', ')}`);
  lines.push(`**Primary metric:** ${rec.primaryMetric.name} = ${rec.primaryMetric.value.toFixed(3)} (95% CI ${rec.primaryMetric.ci95[0].toFixed(3)}-${rec.primaryMetric.ci95[1].toFixed(3)})`);
  lines.push(`**p95 latency:** ${rec.p95LatencyMs.toFixed(0)}ms`);
  lines.push(`**Confirmation:** ran \`${rec.confirmation.ranModelId}\` — ${rec.confirmation.passed ? 'passed' : `failed (${rec.confirmation.reason ?? 'no reason recorded'})`}`);

  if (rec.discardedByGate.length > 0) {
    lines.push('', '**Discarded by gate:**', '');
    for (const d of rec.discardedByGate) lines.push(`- \`${d.modelId}\`: ${d.reason}`);
  }

  lines.push('', '**Tie groups:**', '', '| Rank | Models |', '|---|---|');
  for (const g of rec.ordering.tieGroups) lines.push(`| ${g.rank} | ${g.modelIds.map(id => `\`${id}\``).join(', ')} |`);

  lines.push('', '**p95 latency by model:**', '', '| Model | p95 (ms) | Run-to-run agreement | Avg output tokens |', '|---|---|---|---|');
  for (const [modelId, ms] of Object.entries(rec.ordering.p95LatencyMs)) {
    const s = rec.ordering.stability[modelId];
    lines.push(`| \`${modelId}\` | ${ms.toFixed(0)} | ${s?.runToRunAgreement != null ? `${(s.runToRunAgreement * 100).toFixed(1)}%` : '—'} | ${s?.avgOutputTokens?.toFixed(0) ?? '—'} |`);
  }
  if (rec.ordering.latencyBudgetNote) lines.push('', `_${rec.ordering.latencyBudgetNote}_`);

  lines.push('');
  return lines;
}

function renderProvenanceBlock(config: EvaluationConfig, summary: EvaluationSummary): string[] {
  const lines: string[] = [];
  if (summary.benchmarkProvenance) {
    const bp = summary.benchmarkProvenance;
    lines.push(`**Benchmark suite:** \`${bp.suiteId}\` v${bp.version} (${bp.reviewStatus}) | **Dataset hash:** \`${bp.datasetSha256.slice(0, 12)}…\` | **Splits:** ${bp.includedSplits.join(', ')}`);
  }
  if (config.purposeTemplateId === 'summarization' && config.judgeModelId) {
    const q = JudgeQualificationService.get(config.judgeModelId);
    lines.push(q
      ? `**Judge qualification:** \`${config.judgeModelId}\` — ${q.qualified ? 'qualified' : 'NOT qualified'} (Spearman ${q.spearman.toFixed(2)}, qualified ${q.qualifiedAt})`
      : `**Judge qualification:** \`${config.judgeModelId}\` — no qualification record`);
  }
  return lines;
}

export const ReportService = {
  generateMarkdown(evalId: string): string | null {
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
    const results = readJson<EvalMatrixCell[]>(join(EVALUATIONS_DIR, evalId, 'results.json'));
    const testCases = readJson<TestCase[]>(join(EVALUATIONS_DIR, evalId, 'testcases.json'));

    if (!config || !summary) return null;

    const lines: string[] = [
      `# ${config.name} — Evaluation Report`,
      '',
      `**Eval ID:** \`${evalId}\`  `,
      `**Completed:** ${summary.completedAt ?? 'N/A'}  `,
      `**Total Cells:** ${summary.totalCells} | **Completed:** ${summary.completedCells} | **Failed:** ${summary.failedCells}`,
      summary.resolvedInference
        ? `**Inference:** temperature ${summary.resolvedInference.temperature}, maxTokens ${summary.resolvedInference.maxTokens}${summary.resolvedInference.seed != null ? `, seed ${summary.resolvedInference.seed}` : ''} (source: ${summary.resolvedInference.source})  `
        : '**Inference:** unspecified — not usable as a baseline or promotion input  ',
      summary.transportProvenance
        ? `**Transport:** ${summary.transportProvenance.endpointPaths.join(', ')} (${summary.transportProvenance.messageShape})${summary.truncationRate != null ? ` | **Truncation rate:** ${(summary.truncationRate * 100).toFixed(1)}%` : ''}`
        : '',
      ...renderProvenanceBlock(config, summary),
      '',
      '---',
      '',
      '## Model Rankings',
      '',
      '| Rank | Model | Avg Score | Success Rate | Avg Latency | Tokens/s |',
      '|------|-------|-----------|--------------|-------------|----------|',
      ...(summary.modelSummaries.map((m, i) =>
        `| ${i + 1} | \`${m.modelId}\` | ${m.avgCompositeScore?.toFixed(2) ?? '—'} | ${(m.successRate * 100).toFixed(1)}% | ${m.avgDurationMs.toFixed(0)}ms | ${m.avgTokensPerSecond.toFixed(1)} |`
      )),
      '',
      '## Prompt Rankings',
      '',
      '| Prompt ID | Version | Avg Score | Success Rate | Avg Latency |',
      '|-----------|---------|-----------|--------------|-------------|',
      ...(summary.promptSummaries.map(p =>
        `| \`${p.promptId}\` | v${p.promptVersion} | ${p.avgCompositeScore?.toFixed(2) ?? '—'} | ${(p.successRate * 100).toFixed(1)}% | ${p.avgDurationMs.toFixed(0)}ms |`
      )),
      '',
    ];

    if (summary.regression) {
      lines.push('## Regression Analysis', '');
      lines.push('| Metric | Baseline | Current | Delta | Status |');
      lines.push('|--------|----------|---------|-------|--------|');
      for (const m of summary.regression.metrics) {
        lines.push(`| ${m.metric} | ${m.baseline.toFixed(2)} | ${m.current.toFixed(2)} | ${m.delta > 0 ? '+' : ''}${m.delta.toFixed(2)} | ${m.status} |`);
      }
      lines.push('');
    }

    // A10: task-specific detail — additive, only present when the run used a
    // built-in purpose template and computed taskMetrics (R4-R7/A7).
    if (summary.taskMetrics) {
      lines.push('## Task Metrics', '', ...renderTaskMetrics(summary.taskMetrics), '');
    }

    // A9: per-model breakdown for comparisonMode: 'model' runs.
    if (summary.perModelTaskMetrics) {
      lines.push('## Per-Model Breakdown', '');
      for (const [modelId, tm] of Object.entries(summary.perModelTaskMetrics)) {
        lines.push(`### \`${modelId}\``, '', ...renderTaskMetrics(tm), '');
      }
    }

    if (testCases) {
      lines.push(...renderSliceTables(testCases, summary));
    }

    lines.push(...renderModelSelectionSection(evalId, config));

    if (results && results.length > 0) {
      lines.push('## Detailed Results', '');
      lines.push('| Cell | Model | Prompt | Status | Score | Duration |');
      lines.push('|------|-------|--------|--------|-------|----------|');
      for (const cell of results) {
        lines.push(
          `| \`${cell.id}\` | \`${cell.modelId}\` | \`${cell.promptId} v${cell.promptVersion}\` | ${cell.status} | ${cell.compositeScore?.toFixed(2) ?? '—'} | ${cell.durationMs ?? '—'}ms |`
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  },

  generateHtml(evalId: string): string | null {
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
    const results = readJson<EvalMatrixCell[]>(join(EVALUATIONS_DIR, evalId, 'results.json'));

    if (!config || !summary) return null;

    if (!existsSync(REPORT_TEMPLATE_PATH)) {
      return this.generateBasicHtml(config.name, summary, results ?? []);
    }

    const template = readFileSync(REPORT_TEMPLATE_PATH, 'utf-8');
    const data = { summary, results: results ?? [] };
    return template
      .replace(/\{\{EVAL_NAME\}\}/g, escapeHtml(config.name))
      .replace('{{DATA}}', JSON.stringify(data));
  },

  generateBasicHtml(evalName: string, summary: EvaluationSummary, results: EvalMatrixCell[]): string {
    const data = JSON.stringify({ summary, results });
    const safeName = escapeHtml(evalName);
    return `<!DOCTYPE html><html><head><title>${safeName}</title></head><body>
<h1>${safeName}</h1>
<p>Completed: ${summary.completedAt ?? 'N/A'} | Cells: ${summary.totalCells}</p>
<p>Inference: ${summary.resolvedInference ? `temperature ${summary.resolvedInference.temperature}, maxTokens ${summary.resolvedInference.maxTokens}` : 'unspecified — not usable as a baseline or promotion input'}</p>
<script>const DATA = ${data};</script>
</body></html>`;
  },

  writeReports(evalId: string): { markdownPath: string; htmlPath: string } | null {
    const evalDir = join(EVALUATIONS_DIR, evalId);
    const md = this.generateMarkdown(evalId);
    const html = this.generateHtml(evalId);
    if (!md || !html) return null;

    const mdPath = join(evalDir, 'report.md');
    const htmlPath = join(evalDir, 'report.html');
    writeText(mdPath, md);
    writeText(htmlPath, html);
    return { markdownPath: mdPath, htmlPath: htmlPath };
  },
};
