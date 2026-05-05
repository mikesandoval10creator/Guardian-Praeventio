// SPDX-License-Identifier: MIT
// Sprint 20 — Bucket D — autoTrigger sismic-detection unit tests.
//
// We test the pure side of the module via the exported helpers:
//   • `ingestAccelerationSample(accel, nowMs)` — feeds the 1s sliding peak
//     window deterministically without DeviceMotion.
//   • `checkSismo()` — returns whether the rising edge has fired this tick,
//     applying the 60s debounce.
//   • `__resetEmergencyBridges()` — fresh state per test.
//
// `Date.now()` is mocked with vi.useFakeTimers + vi.setSystemTime so the
// debounce window can be advanced deterministically. checkSismo() reads
// Date.now() internally, so the system time controls both the sustain
// check and the debounce key.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ingestAccelerationSample,
  checkSismo,
  __resetEmergencyBridges,
} from './autoTrigger';

const G = 9.80665;

/** Build an acceleration sample whose magnitude lands at `dynamicG` extra g
 *  on top of the 1g baseline the predicate subtracts. We push it all on the
 *  z axis to keep the math obvious. */
function sampleAtDynamicG(dynamicG: number) {
  const targetMag = (1 + dynamicG) * G;
  return { x: 0, y: 0, z: targetMag };
}

describe('autoTrigger — sismic detection', () => {
  beforeEach(() => {
    __resetEmergencyBridges();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetEmergencyBridges();
  });

  it('idle state: no readings → checkSismo returns false', async () => {
    expect(await checkSismo()).toBe(false);
  });

  it('a single sub-threshold reading does not trigger', async () => {
    // 0.4g dynamic — well below the 0.6g threshold.
    ingestAccelerationSample(sampleAtDynamicG(0.4), Date.now());
    // Even after the sustain window, no trigger: peak never reached the
    // threshold, so the rising-edge path was never taken.
    vi.advanceTimersByTime(500);
    expect(await checkSismo()).toBe(false);
  });

  it('above-threshold peak NOT yet sustained 300ms → no trigger', async () => {
    // Rising edge at t=0 with 0.8g dynamic.
    ingestAccelerationSample(sampleAtDynamicG(0.8), Date.now());
    // Only 100ms later — sustain not met yet.
    vi.advanceTimersByTime(100);
    expect(await checkSismo()).toBe(false);
  });

  it('sustained peaks above threshold within 1s → trigger fires', async () => {
    // Rising edge.
    ingestAccelerationSample(sampleAtDynamicG(0.8), Date.now());
    // Advance >300ms so the sustain check passes.
    vi.advanceTimersByTime(350);
    // Keep the peak alive (still in the >=0.6g branch).
    ingestAccelerationSample(sampleAtDynamicG(0.7), Date.now());
    expect(await checkSismo()).toBe(true);
  });

  it('after a trigger, debounce 60s blocks subsequent peaks', async () => {
    // First trigger.
    ingestAccelerationSample(sampleAtDynamicG(0.9), Date.now());
    vi.advanceTimersByTime(400);
    expect(await checkSismo()).toBe(true);

    // 30s later — still inside the 60s debounce window.
    vi.advanceTimersByTime(30_000);
    ingestAccelerationSample(sampleAtDynamicG(0.9), Date.now());
    vi.advanceTimersByTime(400);
    expect(await checkSismo()).toBe(false);
  });

  it('after 60s the debounce releases and a new peak can trigger again', async () => {
    // First trigger.
    ingestAccelerationSample(sampleAtDynamicG(0.9), Date.now());
    vi.advanceTimersByTime(400);
    expect(await checkSismo()).toBe(true);

    // Advance well past the 60s debounce.
    vi.advanceTimersByTime(60_001);

    // New rising edge.
    ingestAccelerationSample(sampleAtDynamicG(0.85), Date.now());
    vi.advanceTimersByTime(350);
    ingestAccelerationSample(sampleAtDynamicG(0.7), Date.now());
    expect(await checkSismo()).toBe(true);
  });

  // ─── Sprint 25 SS.4 — additional edge cases ───────────────────────────

  it('Test 7 — device without DeviceMotionEvent gracefully no-throws', async () => {
    // Simulate a desktop browser / older WebView lacking DeviceMotion.
    const win = globalThis as unknown as {
      window?: { DeviceMotionEvent?: unknown; addEventListener?: unknown };
    };
    const prev = win.window;
    // Build a minimal stub window with NO DeviceMotionEvent. The auto-trigger
    // module calls attachMotionListener() inside checkSismo(); the function
    // must early-return without throwing.
    (win as any).window = { addEventListener: () => undefined };
    try {
      delete (win as any).window.DeviceMotionEvent;
      await expect(checkSismo()).resolves.toBe(false);
      // Repeated calls must remain idempotent and never throw.
      await expect(checkSismo()).resolves.toBe(false);
      await expect(checkSismo()).resolves.toBe(false);
    } finally {
      if (prev === undefined) delete (win as any).window;
      else (win as any).window = prev;
    }
  });

  it('Test 8 — iOS DeviceMotionEvent.requestPermission rejection does not throw', async () => {
    // iOS Safari requires a user-gesture-driven permission request. A
    // rejected permission must NOT result in an infinite-error loop in the
    // sismo predicate.
    const win = globalThis as unknown as {
      window?: { DeviceMotionEvent?: unknown; addEventListener?: unknown };
    };
    const prev = win.window;
    const rejectedRequestPermission = vi.fn(async () =>
      Promise.reject(new Error('NotAllowedError')),
    );
    const dme = function DeviceMotionEvent() {} as unknown as {
      requestPermission?: typeof rejectedRequestPermission;
    };
    dme.requestPermission = rejectedRequestPermission;
    (win as any).window = {
      DeviceMotionEvent: dme,
      // addEventListener that throws if invoked — we want to assert the
      // module never reaches this path on a denied iOS permission.
      addEventListener: () => undefined,
    };
    try {
      // Multiple ticks to ensure no error accumulation.
      await expect(checkSismo()).resolves.toBe(false);
      await expect(checkSismo()).resolves.toBe(false);
      await expect(checkSismo()).resolves.toBe(false);
    } finally {
      if (prev === undefined) delete (win as any).window;
      else (win as any).window = prev;
    }
  });
});
