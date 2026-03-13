import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getServers, chatCompletion } from '../../api/lmapi';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('getServers', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns servers array on success', async () => {
    const servers = [{ config: { name: 'alpha', baseUrl: 'http://localhost:3111' }, isOnline: true, models: ['llama3:latest'], runningModels: [], activeModels: [], activeRequests: 0, lastChecked: 0 }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => servers });

    const result = await getServers();
    expect(result).toEqual(servers);
    expect(mockFetch).toHaveBeenCalledWith('/lmapi/api/servers');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Service Unavailable' });
    await expect(getServers()).rejects.toThrow('Failed to fetch servers: Service Unavailable');
  });
});

describe('chatCompletion', () => {
  beforeEach(() => mockFetch.mockReset());

  it('sends POST request with correct body', async () => {
    const mockResponse = { id: '1', object: 'chat.completion', created: 0, model: 'llama3:latest', choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }] };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse });

    const req = { model: 'llama3:latest', messages: [{ role: 'user' as const, content: 'hi' }], stream: false as const };
    const result = await chatCompletion(req);
    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith('/lmapi/api/chat/completions/any', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }));
  });

  it('throws on error response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Bad Request', json: async () => ({ error: 'Invalid model' }) });
    const req = { model: 'bad-model', messages: [], stream: false as const };
    await expect(chatCompletion(req)).rejects.toThrow('Invalid model');
  });
});
