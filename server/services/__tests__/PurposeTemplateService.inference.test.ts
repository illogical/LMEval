import { describe, it, expect } from 'vitest';
import { PurposeTemplateService } from '../PurposeTemplateService';

describe('Built-in purpose templates — inference defaults', () => {
  for (const id of ['classification', 'tagging', 'summarization']) {
    it(`${id} defaults to temperature 0.3 / maxTokens 1000`, () => {
      const template = PurposeTemplateService.get(id);
      expect(template).not.toBeNull();
      expect(template?.inference).toEqual({ temperature: 0.3, maxTokens: 1000 });
    });
  }
});
