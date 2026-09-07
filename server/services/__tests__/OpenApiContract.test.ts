import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

const document = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'openapi', 'lmeval-eval-api.v1.json'), 'utf-8'));

describe('OpenAPI contract', () => {
  it('documents every mounted route family and the agent lifecycle methods', () => {
    expect(document.openapi).toBe('3.1.0');
    for (const path of [
      '/health', '/openapi.json', '/models', '/models/by-server', '/prompts', '/templates',
      '/purpose-templates', '/test-suites', '/presets', '/sessions', '/judges/{modelId}/qualify',
      '/judges/{modelId}/qualification-status', '/judges/{modelId}/qualification-runs',
      '/judges/qualification-runs/{runId}', '/judges/qualification-runs/{runId}/cancel',
      '/model-selection', '/model-selection/validate', '/model-selection/drafts',
      '/model-selection/{id}/run', '/model-selection/{id}/feedback', '/git/status', '/evaluations', '/evaluations/validate', '/evaluations/drafts',
      '/evaluations/{id}', '/evaluations/{id}/run', '/evaluations/{id}/feedback',
    ]) expect(document.paths[path], path).toBeDefined();
    expect(document.paths['/presets/{id}'].patch).toBeDefined();
    expect(document.paths['/evaluations/{id}'].delete['x-destructive']).toBe(true);
  });

  it('keeps examples inside the declared inference and grouped-model schemas', () => {
    const ajv = new Ajv({ strict: false });
    const inference = ajv.compile(document.components.schemas.Inference);
    expect(inference({ temperature: 0.3, maxTokens: 1000, seed: 1 })).toBe(true);
    expect(inference({ temperature: 3, maxTokens: 0 })).toBe(false);
    const models = ajv.compile(document.components.schemas.GroupedModels);
    expect(models(document.paths['/models/by-server'].get.responses['200'].content['application/json'].example)).toBe(true);
  });

  it('requires every operation to declare at least one response', () => {
    for (const [path, pathItem] of Object.entries(document.paths) as Array<[string, Record<string, unknown>]>) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (method === 'parameters') continue;
        expect((operation as { responses?: unknown }).responses, `${method.toUpperCase()} ${path}`).toBeDefined();
      }
    }
  });
});
