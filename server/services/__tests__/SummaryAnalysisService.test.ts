import { describe, it, expect, vi } from 'vitest';
import { SummaryAnalysisService } from '../SummaryAnalysisService';
import type { EvaluationConfig } from '../../../src/types/eval';

vi.mock('../PromptService', () => ({
  PromptService: {
    get: (id: string) => id === 'unknown-prompt' ? null : { id, versions: [{ version: 2 }] },
    getVersionContent: (id: string) => `current content for ${id}`,
  },
}));

function baseConfig(overrides: Partial<EvaluationConfig> = {}): EvaluationConfig {
  return {
    id: 'eval-1',
    name: 'test',
    promptIds: ['prompt-a', 'prompt-b'],
    modelIds: ['m1'],
    status: 'completed',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const VALID_JSON = JSON.stringify({
  overview: 'Model A struggled on edge cases.',
  strengths: ['Fast', 'Consistent formatting'],
  weaknesses: ['Misses rare categories'],
  suggestions: [
    { targetSlot: 'A', revisedContent: 'You are a better classifier...', rationale: 'clarify edge cases', estimatedImpact: '+0.1 macroF1' },
  ],
});

describe('SummaryAnalysisService.parseAnalysisResponse', () => {
  it('parses a direct JSON response (step 1)', () => {
    const result = SummaryAnalysisService.parseAnalysisResponse(VALID_JSON, baseConfig());
    expect(result?.overview).toBe('Model A struggled on edge cases.');
    expect(result?.strengths).toEqual(['Fast', 'Consistent formatting']);
    expect(result?.suggestions).toHaveLength(1);
    expect(result?.suggestions[0]).toMatchObject({
      targetSlot: 'A',
      revisedContent: 'You are a better classifier...',
      currentContent: 'current content for prompt-a',
      rationale: 'clarify edge cases',
      estimatedImpact: '+0.1 macroF1',
    });
    expect(result?.suggestions[0].id).toBeTruthy();
  });

  it('parses a response wrapped in markdown fences (step 2)', () => {
    const fenced = '```json\n' + VALID_JSON + '\n```';
    const result = SummaryAnalysisService.parseAnalysisResponse(fenced, baseConfig());
    expect(result?.overview).toBe('Model A struggled on edge cases.');
  });

  it('extracts the first {...} block containing "overview" from surrounding prose (step 3)', () => {
    const withProse = `Sure, here is my analysis:\n${VALID_JSON}\nLet me know if you need more.`;
    const result = SummaryAnalysisService.parseAnalysisResponse(withProse, baseConfig());
    expect(result?.overview).toBe('Model A struggled on edge cases.');
  });

  it('gives up and returns null on unparseable garbage (step 4)', () => {
    const result = SummaryAnalysisService.parseAnalysisResponse('not json at all', baseConfig());
    expect(result).toBeNull();
  });

  it('drops a suggestion missing a required field rather than throwing', () => {
    const malformed = JSON.stringify({
      overview: 'ok',
      strengths: [],
      weaknesses: [],
      suggestions: [
        { targetSlot: 'A', revisedContent: 'valid one', rationale: 'r' },
        { targetSlot: 'C', revisedContent: 'invalid slot' },
        { targetSlot: 'B' /* missing revisedContent */ },
      ],
    });
    const result = SummaryAnalysisService.parseAnalysisResponse(malformed, baseConfig());
    expect(result?.suggestions).toHaveLength(1);
    expect(result?.suggestions[0].targetSlot).toBe('A');
  });

  it('resolves currentContent to an empty string when the target prompt no longer exists', () => {
    const config = baseConfig({ promptIds: ['unknown-prompt', 'prompt-b'] });
    const result = SummaryAnalysisService.parseAnalysisResponse(VALID_JSON, config);
    expect(result?.suggestions[0].currentContent).toBe('');
  });
});
