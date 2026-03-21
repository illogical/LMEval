import type { JudgePerspective, JudgeResult, PairwiseRanking, EvalTemplate } from '../../src/types/eval';

export const JudgeService = {
  buildRubricPrompt(
    perspective: JudgePerspective,
    systemPrompt: string,
    userMessage: string,
    response: string
  ): { systemMessage: string; userMessage: string } {
    const systemMessage = `You are an expert evaluator scoring AI assistant responses.
You will score a response on one specific dimension: "${perspective.name}".

Scoring guide (1-5 scale):
${perspective.scoringGuide}

Criteria: ${perspective.criteria}

Respond ONLY with valid JSON in exactly this format:
{"score": <number 1-5>, "justification": "<one sentence explaining the score>"}

Do not include markdown fences, explanation, or any text outside the JSON object.`;

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

    const systemMessage = `You are an expert evaluator comparing two AI responses.
Your task: determine which response better answers the user's request.
Respond ONLY with valid JSON: {"winner": "A" or "B" or "tie", "justification": "<one sentence>"}
Use the original label names A and B regardless of display order.
Do not include markdown fences or any text outside the JSON.`;

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

    const systemMessage = `You are an expert at designing LLM evaluation frameworks.
Analyze the given system prompt and propose a structured evaluation template.

Respond ONLY with valid JSON matching this exact schema:
{
  "name": "string (short template name)",
  "description": "string",
  "perspectives": [
    {
      "id": "string (kebab-case, unique)",
      "name": "string",
      "description": "string",
      "weight": number (0.0-1.0, all weights must sum to 1.0),
      "criteria": "string (what to evaluate)",
      "scoringGuide": "string (1=terrible, 3=acceptable, 5=excellent)"
    }
  ],
  "deterministicChecks": {
    "requiredKeywords": ["optional", "keywords"],
    "forbiddenKeywords": ["optional", "keywords"]
  },
  "suggestedTestCases": [
    { "userMessage": "string", "description": "string" }
  ]
}

Requirements:
- 4-6 scoring perspectives
- Weights must sum exactly to 1.0
- 3-5 test cases
- Perspectives should be specific to the prompt's domain and goals
Do not include markdown fences or any text outside the JSON.`;

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
