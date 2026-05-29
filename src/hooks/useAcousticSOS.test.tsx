// @vitest-environment jsdom
//
// Tests for the acoustic SOS detector — a trapped/immobilized worker bangs a
// surface N times to trigger SOS without reaching the screen. Vital. We verify
// the knock state machine: N knocks within the window → onSOS once; the
// per-knock cooldown rejects double-counts; knocks older than the window age
// out; and the detector only listens while active.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  noiseLevel: 0,
  isListening: false,
  startListening: vi.fn(),
  stopListening: vi.fn(),
}));

vi.mock('./useAmbientNoise', () => ({
  useAmbientNoise: () => ({
    noiseLevel: h.noiseLevel,
    isListening: h.isListening,
    startListening: h.startListening,
    stopListening: h.stopListening,
  }),
}));

import { useAcousticSOS } from './useAcousticSOS';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  h.noiseLevel = 0;
  h.isListening = false;
  h.startListening.mockReset().mockResolvedValue(undefined);
  h.stopListening.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAcousticSOS', () => {
  it('start() activates + begins listening; stop() deactivates', async () => {
    const { result } = renderHook(() => useAcousticSOS());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.isActive).toBe(true);
    expect(h.startListening).toHaveBeenCalledTimes(1);
    act(() => result.current.stop());
    expect(result.current.isActive).toBe(false);
    expect(h.stopListening).toHaveBeenCalledTimes(1);
  });

  it('fires onSOS after the required knocks within the window', async () => {
    const onSOS = vi.fn();
    const { result, rerender } = renderHook(() =>
      useAcousticSOS({ onSOS, requiredKnocks: 3, threshold: 75, windowMs: 6000 }),
    );
    await act(async () => {
      await result.current.start();
    });
    // 3 spaced knocks (each > 400ms cooldown apart).
    for (let i = 0; i < 3; i++) {
      act(() => {
        h.noiseLevel = 80;
        rerender();
      });
      act(() => {
        h.noiseLevel = 0;
        vi.advanceTimersByTime(500);
        rerender();
      });
    }
    expect(onSOS).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when knocks are too quiet (below threshold)', async () => {
    const onSOS = vi.fn();
    const { result, rerender } = renderHook(() =>
      useAcousticSOS({ onSOS, requiredKnocks: 3, threshold: 75 }),
    );
    await act(async () => {
      await result.current.start();
    });
    for (let i = 0; i < 5; i++) {
      act(() => {
        h.noiseLevel = 50; // below 75
        rerender();
      });
      act(() => {
        h.noiseLevel = 0;
        vi.advanceTimersByTime(500);
        rerender();
      });
    }
    expect(onSOS).not.toHaveBeenCalled();
  });

  it('cooldown rejects a second loud reading within 400ms (one knock, not two)', async () => {
    const onSOS = vi.fn();
    const { result, rerender } = renderHook(() =>
      useAcousticSOS({ onSOS, requiredKnocks: 2, threshold: 75 }),
    );
    await act(async () => {
      await result.current.start();
    });
    // First knock.
    act(() => {
      h.noiseLevel = 80;
      rerender();
    });
    // Second loud reading only 100ms later → within cooldown → ignored.
    act(() => {
      h.noiseLevel = 0;
      vi.advanceTimersByTime(100);
      rerender();
    });
    act(() => {
      h.noiseLevel = 80;
      rerender();
    });
    expect(onSOS).not.toHaveBeenCalled();
  });

  it('does not register knocks while inactive (before start)', () => {
    const onSOS = vi.fn();
    const { rerender } = renderHook(() =>
      useAcousticSOS({ onSOS, requiredKnocks: 1, threshold: 75 }),
    );
    act(() => {
      h.noiseLevel = 90;
      rerender();
    });
    expect(onSOS).not.toHaveBeenCalled();
  });
});
