import { describe, it, expect } from 'vitest';
import { normalizeAssertionStrategy, AssertionStrategyValidationError } from '../AssertionStrategyService';

describe('normalizeAssertionStrategy — R3 legacy key normalization', () => {
  it('accepts the legacy "categories" key for exact-label and normalizes to "labels"', () => {
    const result = normalizeAssertionStrategy({ type: 'exact-label', config: { categories: ['A', 'B'] } });
    expect(result).toEqual({ type: 'exact-label', config: { labels: ['A', 'B'] } });
  });

  it('accepts the new "labels" key for exact-label unchanged', () => {
    const result = normalizeAssertionStrategy({ type: 'exact-label', config: { labels: ['A', 'B'] } });
    expect(result).toEqual({ type: 'exact-label', config: { labels: ['A', 'B'] } });
  });

  it('accepts legacy "tagVocabulary"/"threshold" for label-overlap and normalizes to "vocabulary"/"minimumCaseF1"', () => {
    const result = normalizeAssertionStrategy({
      type: 'label-overlap',
      config: { tagVocabulary: ['X', 'Y'], threshold: 0.7 },
    });
    expect(result).toEqual({
      type: 'label-overlap',
      config: { vocabulary: ['X', 'Y'], minimumCaseF1: 0.7, penalizeExtraTags: true },
    });
  });

  it('defaults minimumCaseF1 to 0.5 and penalizeExtraTags to true when neither is present', () => {
    const result = normalizeAssertionStrategy({ type: 'label-overlap', config: { vocabulary: ['X'] } });
    expect(result).toEqual({
      type: 'label-overlap',
      config: { vocabulary: ['X'], minimumCaseF1: 0.5, penalizeExtraTags: true },
    });
  });

  it('accepts an explicit penalizeExtraTags: false for label-overlap', () => {
    const result = normalizeAssertionStrategy({
      type: 'label-overlap',
      config: { vocabulary: ['X'], penalizeExtraTags: false },
    });
    expect(result).toEqual({
      type: 'label-overlap',
      config: { vocabulary: ['X'], minimumCaseF1: 0.5, penalizeExtraTags: false },
    });
  });

  it('normalizes legacy type "llm-rubric" + dimensions into "grounded-summary" + templateId', () => {
    const result = normalizeAssertionStrategy({
      type: 'llm-rubric',
      config: { templateId: 'summarization-quality', dimensions: ['faithfulness'] },
    });
    expect(result.type).toBe('grounded-summary');
    if (result.type !== 'grounded-summary') throw new Error('expected grounded-summary');
    expect(result.config.templateId).toBe('summarization-quality');
    expect(result.config.dimensions).toEqual(['faithfulness']);
  });

  it('accepts the new "grounded-summary" type directly, with an optional compressionRange', () => {
    const result = normalizeAssertionStrategy({
      type: 'grounded-summary',
      config: { templateId: 'summarization-quality', compressionRange: [0.1, 0.5] },
    });
    expect(result).toEqual({
      type: 'grounded-summary',
      config: { templateId: 'summarization-quality', dimensions: undefined, compressionRange: [0.1, 0.5] },
    });
  });

  it('R2: rejects a custom strategy with no description as a validation error (would 400, not silently no-op)', () => {
    expect(() => normalizeAssertionStrategy({ type: 'custom', config: {} }))
      .toThrow(AssertionStrategyValidationError);
  });

  it('accepts a custom strategy with a description', () => {
    const result = normalizeAssertionStrategy({ type: 'custom', config: { description: 'checks something bespoke' } });
    expect(result).toEqual({ type: 'custom', config: { description: 'checks something bespoke' } });
  });

  it('rejects an unknown type', () => {
    expect(() => normalizeAssertionStrategy({ type: 'not-a-real-type', config: {} }))
      .toThrow(AssertionStrategyValidationError);
  });

  it('rejects a non-object input', () => {
    expect(() => normalizeAssertionStrategy(null)).toThrow(AssertionStrategyValidationError);
    expect(() => normalizeAssertionStrategy('exact-label')).toThrow(AssertionStrategyValidationError);
  });

  it('rejects exact-label with an empty labels array', () => {
    expect(() => normalizeAssertionStrategy({ type: 'exact-label', config: { labels: [] } }))
      .toThrow(AssertionStrategyValidationError);
  });
});
