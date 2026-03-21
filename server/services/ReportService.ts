import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import {
  readJson, writeText, EVALUATIONS_DIR
} from './FileService';
import type { EvaluationConfig, EvaluationSummary, EvalMatrixCell } from '../../src/types/eval';

const REPORT_TEMPLATE_PATH = join(process.cwd(), 'data', 'evals', 'templates', 'report-template.html');

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const ReportService = {
  generateMarkdown(evalId: string): string | null {
    const config = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
    const results = readJson<EvalMatrixCell[]>(join(EVALUATIONS_DIR, evalId, 'results.json'));

    if (!config || !summary) return null;

    const lines: string[] = [
      `# ${config.name} — Evaluation Report`,
      '',
      `**Eval ID:** \`${evalId}\`  `,
      `**Completed:** ${summary.completedAt ?? 'N/A'}  `,
      `**Total Cells:** ${summary.totalCells} | **Completed:** ${summary.completedCells} | **Failed:** ${summary.failedCells}`,
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
