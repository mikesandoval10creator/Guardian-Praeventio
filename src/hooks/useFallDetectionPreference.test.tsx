// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('idb-keyval', () => ({ get: h.get, set: h.set }));

import { useFallDetectionPreference } from './useFallDetectionPreference';

const STORAGE_KEY = 'gp.fallDetection.enabled';

beforeEach(() => {
  window.localStorage.clear();
  h.get.mockReset();
  h.set.mockReset();
  h.get.mockResolvedValue(false);
  h.set.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFallDetectionPreference — durable opt-in', () => {
  it('reads the IndexedDB value when no synchronous mirror exists', async () => {
    h.get.mockResolvedValue(true);

    const { result } = renderHook(() => useFallDetectionPreference());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.enabled).toBe(true);
  });

  it('keeps the synchronous mirror over a stale IndexedDB value', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    h.get.mockResolvedValue(false);

    const { result } = renderHook(() => useFallDetectionPreference());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.enabled).toBe(true);
  });

  it('writes the synchronous mirror before awaiting IndexedDB', async () => {
    const { result } = renderHook(() => useFallDetectionPreference());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      void result.current.setEnabled(true);
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(h.set).toHaveBeenCalledWith(STORAGE_KEY, true);
  });

  it('falls back to the synchronous mirror when IndexedDB fails', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    h.get.mockRejectedValue(new Error('IndexedDB unavailable'));

    const { result } = renderHook(() => useFallDetectionPreference());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.enabled).toBe(true);
  });
});
