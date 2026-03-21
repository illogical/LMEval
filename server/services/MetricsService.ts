import Ajv from 'ajv';
import type { ToolCallResult, ToolDefinition } from '../../src/types/eval';

const ajv = new Ajv({ allErrors: true });

export const MetricsService = {
  validateJsonSchema(
    content: string,
    schema: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { valid: false, errors: ['Response is not valid JSON'] };
    }
    const validate = ajv.compile(schema);
    const valid = validate(parsed) as boolean;
    const errors = valid ? [] : (validate.errors ?? []).map(e => `${e.instancePath} ${e.message}`);
    return { valid, errors };
  },

  validateToolCalls(
    responseContent: string,
    toolDefinitions: ToolDefinition[],
    expectedCalls?: Array<{ functionName: string; argumentMatchers?: Record<string, unknown> }>
  ): ToolCallResult[] {
    if (!expectedCalls || expectedCalls.length === 0) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseContent);
    } catch {
      return expectedCalls.map(ec => ({
        functionName: ec.functionName,
        arguments: {},
        matched: false,
      }));
    }

    const toolNames = new Set(toolDefinitions.map(t => t.function.name));

    return expectedCalls.map(expected => {
      const calls = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>)?.tool_calls ?? [];

      const match = (calls as Array<Record<string, unknown>>).find(
        c => c.function === expected.functionName || c.name === expected.functionName
      );

      if (!match || !toolNames.has(expected.functionName)) {
        return { functionName: expected.functionName, arguments: {}, matched: false };
      }

      let args: Record<string, unknown> = {};
      try {
        const rawArgs = (match.arguments ?? match.args ?? '{}') as string;
        args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs as Record<string, unknown>;
      } catch {
        // ignore parse error
      }

      let matched = true;
      if (expected.argumentMatchers) {
        for (const [key, val] of Object.entries(expected.argumentMatchers)) {
          if (args[key] !== val) {
            matched = false;
            break;
          }
        }
      }

      return { functionName: expected.functionName, arguments: args, matched };
    });
  },

  checkKeywords(
    content: string,
    required?: string[],
    forbidden?: string[]
  ): { found: string[]; missing: string[]; forbiddenFound: string[] } {
    const lower = content.toLowerCase();
    const found = (required ?? []).filter(kw => lower.includes(kw.toLowerCase()));
    const missing = (required ?? []).filter(kw => !lower.includes(kw.toLowerCase()));
    const forbiddenFound = (forbidden ?? []).filter(kw => lower.includes(kw.toLowerCase()));
    return { found, missing, forbiddenFound };
  },

  // Rough approximation: average English word encodes to ~1.33 tokens (varies by tokenizer/language)
  estimateTokenCount(text: string): number {
    return Math.ceil(text.split(/\s+/).length * 1.33);
  },
};
