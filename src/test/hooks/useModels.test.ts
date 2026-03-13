import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModels } from '../../hooks/useModels';
import * as lmapiApi from '../../api/lmapi';

vi.mock('../../api/lmapi');
const mockGetServers = vi.mocked(lmapiApi.getServers);

describe('useModels', () => {
  beforeEach(() => mockGetServers.mockReset());

  it('returns flattened models from online servers', async () => {
    mockGetServers.mockResolvedValueOnce([
      { config: { name: 'alpha', baseUrl: '' }, isOnline: true, models: ['llama3:latest', 'mistral:7b'], runningModels: [], activeModels: [], activeRequests: 0, lastChecked: 0 },
      { config: { name: 'beta', baseUrl: '' }, isOnline: false, models: ['gpt4:latest'], runningModels: [], activeModels: [], activeRequests: 0, lastChecked: 0 },
    ]);

    const { result } = renderHook(() => useModels());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.models).toHaveLength(2);
    expect(result.current.models[0]).toEqual({ value: 'llama3:latest', label: 'llama3:latest', serverName: 'alpha' });
    expect(result.current.models[1]).toEqual({ value: 'mistral:7b', label: 'mistral:7b', serverName: 'alpha' });
    expect(result.current.error).toBeNull();
  });

  it('handles fetch errors', async () => {
    mockGetServers.mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useModels());
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.error).toBe('Network error');
    expect(result.current.models).toHaveLength(0);
  });
});
