import type { AssertionStrategy, AssertionStrategyType } from '../../src/types/eval';

/**
 * R2/R3: validate an (possibly legacy-keyed) assertion strategy against its
 * declared type's shape, normalizing legacy config keys to their new names in
 * both directions:
 *   - exact-label:      categories        -> labels
 *   - label-overlap:    tagVocabulary     -> vocabulary
 *                       threshold         -> minimumCaseF1
 *   - llm-rubric+dimensions -> grounded-summary+templateId (type itself renames)
 *
 * Reads accept either the old or new key; this function's output always emits
 * the normalized (new) shape — callers persist what this returns, never the
 * raw input, so writes always emit normalized keys per R3.
 *
 * Throws ValidationError (message intended for a 400 response) for a
 * structurally invalid strategy — most importantly an invalid 'custom' config,
 * which today silently no-ops instead of failing.
 */
export class AssertionStrategyValidationError extends Error {}

const KNOWN_TYPES = new Set<AssertionStrategyType | 'llm-rubric'>([
  'exact-label', 'label-overlap', 'grounded-summary', 'custom', 'llm-rubric',
]);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

export function normalizeAssertionStrategy(raw: unknown): AssertionStrategy {
  if (!raw || typeof raw !== 'object') {
    throw new AssertionStrategyValidationError('assertionStrategy must be an object');
  }
  const { type, config } = raw as { type?: unknown; config?: unknown };
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type as AssertionStrategyType | 'llm-rubric')) {
    throw new AssertionStrategyValidationError(`assertionStrategy.type must be one of exact-label, label-overlap, grounded-summary, custom (got ${String(type)})`);
  }
  const cfg = (config && typeof config === 'object') ? (config as Record<string, unknown>) : {};

  switch (type) {
    case 'exact-label': {
      const labels = isStringArray(cfg.labels) ? cfg.labels
        : isStringArray(cfg.categories) ? cfg.categories // legacy key
          : null;
      if (!labels || labels.length === 0) {
        throw new AssertionStrategyValidationError('exact-label config requires a non-empty labels (or legacy categories) string array');
      }
      return { type: 'exact-label', config: { labels } };
    }
    case 'label-overlap': {
      const vocabulary = isStringArray(cfg.vocabulary) ? cfg.vocabulary
        : isStringArray(cfg.tagVocabulary) ? cfg.tagVocabulary // legacy key
          : null;
      if (!vocabulary || vocabulary.length === 0) {
        throw new AssertionStrategyValidationError('label-overlap config requires a non-empty vocabulary (or legacy tagVocabulary) string array');
      }
      const minimumCaseF1Raw = cfg.minimumCaseF1 ?? cfg.threshold; // legacy key
      const minimumCaseF1 = typeof minimumCaseF1Raw === 'number' ? minimumCaseF1Raw : 0.5;
      const penalizeExtraTags = typeof cfg.penalizeExtraTags === 'boolean' ? cfg.penalizeExtraTags : true;
      return { type: 'label-overlap', config: { vocabulary, minimumCaseF1, penalizeExtraTags } };
    }
    case 'grounded-summary':
    case 'llm-rubric': { // legacy type name, normalizes into grounded-summary
      const templateId = typeof cfg.templateId === 'string' ? cfg.templateId : null;
      if (!templateId) {
        throw new AssertionStrategyValidationError('grounded-summary config requires a templateId');
      }
      const dimensions = isStringArray(cfg.dimensions) ? cfg.dimensions : undefined;
      const compressionRange = Array.isArray(cfg.compressionRange) && cfg.compressionRange.length === 2
        && cfg.compressionRange.every(n => typeof n === 'number')
        ? (cfg.compressionRange as [number, number])
        : undefined;
      return { type: 'grounded-summary', config: { templateId, dimensions, compressionRange } };
    }
    case 'custom': {
      const description = typeof cfg.description === 'string' ? cfg.description.trim() : '';
      if (!description) {
        throw new AssertionStrategyValidationError("custom assertionStrategy config requires a non-empty 'description'");
      }
      return { type: 'custom', config: { description } };
    }
    default:
      // Unreachable given the KNOWN_TYPES guard above, but keeps the switch exhaustive.
      throw new AssertionStrategyValidationError(`Unsupported assertionStrategy.type: ${String(type)}`);
  }
}
