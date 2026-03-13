import { join } from 'path';
import { FileService } from './FileService.ts';
import type { EvaluationResults, EvaluationSummary, ModelRanking } from '../../src/types/eval.ts';

export class ReportService {
  static generateMarkdown(evalId: string): string {
    const evalDir = join(FileService.evalsDir(), 'evaluations', evalId);
    const summary = FileService.readJson<EvaluationSummary>(join(evalDir, 'summary.json'));
    const results = FileService.readJson<EvaluationResults>(join(evalDir, 'results.json'));

    if (!summary || !results) {
      throw new Error(`Evaluation data not found for: ${evalId}`);
    }

    const lines: string[] = [];
    lines.push(`# Evaluation Report: ${evalId}`);
    lines.push('');
    lines.push(`**Generated:** ${new Date(summary.generatedAt).toLocaleString()}`);
    lines.push('');

    // Model rankings table
    lines.push('## Model Rankings');
    lines.push('');
    lines.push('| Rank | Model | Composite Score | Deterministic Pass | Avg Latency | Tokens/sec |');
    lines.push('|------|-------|----------------|-------------------|-------------|------------|');

    summary.modelRankings.forEach((m: ModelRanking, i: number) => {
      lines.push(
        `| ${i + 1} | ${m.modelId} | ${m.compositeScore.toFixed(2)} | ${(m.deterministicPassRate * 100).toFixed(1)}% | ${m.avgLatencyMs.toFixed(0)}ms | ${m.avgTokensPerSecond.toFixed(1)} |`
      );
    });
    lines.push('');

    // Prompt rankings table
    lines.push('## Prompt Rankings');
    lines.push('');
    lines.push('| Rank | Prompt ID | Version | Composite Score |');
    lines.push('|------|-----------|---------|----------------|');

    summary.promptRankings.forEach((p, i) => {
      lines.push(`| ${i + 1} | ${p.promptId} | v${p.version} | ${p.compositeScore.toFixed(2)} |`);
    });
    lines.push('');

    // Regression section
    if (summary.regression) {
      lines.push('## Regression Analysis');
      lines.push('');
      if (summary.regression.improved.length > 0) {
        lines.push(`**✅ Improved:** ${summary.regression.improved.join(', ')}`);
      }
      if (summary.regression.regressed.length > 0) {
        lines.push(`**❌ Regressed:** ${summary.regression.regressed.join(', ')}`);
      }
      if (summary.regression.unchanged.length > 0) {
        lines.push(`**➡️ Unchanged:** ${summary.regression.unchanged.join(', ')}`);
      }
      lines.push('');
    }

    // Detailed results
    lines.push('## Detailed Results');
    lines.push('');
    for (const cell of results.matrix) {
      lines.push(`### ${cell.modelId} × ${cell.testCaseId} (Run ${cell.runNumber})`);
      lines.push('');
      lines.push(`**Status:** ${cell.status}`);
      lines.push(`**Latency:** ${cell.metrics.durationMs}ms | **Tokens:** ${cell.metrics.outputTokens} out`);
      if (cell.response.content) {
        lines.push('');
        lines.push('**Response:**');
        lines.push('```');
        lines.push(cell.response.content.substring(0, 500) + (cell.response.content.length > 500 ? '...' : ''));
        lines.push('```');
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  static generateHtml(evalId: string): string {
    const evalDir = join(FileService.evalsDir(), 'evaluations', evalId);
    const summary = FileService.readJson<EvaluationSummary>(join(evalDir, 'summary.json'));
    const results = FileService.readJson<EvaluationResults>(join(evalDir, 'results.json'));

    if (!summary || !results) {
      throw new Error(`Evaluation data not found for: ${evalId}`);
    }

    const templatePath = join(FileService.evalsDir(), 'templates', 'report-template.html');
    let template = FileService.readMarkdown(templatePath);

    if (!template) {
      // Fallback minimal template
      template = `<!DOCTYPE html><html><head><title>{{EVAL_NAME}}</title></head><body><script>const DATA={{DATA}};</script><pre id="data"></pre><script>document.getElementById('data').textContent=JSON.stringify(DATA,null,2)</script></body></html>`;
    }

    const data = JSON.stringify({ summary, results });
    return template
      .replace(/\{\{EVAL_NAME\}\}/g, evalId)
      .replace(/\{\{DATA\}\}/g, data);
  }

  static writeReports(evalId: string): void {
    const evalDir = join(FileService.evalsDir(), 'evaluations', evalId);
    FileService.ensureDir(evalDir);

    const md = ReportService.generateMarkdown(evalId);
    FileService.writeMarkdown(join(evalDir, 'report.md'), md);

    const html = ReportService.generateHtml(evalId);
    FileService.writeMarkdown(join(evalDir, 'report.html'), html);
  }
}
