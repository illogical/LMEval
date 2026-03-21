import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEvalSocket } from '../../hooks/useEvalSocket';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    setTimeout(() => this.onopen?.(), 0);
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.onclose?.();
  }
}

let mockWsInstance: MockWebSocket | null = null;

vi.stubGlobal('WebSocket', class extends MockWebSocket {
  constructor(url: string) {
    super(url);
    mockWsInstance = this;
  }
});

describe('useEvalSocket', () => {
  beforeEach(() => {
    mockWsInstance = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with idle status when evalId is null', () => {
    const { result } = renderHook(() => useEvalSocket(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.isCompleted).toBe(false);
  });

  it('connects when evalId is provided', async () => {
    const { result } = renderHook(() => useEvalSocket('eval-123'));
    expect(result.current.status).toBe('connecting');

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.status).toBe('open');
  });

  it('filters events by evalId', async () => {
    const { result } = renderHook(() => useEvalSocket('eval-123'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      mockWsInstance?.simulateMessage({
        type: 'cell:completed',
        evalId: 'other-eval',
        data: {},
        timestamp: Date.now(),
      });
    });

    expect(result.current.events).toHaveLength(0);
  });

  it('accepts events matching evalId', async () => {
    const { result } = renderHook(() => useEvalSocket('eval-123'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      mockWsInstance?.simulateMessage({
        type: 'cell:completed',
        evalId: 'eval-123',
        data: {},
        timestamp: Date.now(),
      });
    });

    expect(result.current.events).toHaveLength(1);
  });

  it('marks isCompleted on eval:completed event', async () => {
    const { result } = renderHook(() => useEvalSocket('eval-123'));
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      mockWsInstance?.simulateMessage({
        type: 'eval:completed',
        evalId: 'eval-123',
        data: {},
        timestamp: Date.now(),
      });
    });

    expect(result.current.isCompleted).toBe(true);
    expect(result.current.progress).toBe(100);
  });

  it('closes WebSocket on unmount', async () => {
    const { unmount } = renderHook(() => useEvalSocket('eval-123'));
    await act(async () => { await vi.runAllTimersAsync(); });
    unmount();
    expect(mockWsInstance?.close).toHaveBeenCalled();
  });
});
