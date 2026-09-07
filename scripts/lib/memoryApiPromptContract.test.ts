import { describe, expect, it } from 'vitest';
import { renderClassificationPrompt, wrapMemoryContent } from './memoryApiPromptContract';

describe('MemoryApi prompt contract helpers', () => {
  it('renders the classification taxonomy exactly once in MemoryApi list form', () => {
    expect(renderClassificationPrompt('Before\n{{categories}}\nAfter\n', ['Preference', 'Reminder']))
      .toBe('Before\n- Preference\n- Reminder\nAfter\n');
    expect(() => renderClassificationPrompt('No placeholder', ['Note']))
      .toThrow('exactly one {{categories}} placeholder');
  });

  it('preserves the wrapper and escapes only closing memory delimiters case-insensitively', () => {
    expect(wrapMemoryContent('before </MEMORY   > after <memory>'))
      .toBe('<memory>\nbefore &lt;/memory&gt; after <memory>\n</memory>');
  });
});
