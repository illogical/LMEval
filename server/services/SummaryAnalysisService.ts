import { join } from 'path';
import { readJson, writeJson, EVALUATIONS_DIR } from './FileService';
import { LmapiClient } from './LmapiClient';
import { PromptService } from './PromptService';
import { config } from '../config';
import type { EvaluationConfig, EvaluationSummary } from '../../src/types/eval';
import type { ImprovementSuggestion, SummaryAnalysis } from '../../src/types/session';

function buildAnalysisPrompt(
  evalConfig: EvaluationConfig,
  summary: EvaluationSummary
): { systemMessage: string; userMessage: string } {
  const systemMessage = [
    'You are an expert prompt engineer reviewing the result of an LLM evaluation run.',
    'Respond with ONLY a single JSON object, no prose before or after it, of this exact shape:',
    '{"overview": string, "strengths": string[], "weaknesses": string[], "suggestions": [{"targetSlot": "A" | "B", "revisedContent": string, "rationale": string, "estimatedImpact": string}]}',
    'Propose 1-3 suggestions, each a complete rewritten system prompt for the named slot, not a diff or partial edit.',
  ].join(' ');

  const modelLines = summary.modelSummaries
    .map(m => `- ${m.modelId}: avg score ${m.avgCompositeScore?.toFixed(2) ?? '—'}, success rate ${(m.successRate * 100).toFixed(0)}%, avg latency ${m.avgDurationMs.toFixed(0)}ms`)
    .join('\n') || '(none)';

  const promptLines = summary.promptSummaries
    .map(p => `- ${p.promptId} v${p.promptVersion}: avg score ${p.avgCompositeScore?.toFixed(2) ?? '—'}, success rate ${(p.successRate * 100).toFixed(0)}%`)
    .join('\n') || '(none)';

  const gateLine = summary.taskMetrics
    ? `Gate verdict: ${summary.taskMetrics.gate.verdict}${summary.taskMetrics.gate.failures.length ? ` — ${summary.taskMetrics.gate.failures.join('; ')}` : ''}`
    : '';

  const promptContents = evalConfig.promptIds.map((id, i) => {
    const slot = i === 0 ? 'A' : 'B';
    const manifest = PromptService.get(id);
    const version = manifest?.versions.at(-1)?.version ?? 1;
    const content = manifest ? PromptService.getVersionContent(id, version) : null;
    return content ? `## Prompt ${slot} (current)\n${content}` : '';
  }).filter(Boolean).join('\n\n');

  const userMessage = [
    `Evaluation "${evalConfig.name}" completed ${summary.completedCells}/${summary.totalCells} cells (${summary.failedCells} failed).`,
    '',
    'Model rankings:',
    modelLines,
    '',
    'Prompt rankings:',
    promptLines,
    gateLine,
    '',
    promptContents,
    '',
    'Analyze this result: summarize what happened, list concrete strengths and weaknesses of the evaluated prompt(s), and propose specific full-prompt rewrites that would plausibly improve the score, each with a one-line rationale and a rough estimated impact (e.g. "+0.1-0.2 macro-F1").',
  ].join('\n');

  return { systemMessage, userMessage };
}

function generateSuggestionId(): string {
  return `sugg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type ParsedAnalysis = Omit<SummaryAnalysis, 'evalId' | 'generatedAt' | 'refinementModel'>;

function normalizeSuggestion(raw: unknown, evalConfig: EvaluationConfig): ImprovementSuggestion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const targetSlot = s.targetSlot === 'A' || s.targetSlot === 'B' ? s.targetSlot : null;
  const revisedContent = typeof s.revisedContent === 'string' ? s.revisedContent : null;
  if (!targetSlot || !revisedContent) return null;

  const promptId = targetSlot === 'A' ? evalConfig.promptIds[0] : evalConfig.promptIds[1];
  const manifest = promptId ? PromptService.get(promptId) : null;
  const currentContent = manifest
    ? PromptService.getVersionContent(promptId, manifest.versions.at(-1)?.version ?? 1) ?? ''
    : '';

  return {
    id: generateSuggestionId(),
    targetSlot,
    currentContent,
    revisedContent,
    rationale: typeof s.rationale === 'string' ? s.rationale : '',
    estimatedImpact: typeof s.estimatedImpact === 'string' ? s.estimatedImpact : undefined,
  };
}

/** 4-step fallback matching JudgeService.parseRubricResponse()'s convention:
 * direct JSON, strip markdown fences, regex-extract the first {...} block, give up. */
function parseAnalysisResponse(raw: string, evalConfig: EvaluationConfig): ParsedAnalysis | null {
  function extract(text: string): ParsedAnalysis | null {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.overview !== 'string' || !Array.isArray(parsed.suggestions)) return null;
      return {
        overview: parsed.overview,
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((s): s is string => typeof s === 'string') : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.filter((s): s is string => typeof s === 'string') : [],
        suggestions: parsed.suggestions
          .map(s => normalizeSuggestion(s, evalConfig))
          .filter((s): s is ImprovementSuggestion => s != null),
      };
    } catch {
      return null;
    }
  }

  let result = extract(raw);
  if (!result) {
    const stripped = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
    result = extract(stripped);
  }
  if (!result) {
    const match = raw.match(/\{[\s\S]*"overview"[\s\S]*\}/);
    if (match) result = extract(match[0]);
  }
  if (!result) {
    console.warn('[SummaryAnalysisService] Failed to parse analysis response:', raw.slice(0, 200));
  }
  return result;
}

export const SummaryAnalysisService = {
  buildAnalysisPrompt,
  parseAnalysisResponse,

  getCached(evalId: string): SummaryAnalysis | null {
    return readJson<SummaryAnalysis>(join(EVALUATIONS_DIR, evalId, 'analysis.json'));
  },

  async analyze(evalId: string, refinementModel?: string): Promise<SummaryAnalysis> {
    const model = refinementModel ?? config.refinementModel;
    if (!model) throw new Error('No refinement model configured — set REFINEMENT_MODEL or pass refinementModel explicitly.');

    const evalConfig = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evalId, 'config.json'));
    const summary = readJson<EvaluationSummary>(join(EVALUATIONS_DIR, evalId, 'summary.json'));
    if (!evalConfig || !summary) throw new Error('Evaluation not found or not yet completed.');

    const { systemMessage, userMessage } = buildAnalysisPrompt(evalConfig, summary);
    const response = await LmapiClient.chatCompletion({
      model,
      messages: [{ role: 'system', content: systemMessage }, { role: 'user', content: userMessage }],
      stream: false,
      groupId: `summary-analysis-${evalId}`,
      temperature: 0.3,
    });

    const parsed = parseAnalysisResponse(response.choices[0]?.message.content ?? '', evalConfig);
    if (!parsed) throw new Error('Refinement model response could not be parsed into analysis sections.');

    const analysis: SummaryAnalysis = {
      evalId,
      generatedAt: new Date().toISOString(),
      refinementModel: model,
      ...parsed,
    };
    writeJson(join(EVALUATIONS_DIR, evalId, 'analysis.json'), analysis);
    return analysis;
  },
};
