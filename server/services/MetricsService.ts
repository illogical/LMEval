import Ajv from 'ajv';
import type { EvalTemplate, EvalMatrixCell, ToolDefinition, ExpectedToolCall, ToolCallResult } from '../../src/types/eval.ts';
import type { ToolCall } from '../../src/types/lmapi.ts';

const ajv = new Ajv({ allErrors: true });

export class MetricsService {
  static validateJsonSchema(content: string, schema: object): { valid: boolean; errors: string[] } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { valid: false, errors: ['Response is not valid JSON'] };
    }

    try {
      const validate = ajv.compile(schema);
      const valid = validate(parsed) as boolean;
      const errors = valid ? [] : (validate.errors || []).map(e => `${e.instancePath} ${e.message}`);
      return { valid, errors };
    } catch (e) {
      return { valid: false, errors: [`Schema compilation error: ${e}`] };
    }
  }

  static validateToolCalls(
    actualCalls: ToolCall[],
    definitions: ToolDefinition[],
    expected?: ExpectedToolCall[]
  ): { valid: boolean; errors: string[]; results: ToolCallResult[] } {
    const errors: string[] = [];
    const results: ToolCallResult[] = [];
    const definitionMap = new Map(definitions.map(d => [d.function.name, d]));

    for (const call of actualCalls) {
      const def = definitionMap.get(call.function.name);
      const callErrors: string[] = [];

      if (!def) {
        callErrors.push(`Unknown function: ${call.function.name}`);
      } else {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          callErrors.push(`Invalid JSON arguments for ${call.function.name}`);
          args = {};
        }

        if (def.function.parameters && Object.keys(def.function.parameters).length > 0) {
          const result = MetricsService.validateJsonSchema(
            JSON.stringify(args),
            def.function.parameters
          );
          if (!result.valid) {
            callErrors.push(...result.errors.map(e => `${call.function.name}: ${e}`));
          }
        }
      }

      let args: object = {};
      try { args = JSON.parse(call.function.arguments); } catch { /* ignore */ }

      results.push({
        functionName: call.function.name,
        arguments: args,
        valid: callErrors.length === 0,
        errors: callErrors.length > 0 ? callErrors : undefined
      });
      errors.push(...callErrors);
    }

    // Check expected calls if provided
    if (expected && expected.length > 0) {
      const actualNames = actualCalls.map(c => c.function.name);
      for (const exp of expected) {
        if (!actualNames.includes(exp.functionName)) {
          errors.push(`Expected tool call not made: ${exp.functionName}`);
        }
      }
    }

    return { valid: errors.length === 0, errors, results };
  }

  static checkKeywords(
    content: string,
    required?: string[],
    forbidden?: string[]
  ): { present: Record<string, boolean>; absent: Record<string, boolean> } {
    const present: Record<string, boolean> = {};
    const absent: Record<string, boolean> = {};
    const lower = content.toLowerCase();

    for (const kw of (required ?? [])) {
      present[kw] = lower.includes(kw.toLowerCase());
    }
    for (const kw of (forbidden ?? [])) {
      absent[kw] = !lower.includes(kw.toLowerCase());
    }

    return { present, absent };
  }

  static estimateTokenCount(text: string): number {
    // Approximates GPT-style tokenizers: ~4 chars per token (±25% variance for typical text)
    return Math.ceil(text.length / 4);
  }

  static computeDeterministicMetrics(
    cell: EvalMatrixCell,
    template: EvalTemplate,
    toolDefinitions: ToolDefinition[],
    toolCalls: ToolCall[]
  ): Partial<EvalMatrixCell['metrics']> {
    const content = cell.response.content;
    const updates: Partial<EvalMatrixCell['metrics']> = {};

    // Format compliance (basic: non-empty response)
    if (template.deterministicChecks.formatCompliance) {
      updates.formatCompliant = content.trim().length > 0;
    } else {
      updates.formatCompliant = null;
    }

    // JSON schema validation
    if (template.deterministicChecks.jsonSchemaValidation && template.deterministicChecks.jsonSchema) {
      const result = MetricsService.validateJsonSchema(content, template.deterministicChecks.jsonSchema);
      updates.jsonSchemaValid = result.valid;
      updates.jsonSchemaErrors = result.errors.length > 0 ? result.errors : undefined;
    } else {
      updates.jsonSchemaValid = null;
    }

    // Tool call validation
    if (template.deterministicChecks.toolCallValidation && toolDefinitions.length > 0) {
      const result = MetricsService.validateToolCalls(toolCalls, toolDefinitions);
      updates.toolCallsValid = result.valid;
      updates.toolCallErrors = result.errors.length > 0 ? result.errors : undefined;
    } else {
      updates.toolCallsValid = null;
    }

    // Keyword checks
    const { present, absent } = MetricsService.checkKeywords(
      content,
      template.deterministicChecks.keywordPresence,
      template.deterministicChecks.keywordAbsence
    );
    if (Object.keys(present).length > 0) updates.keywordsPresent = present;
    if (Object.keys(absent).length > 0) updates.keywordsAbsent = absent;

    return updates;
  }

  static deterministicPassRate(cell: EvalMatrixCell): number {
    const checks: Array<boolean | null> = [
      cell.metrics.formatCompliant,
      cell.metrics.jsonSchemaValid,
      cell.metrics.toolCallsValid
    ].filter(v => v !== null && v !== undefined) as Array<boolean | null>;

    // Also check keywords
    const kpValues = Object.values(cell.metrics.keywordsPresent ?? {});
    const kaValues = Object.values(cell.metrics.keywordsAbsent ?? {});
    const allChecks = [...checks.filter((v): v is boolean => v !== null), ...kpValues, ...kaValues];

    if (allChecks.length === 0) return 1.0;
    return allChecks.filter(Boolean).length / allChecks.length;
  }
}
