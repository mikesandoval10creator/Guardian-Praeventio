// @vitest-environment jsdom
//
// B1 — the acoustic SOS must fire on DISTINCT knocks, never on sustained loud
// noise. Before the edge-detection fix, machinery or a running alarm staying
// above threshold racked up phantom "knocks" → false SOS, which erodes trust in
// a life-safety trigger and wastes responder attention.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ noise: 0 }));
vi.mock('./useAmbientNoise', () => ({
  useAmbientNoise: () => ({
    noiseLevel: h.noise,
    isListening: true,
    startListening: vi.fn(async () => {}),
    stopListening: vi.fn(),
  }),
}));

import { useAcousticSOS } from './useAcousticSOS';

let nowMs = 1_000_000;
beforeEach(() => {
  nowMs = 1_000_000;
  h.noise = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterEach(() => vi.restoreAllMocks());

function advance(ms: number) {
  nowMs += ms;
}

describe('useAcousticSOS — knock edge detection (B1, no false SOS)', () => {
  it('does NOT trigger SOS on sustained loud noise (machinery/alarm)', () => {
    const onSOS = vi.fn();
    const { result, rerender } = renderHook(() =>
      useAcousticSOS({ threshold: 75, requiredKnocks: 3, windowMs: 6000, onSOS }),
    );
    act(() => { void result.current.start(); });

    // Many consecutive sensor frames all loud → counts as at most ONE knock.
    for (let i = 0; i < 8; i++) {
      advance(600);
      h.noise = 95;
      rerender();
    }
    expect(onSOS).not.toHaveBeenCalled();
  });

  it('triggers SOS on N distinct knocks (each a below→above edge)', () => {
    const onSOS = vi.fn();
    const { result, rerender } = renderHook(() =>
      useAcousticSOS({ threshold: 75, requiredKnocks: 3, windowMs: 6000, onSOS }),
    );
    act(() => { void result.current.start(); });

    const knock = () => {
      advance(600); h.noise = 95; rerender(); // rising edge
      advance(600); h.noise = 10; rerender(); // fall back below → re-arm
    };

    knock(); // 1
    knock(); // 2
    expect(onSOS).not.toHaveBeenCalled();
    knock(); // 3 → SOS
    expect(onSOS).toHaveBeenCalledTimes(1);
  });

  it('ignores brief threshold jitter via hysteresis (no spurious extra knocks)', () => {
    const onSOS = vi.fn();
    const { result, rerender } = renderHook(() =>
      useAcousticSOS({ threshold: 75, requiredKnocks: 2, windowMs: 6000, onSOS }),
    );
    act(() => { void result.current.start(); });

    advance(600); h.noise = 95; rerender(); // knock 1 (armed→fires)
    advance(600); h.noise = 70; rerender(); // 70 is below threshold but ABOVE release (75*0.8=60): NOT re-armed
    advance(600); h.noise = 95; rerender(); // still not re-armed → no second knock
    expect(onSOS).not.toHaveBeenCalled();
  });
});
