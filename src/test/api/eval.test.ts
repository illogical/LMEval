import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrompt, addPromptVersion } from '../../api/eval';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const baseManifest = {
  id: 'prm_1',
  slug: 'my-prompt',
  name: 'My Prompt',
  versions: [{ version: 1, createdAt: '2024-01-01T00:00:00Z', tokensEstimate: 3 }],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('createPrompt', () => {
  beforeEach(() => mockFetch.mockReset());

  it('sends POST to /api/eval/prompts with name and content', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => baseManifest });

    const result = await createPrompt('My Prompt', 'Hello world');
    expect(result).toEqual(baseManifest);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/eval/prompts',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ name: 'My Prompt', content: 'Hello world' });
  });

  it('throws with JSON error message on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'EACCES: permission denied' }),
    });
    await expect(createPrompt('x', 'y')).rejects.toThrow('EACCES: permission denied');
  });

  it('falls back to statusText when response body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => { throw new Error('not json'); },
    });
    await expect(createPrompt('x', 'y')).rejects.toThrow('Internal Server Error');
  });
});

describe('addPromptVersion', () => {
  beforeEach(() => mockFetch.mockReset());

  it('sends POST to /api/eval/prompts/:id/versions with content', async () => {
    const manifest = { ...baseManifest, versions: [...baseManifest.versions, { version: 2, createdAt: '2024-01-02T00:00:00Z', tokensEstimate: 2 }] };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => manifest });

    const result = await addPromptVersion('prm_1', 'New content');
    expect(result).toEqual(manifest);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/eval/prompts/prm_1/versions',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content).toBe('New content');
  });

  it('includes description in body when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => baseManifest });

    await addPromptVersion('prm_1', 'content', 'my description');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.description).toBe('my description');
  });

  it('omits description when not provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => baseManifest });

    await addPromptVersion('prm_1', 'content');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.description).toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: 'Prompt not found' }),
    });
    await expect(addPromptVersion('bad_id', 'content')).rejects.toThrow('Prompt not found');
  });
});
