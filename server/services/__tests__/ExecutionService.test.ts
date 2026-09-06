import { describe, expect, it } from 'vitest';
import { isPromptfooExecutionFailure } from '../ExecutionService';

describe('Promptfoo result lifecycle mapping', () => {
  it('keeps assertion misses as completed model calls', () => {
    expect(isPromptfooExecutionFailure(1)).toBe(false);
  });

  it('marks provider and execution errors as failed model calls', () => {
    expect(isPromptfooExecutionFailure(2)).toBe(true);
  });
});
