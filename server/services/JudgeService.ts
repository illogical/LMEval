import type { JudgePerspective, EvalMatrixCell, JudgeResult, PairwiseRanking, ToolDefinition, EvalTemplate } from '../../src/types/eval.ts';
import type { LmapiChatCompletionRequest } from '../../src/types/lmapi.ts';

export class JudgeService {
  static buildRubricPrompt(
    perspective: JudgePerspective,
    systemPrompt: string,
    userMessage: string,
    response: string,
    referenceCriteria?: string[]
  ): LmapiChatCompletionRequest['messages'] {
    const scaleLabels = Object.entries(perspective.scoringScale.labels)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    const criteriaSection = referenceCriteria && referenceCriteria.length > 0
      ? `\n## Reference Criteria\n${referenceCriteria.map(c => `- ${c}`).join('\n')}\n`
      : '';

    const userContent = `## Original System Prompt\n${systemPrompt}\n\n## User Input\n${userMessage}\n\n## Response to Evaluate\n${response}${criteriaSection}\n## Scoring Instructions\nScore this response on a scale of ${perspective.scoringScale.min} to ${perspective.scoringScale.max} for "${perspective.name}".\n\nScale:\n${scaleLabels}\n\nRespond with JSON only:\n{ "score": <number>, "justification": "<string>" }`;

    return [
      { role: 'system', content: perspective.systemPrompt },
      { role: 'user', content: userContent }
    ];
  }

  static buildPairwisePrompt(
    systemPrompt: string,
    userMessage: string,
    cellA: EvalMatrixCell,
    cellB: EvalMatrixCell
  ): { messages: LmapiChatCompletionRequest['messages']; swapped: boolean } {
    // Randomize order to reduce position bias
    const swapped = Math.random() > 0.5;
    const [first, second] = swapped ? [cellB, cellA] : [cellA, cellB];
    const [firstLabel, secondLabel] = swapped ? ['B', 'A'] : ['A', 'B'];

    const userContent = `## System Prompt\n${systemPrompt}\n\n## User Message\n${userMessage}\n\n## Response ${firstLabel}\n${first.response.content}\n\n## Response ${secondLabel}\n${second.response.content}\n\nWhich response is better? Respond with JSON only:\n{ "winner": "${firstLabel === 'A' ? 'A' : 'B'}" or "${secondLabel}", "justification": "<string>" }`;

    return {
      messages: [
        {
          role: 'system',
          content: 'You are an expert evaluator comparing two AI responses. Choose which one is better and explain why. Be objective and consider accuracy, completeness, and quality.'
        },
        { role: 'user', content: userContent }
      ],
      swapped
    };
  }

  static parseRubricResponse(raw: string): { score: number; justification: string } | null {
    // Step 1: direct JSON.parse
    try {
      const parsed = JSON.parse(raw) as { score: number; justification: string };
      if (typeof parsed.score === 'number' && typeof parsed.justification === 'string') {
        return parsed;
      }
    } catch { /* continue */ }

    // Step 2: strip markdown fences
    try {
      const stripped = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(stripped) as { score: number; justification: string };
      if (typeof parsed.score === 'number' && typeof parsed.justification === 'string') {
        return parsed;
      }
    } catch { /* continue */ }

    // Step 3: regex extract first {...} block
    // Patterns match: {"score": N, "justification": "..."} or reversed order.
    // Limitations: doesn't handle nested JSON or escaped quotes in justification.
    try {
      const match = raw.match(/\{[^{}]*"score"\s*:\s*(\d+(?:\.\d+)?)[^{}]*"justification"\s*:\s*"([^"]*)"[^{}]*\}/);
      if (match) {
        return { score: parseFloat(match[1]), justification: match[2] };
      }
      // Try the other order
      const match2 = raw.match(/\{[^{}]*"justification"\s*:\s*"([^"]*)"[^{}]*"score"\s*:\s*(\d+(?:\.\d+)?)[^{}]*\}/);
      if (match2) {
        return { score: parseFloat(match2[2]), justification: match2[1] };
      }
    } catch { /* continue */ }

    // Step 4: return null
    console.warn('[JudgeService] Failed to parse rubric response:', raw.substring(0, 200));
    return null;
  }

  static parsePairwiseResponse(raw: string, swapped: boolean, cellIdA: string, cellIdB: string): PairwiseRanking | null {
    let winner: string | null = null;
    let justification = '';

    // Step 1: direct JSON.parse
    try {
      const parsed = JSON.parse(raw) as { winner: string; justification: string };
      winner = parsed.winner;
      justification = parsed.justification;
    } catch { /* continue */ }

    // Step 2: strip markdown fences
    if (!winner) {
      try {
        const stripped = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(stripped) as { winner: string; justification: string };
        winner = parsed.winner;
        justification = parsed.justification;
      } catch { /* continue */ }
    }

    // Step 3: regex
    if (!winner) {
      const match = raw.match(/"winner"\s*:\s*"([AB])"/);
      if (match) winner = match[1];
      const justMatch = raw.match(/"justification"\s*:\s*"([^"]*)"/);
      if (justMatch) justification = justMatch[1];
    }

    if (!winner) {
      console.warn('[JudgeService] Failed to parse pairwise response:', raw.substring(0, 200));
      return null;
    }

    // Map winner label back to cell ID (accounting for swap)
    let winnerId: string;
    if (swapped) {
      winnerId = winner === 'A' ? cellIdB : cellIdA;
    } else {
      winnerId = winner === 'A' ? cellIdA : cellIdB;
    }

    return { cellIdA, cellIdB, winnerId, justification, judgeModel: '' };
  }

  static buildTemplateGeneratorPrompt(
    promptContent: string,
    tools?: ToolDefinition[]
  ): LmapiChatCompletionRequest['messages'] {
    const toolSection = tools && tools.length > 0
      ? `\n## Tool Definitions\n\`\`\`json\n${JSON.stringify(tools, null, 2)}\n\`\`\``
      : '';

    const systemContent = `You are an evaluation design specialist. Analyze the provided system prompt and generate a structured evaluation template.

Your task:
1. Identify 4-6 key behaviors this prompt tries to elicit.
2. Propose scoring dimensions (judge perspectives) with name, description, weight (must sum to 1.0), and rubric.
3. Identify which deterministic checks apply.
4. Suggest 3-5 test cases.

Respond ONLY with valid JSON matching this exact structure:
{
  "name": "string",
  "description": "string",
  "deterministicChecks": {
    "formatCompliance": boolean,
    "jsonSchemaValidation": boolean,
    "toolCallValidation": boolean,
    "keywordPresence": ["optional", "array"],
    "keywordAbsence": ["optional", "array"]
  },
  "judgeConfig": {
    "enabled": true,
    "model": "",
    "perspectives": [
      {
        "id": "string-id",
        "name": "string",
        "description": "string",
        "weight": 0.25,
        "systemPrompt": "string",
        "scoringScale": {
          "min": 1,
          "max": 5,
          "labels": { "1": "Poor", "3": "Adequate", "5": "Excellent" }
        }
      }
    ],
    "pairwiseComparison": false,
    "runsPerCombination": 1
  },
  "suggestedTestCases": [
    { "name": "string", "userMessage": "string" }
  ]
}`;

    return [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content: `## System Prompt to Analyze\n${promptContent}${toolSection}`
      }
    ];
  }

  static parseTemplateGeneratorResponse(raw: string): Partial<EvalTemplate> | null {
    // Try multiple parsing strategies
    const strategies = [
      () => JSON.parse(raw),
      () => JSON.parse(raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim()),
      () => {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
      }
    ];

    for (const strategy of strategies) {
      try {
        const parsed = strategy();
        if (parsed && typeof parsed === 'object') {
          return parsed as Partial<EvalTemplate>;
        }
      } catch { /* continue */ }
    }

    console.warn('[JudgeService] Failed to parse template generator response');
    return null;
  }
}
