import { describe, it, expect, vi } from 'vitest';
import { buildLmapiProvider, PromptfooAdapter } from '../PromptfooAdapter';
import type { EvaluationConfig, TestCase } from '../../../src/types/eval';

type JsAssertionValue = (output: string) => { pass: boolean; score: number; reason: string };

const chatCompletionMock = vi.fn().mockResolvedValue({
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
});

vi.mock('../LmapiClient', () => ({
  LmapiClient: {
    chatCompletion: (...args: unknown[]) => chatCompletionMock(...args),
    chatCompletionOnServer: (...args: unknown[]) => chatCompletionMock(...args),
  },
}));

describe('buildLmapiProvider — inference parameter threading', () => {
  it('omits temperature/max_tokens/seed from the request when no inference is given', async () => {
    chatCompletionMock.mockClear();
    const provider = buildLmapiProvider('model-a', 'eval-1');
    await provider.callApi('system prompt', { vars: { userMessage: 'hi' } } as never);
    const sentReq = chatCompletionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(sentReq).not.toHaveProperty('temperature');
    expect(sentReq).not.toHaveProperty('max_tokens');
    expect(sentReq).not.toHaveProperty('seed');
  });

  it('sends temperature and max_tokens when inference is provided', async () => {
    chatCompletionMock.mockClear();
    const provider = buildLmapiProvider('model-a', 'eval-1', { temperature: 0.3, maxTokens: 1000 });
    await provider.callApi('system prompt', { vars: { userMessage: 'hi' } } as never);
    const sentReq = chatCompletionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(sentReq.temperature).toBe(0.3);
    expect(sentReq.max_tokens).toBe(1000);
    expect(sentReq).not.toHaveProperty('seed');
  });

  it('persists the exact model id in response metadata for result mapping', async () => {
    const provider = buildLmapiProvider('Localhost::model-a', 'eval-1');
    const response = await provider.callApi('system prompt', { vars: { userMessage: 'hi' } } as never);
    expect(response.metadata?.modelId).toBe('Localhost::model-a');
  });

  it('sends seed when provided, alongside temperature/max_tokens', async () => {
    chatCompletionMock.mockClear();
    const provider = buildLmapiProvider('model-a', 'eval-1', { temperature: 0.3, maxTokens: 1000, seed: 42 });
    await provider.callApi('system prompt', { vars: { userMessage: 'hi' } } as never);
    const sentReq = chatCompletionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(sentReq.seed).toBe(42);
  });
});

function baseConfig(): EvaluationConfig {
  return {
    id: 'eval-1', name: 'test', promptIds: ['p1'], modelIds: ['m1'],
    status: 'pending', createdAt: '', updatedAt: '',
  };
}

describe('PromptfooAdapter.buildTestSuite repeated runs', () => {
  it('expands each test case in run order so Promptfoo executes every matrix cell', () => {
    const config = { ...baseConfig(), runsPerCell: 3 };
    const testCases: TestCase[] = [
      { id: 'tc1', userMessage: 'first' },
      { id: 'tc2', userMessage: 'second' },
    ];
    const { testSuite, testCaseOrder } = PromptfooAdapter.buildTestSuite({
      evalId: 'eval-1', config,
      promptContents: [{ promptId: 'p1', content: 'sys' }],
      testCases, template: null, purposeStrategy: null,
    });

    expect(testSuite.tests).toHaveLength(6);
    expect(testSuite.tests.map(test => test.vars.lmevalRun)).toEqual(['1', '2', '3', '1', '2', '3']);
    expect(testCaseOrder).toEqual(['tc1', 'tc1', 'tc1', 'tc2', 'tc2', 'tc2']);
  });
});

describe('PromptfooAdapter.buildTestSuite — R1 exact-label wiring', () => {
  const tc: TestCase = { id: 'tc1', userMessage: 'a memory', expectedOutput: 'Preference' };

  it('builds an exact-label javascript assertion that rejects prose containing the label', () => {
    const { testSuite } = PromptfooAdapter.buildTestSuite({
      evalId: 'eval-1',
      config: baseConfig(),
      promptContents: [{ promptId: 'p1', content: 'sys' }],
      testCases: [tc],
      template: null,
      purposeStrategy: { type: 'exact-label', config: { labels: ['Preference', 'Reminder'] } },
    });
    const assertion = testSuite.tests[0].assert.find(a => a.metric === 'exact-label');
    expect(assertion).toBeDefined();
    const check = assertion!.value as JsAssertionValue;
    // R1's whole point: expectedKeywords-style prose containing the label must NOT pass.
    expect(check('The correct category is Preference.').pass).toBe(false);
    expect(check('Preference').pass).toBe(true);
  });

  it('flags a response outside the declared label set as not a declared label', () => {
    const { testSuite } = PromptfooAdapter.buildTestSuite({
      evalId: 'eval-1',
      config: baseConfig(),
      promptContents: [{ promptId: 'p1', content: 'sys' }],
      testCases: [tc],
      template: null,
      purposeStrategy: { type: 'exact-label', config: { labels: ['Preference', 'Reminder'] } },
    });
    const assertion = testSuite.tests[0].assert.find(a => a.metric === 'exact-label');
    const check = assertion!.value as JsAssertionValue;
    const result = check('Code snippet');
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('not a declared label');
  });

  it('does not build an exact-label assertion when the test case has no expectedOutput', () => {
    const { testSuite } = PromptfooAdapter.buildTestSuite({
      evalId: 'eval-1',
      config: baseConfig(),
      promptContents: [{ promptId: 'p1', content: 'sys' }],
      testCases: [{ id: 'tc2', userMessage: 'a memory' }],
      template: null,
      purposeStrategy: { type: 'exact-label', config: { labels: ['Preference'] } },
    });
    expect(testSuite.tests[0].assert.find(a => a.metric === 'exact-label')).toBeUndefined();
  });
});

describe('PromptfooAdapter.buildTestSuite — R6 summarization deterministic assertion', () => {
  it('builds a summary-deterministic javascript assertion that fails on a preamble', () => {
    const tc: TestCase = { id: 'tc1', userMessage: 'a'.repeat(100) };
    const { testSuite } = PromptfooAdapter.buildTestSuite({
      evalId: 'eval-1',
      config: baseConfig(),
      promptContents: [{ promptId: 'p1', content: 'sys' }],
      testCases: [tc],
      template: null,
      purposeStrategy: { type: 'grounded-summary', config: { templateId: 'summarization-quality' } },
    });
    const assertion = testSuite.tests[0].assert.find(a => a.metric === 'summary-deterministic');
    expect(assertion).toBeDefined();
    const check = assertion!.value as JsAssertionValue;
    expect(check('Here is a summary: ' + 'a'.repeat(30)).pass).toBe(false);
    expect(check('a'.repeat(30)).pass).toBe(true);
  });
});
