import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { JudgePerspective, JudgeResult, PairwiseRanking, EvalTemplate } from '../../src/types/eval';

const JUDGE_PROMPTS_DIR = join(process.cwd(), 'data', 'prompts', 'judge');

function loadJudgePrompt(filename: string): string {
  const filePath = join(JUDGE_PROMPTS_DIR, filename);
  if (!existsSync(filePath)) {
    throw new Error(`Judge prompt file not found: ${filePath}. Ensure data/prompts/judge/ exists.`);
  }
  return readFileSync(filePath, 'utf-8').trim();
}

// Load prompt templates once at module init (cached for performance)
let _rubricSystemTemplate: string | null = null;
let _pairwiseSystem: string | null = null;
let _templateGeneratorSystem: string | null = null;

function rubricSystemTemplate(): string {
  return (_rubricSystemTemplate ??= loadJudgePrompt('rubric-system.md'));
}
function pairwiseSystem(): string {
  return (_pairwiseSystem ??= loadJudgePrompt('pairwise-system.md'));
}
function templateGeneratorSystem(): string {
  return (_templateGeneratorSystem ??= loadJudgePrompt('template-generator-system.md'));
}

export const JudgeService = {
  buildRubricPrompt(
    perspective: JudgePerspective,
    systemPrompt: string,
    userMessage: string,
    response: string
  ): { systemMessage: string; userMessage: string } {
    const systemMessage = rubricSystemTemplate()
      .replace('{{PERSPECTIVE_NAME}}', perspective.name)
      .replace('{{SCORING_GUIDE}}', perspective.scoringGuide)
      .replace('{{CRITERIA}}', perspective.criteria);

    const userMsg = `## System Prompt Used
${systemPrompt}

## User Message
${userMessage}

## AI Response to Evaluate
${response}

Score this response on "${perspective.name}" (1-5):`;

    return { systemMessage, userMessage: userMsg };
  },

  buildPairwisePrompt(
    testCase: { userMessage: string; systemPrompt?: string },
    responseA: string,
    responseB: string,
    randomize = true
  ): { systemMessage: string; userMessage: string; swapped: boolean } {
    const swapped = randomize && Math.random() < 0.5;
    const [first, second] = swapped ? [responseB, responseA] : [responseA, responseB];
    const [labelFirst, labelSecond] = swapped ? ['B', 'A'] : ['A', 'B'];

    const systemMessage = pairwiseSystem();

    const systemPromptSection = testCase.systemPrompt
      ? `## System Prompt\n${testCase.systemPrompt}\n\n## `
      : '';

    const userMsg = `## ${systemPromptSection}User Message
${testCase.userMessage}

## Response ${labelFirst} (first shown)
${first}

## Response ${labelSecond} (second shown)
${second}

Which response (A or B) is better?`;

    return { systemMessage, userMessage: userMsg, swapped };
  },

  parseRubricResponse(raw: string): JudgeResult | null {
    // Step 1: direct JSON.parse
    try {
      const parsed = JSON.parse(raw) as { score?: number; justification?: string };
      if (typeof parsed.score === 'number' && typeof parsed.justification === 'string') {
        return { perspectiveId: '', score: parsed.score, justification: parsed.justification, rawResponse: raw };
      }
    } catch { /* continue */ }

    // Step 2: strip markdown fences
    try {
      const stripped = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(stripped) as { score?: number; justification?: string };
      if (typeof parsed.score === 'number' && typeof parsed.justification === 'string') {
        return { perspectiveId: '', score: parsed.score, justification: parsed.justification, rawResponse: raw };
      }
    } catch { /* continue */ }

    // Step 3: regex extract first {...} block
    const match = raw.match(/\{[^{}]*"score"[^{}]*\}/s);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as { score?: number; justification?: string };
        if (typeof parsed.score === 'number') {
          return {
            perspectiveId: '',
            score: parsed.score,
            justification: parsed.justification ?? '',
            rawResponse: raw,
          };
        }
      } catch { /* continue */ }
    }

    // Step 4: return null
    console.warn('[JudgeService] Failed to parse rubric response:', raw.substring(0, 200));
    return null;
  },

  parsePairwiseResponse(raw: string, swapped: boolean): PairwiseRanking | null {
    function extract(text: string): { winner: string; justification: string } | null {
      try {
        const parsed = JSON.parse(text) as { winner?: string; justification?: string };
        if (parsed.winner && ['A', 'B', 'tie'].includes(parsed.winner)) {
          return { winner: parsed.winner, justification: parsed.justification ?? '' };
        }
      } catch { /* continue */ }
      return null;
    }

    let result =
      extract(raw) ??
      extract(raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim());

    if (!result) {
      const match = raw.match(/\{[^{}]*"winner"[^{}]*\}/s);
      if (match) result = extract(match[0]);
    }

    if (!result) {
      console.warn('[JudgeService] Failed to parse pairwise response:', raw.substring(0, 200));
      return null;
    }

    // If order was swapped, flip A/B in winner
    let winner = result.winner as 'A' | 'B' | 'tie';
    if (swapped && winner !== 'tie') {
      winner = winner === 'A' ? 'B' : 'A';
    }

    return {
      cellIdA: '',
      cellIdB: '',
      winner,
      justification: result.justification,
    };
  },

  buildTemplateGeneratorPrompt(
    systemPrompt: string,
    tools?: Array<{ function: { name: string; description: string } }>
  ): { systemMessage: string; userMessage: string } {
    const toolsSection = tools?.length
      ? `\n\nAvailable tools:\n${tools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n')}`
      : '';

    const systemMessage = templateGeneratorSystem();

    const userMessage = `Analyze this system prompt and create an evaluation template:${toolsSection}

## System Prompt
${systemPrompt}

Generate a comprehensive evaluation template with 4-6 perspectives and 3-5 test cases:`;

    return { systemMessage, userMessage };
  },

  parseTemplateGeneratorResponse(raw: string): Partial<EvalTemplate> | null {
    function extract(text: string): Partial<EvalTemplate> | null {
      try {
        const parsed = JSON.parse(text) as Partial<EvalTemplate>;
        if (parsed.perspectives && Array.isArray(parsed.perspectives) && parsed.perspectives.length > 0) {
          return parsed;
        }
      } catch { /* continue */ }
      return null;
    }

    let result =
      extract(raw) ??
      extract(raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim());

    if (!result) {
      const match = raw.match(/\{[\s\S]*"perspectives"[\s\S]*\}/);
      if (match) result = extract(match[0]);
    }

    if (!result) {
      console.warn('[JudgeService] Failed to parse template generator response:', raw.substring(0, 200));
      return null;
    }

    return result;
  },
};
