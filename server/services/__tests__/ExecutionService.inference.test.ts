import { describe, it, expect } from 'vitest';
import { resolveInferenceAndProvenance } from '../ExecutionService';
import type { EvaluationConfig, EvalPurposeTemplate } from '../../../src/types/eval';

function baseConfig(overrides: Partial<EvaluationConfig> = {}): EvaluationConfig {
  return {
    id: 'eval-1',
    name: 'test',
    promptIds: ['p1'],
    modelIds: ['m1'],
    status: 'pending',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function baseTemplate(overrides: Partial<EvalPurposeTemplate> = {}): EvalPurposeTemplate {
  return {
    id: 'classification',
    name: 'Classification',
    description: '',
    purposeCategory: 'classification',
    builtIn: true,
    defaultComparisonMode: 'prompt',
    assertionStrategy: { type: 'exact-label', config: { labels: ['Preference'] } },
    starterTestCases: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('resolveInferenceAndProvenance', () => {
  it('per-run config wins over the purpose template default', () => {
    const config = baseConfig({ inference: { temperature: 0.7, maxTokens: 200 } });
    const template = baseTemplate({ inference: { temperature: 0.3, maxTokens: 1000 } });
    const result = resolveInferenceAndProvenance(config, template);
    expect(result.resolvedInference).toEqual({ temperature: 0.7, maxTokens: 200, source: 'config' });
    expect(result.inferenceParametersUnspecified).toBe(false);
  });

  it('purpose template default wins when no per-run config is set', () => {
    const config = baseConfig();
    const template = baseTemplate({ inference: { temperature: 0.3, maxTokens: 1000 } });
    const result = resolveInferenceAndProvenance(config, template);
    expect(result.resolvedInference).toEqual({ temperature: 0.3, maxTokens: 1000, source: 'purposeTemplate' });
    expect(result.inferenceParametersUnspecified).toBe(false);
  });

  it('leaves resolvedInference undefined and flags unspecified when neither tier declares parameters', () => {
    const config = baseConfig();
    const result = resolveInferenceAndProvenance(config, baseTemplate());
    expect(result.resolvedInference).toBeUndefined();
    expect(result.inferenceParametersUnspecified).toBe(true);
  });

  it('leaves resolvedInference undefined and flags unspecified with no purpose template at all', () => {
    const config = baseConfig();
    const result = resolveInferenceAndProvenance(config, null);
    expect(result.resolvedInference).toBeUndefined();
    expect(result.inferenceParametersUnspecified).toBe(true);
  });

  it('records both endpoint paths when model ids mix server-pinned and auto-routed', () => {
    const config = baseConfig({ modelIds: ['server1::modelA', 'modelB'] });
    const result = resolveInferenceAndProvenance(config, null);
    expect(result.transportProvenance?.endpointPaths.sort()).toEqual(
      ['/api/chat/completions/any', '/api/chat/completions/server'].sort()
    );
  });

  it('records only the auto-routed endpoint when no model id is server-pinned', () => {
    const config = baseConfig({ modelIds: ['modelA', 'modelB'] });
    const result = resolveInferenceAndProvenance(config, null);
    expect(result.transportProvenance?.endpointPaths).toEqual(['/api/chat/completions/any']);
  });

  it('always reports messageShape chat-messages and seedHonored true (LMApi added seed support 2026-09-04)', () => {
    const result = resolveInferenceAndProvenance(baseConfig(), null);
    expect(result.transportProvenance?.messageShape).toBe('chat-messages');
    expect(result.transportProvenance?.seedHonored).toBe(true);
  });
});
