import { describe, it, expect, vi } from 'vitest';
import { buildLmapiProvider } from '../PromptfooAdapter';

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

  it('sends seed when provided, alongside temperature/max_tokens', async () => {
    chatCompletionMock.mockClear();
    const provider = buildLmapiProvider('model-a', 'eval-1', { temperature: 0.3, maxTokens: 1000, seed: 42 });
    await provider.callApi('system prompt', { vars: { userMessage: 'hi' } } as never);
    const sentReq = chatCompletionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(sentReq.seed).toBe(42);
  });
});
