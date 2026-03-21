import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModels } from '../../hooks/useModels';
import * as lmapiApi from '../../api/lmapi';

vi.mock('../../api/lmapi');
const mockGetLoadedModels = vi.mocked(lmapiApi.getLoadedModels);

describe('useModels', () => {
  beforeEach(() => mockGetLoadedModels.mockReset());

  it('returns models from getLoadedModels', async () => {
    mockGetLoadedModels.mockResolvedValueOnce(['llama3:latest', 'mistral:7b']);

    const { result } = renderHook(() => useModels());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.models).toHaveLength(2);
    expect(result.current.models[0]).toEqual({ value: 'llama3:latest', label: 'llama3:latest', serverName: 'Available' });
    expect(result.current.models[1]).toEqual({ value: 'mistral:7b', label: 'mistral:7b', serverName: 'Available' });
    expect(result.current.error).toBeNull();
  });

  it('handles fetch errors', async () => {
    mockGetLoadedModels.mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useModels());
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.error).toBe('Network error');
    expect(result.current.models).toHaveLength(0);
  });
});
