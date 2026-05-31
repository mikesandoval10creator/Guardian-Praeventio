// Unit tests for the pure driving-safety helpers in speedTrigger.ts.
//
// These back the Safe Driving mode: trip-mileage accumulation (with GPS-jitter
// gating) and aggressive-brake detection from IMU samples. They are pure +
// deterministic, so we exercise them directly — no geolocation/hook involved
// (useSpeedMonitor is a React hook and out of scope here).

import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  accumulateTripMileage,
  detectAggressiveBrake,
  AGGRESSIVE_BRAKE_G_THRESHOLD,
  AGGRESSIVE_BRAKE_MIN_DURATION_MS,
  type ImuSample,
} from './speedTrigger';

// 0.5g ≈ 4.903 m/s². Pick samples comfortably above/below.
const G_TO_MS2 = 9.80665;
const BRAKE_THRESHOLD_MS2 = AGGRESSIVE_BRAKE_G_THRESHOLD * G_TO_MS2; // ~4.903
const HARD = -(BRAKE_THRESHOLD_MS2 + 1); // clearly meets (decel)
const SOFT = -(BRAKE_THRESHOLD_MS2 - 1); // clearly below

describe('haversineMeters', () => {
  it('is 0 for the same point', () => {
    expect(haversineMeters({ lat: -33.45, lng: -70.66 }, { lat: -33.45, lng: -70.66 })).toBe(0);
  });

  it('≈ 111.2 km for one degree of latitude', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('is symmetric', () => {
    const a = { lat: -33.45, lng: -70.66 };
    const b = { lat: -33.44, lng: -70.65 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('returns a small positive distance for a ~111 m hop', () => {
    // ~0.001° lng at the equator ≈ 111 m.
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe('accumulateTripMileage', () => {
  const good = { lat: 0, lng: 0, accuracyM: 5 };

  it('does not count the first fix (prev null)', () => {
    const r = accumulateTripMileage(0, null, good, 0, 1000);
    expect(r.counted).toBe(false);
    expect(r.totalM).toBe(0);
    expect(r.segmentM).toBe(0);
  });

  it('discards segments when either fix has accuracy worse than 50 m', () => {
    const lowPrev = { lat: 0, lng: 0, accuracyM: 60 };
    const r1 = accumulateTripMileage(100, lowPrev, good, 0, 5000);
    expect(r1.counted).toBe(false);
    expect(r1.totalM).toBe(100);

    const lowNext = { lat: 0, lng: 0.001, accuracyM: 80 };
    const r2 = accumulateTripMileage(100, good, lowNext, 0, 5000);
    expect(r2.counted).toBe(false);
    expect(r2.totalM).toBe(100);
  });

  it('discards a non-positive time delta', () => {
    const r = accumulateTripMileage(100, good, { lat: 0, lng: 0.001, accuracyM: 5 }, 5000, 5000);
    expect(r.counted).toBe(false);
    expect(r.totalM).toBe(100);
  });

  it('discards stationary GPS jitter (implied speed below 3 km/h)', () => {
    // ~0.11 m over 5 s ≈ 0.08 km/h.
    const next = { lat: 0, lng: 0.000001, accuracyM: 5 };
    const r = accumulateTripMileage(100, good, next, 0, 5000);
    expect(r.counted).toBe(false);
    expect(r.totalM).toBe(100);
    expect(r.segmentM).toBeGreaterThan(0); // segment computed, just not counted
  });

  it('discards large GPS jumps (implied speed above 250 km/h)', () => {
    // ~111 km over 1 s → absurd speed (post-tunnel cold start).
    const next = { lat: 0, lng: 1, accuracyM: 5 };
    const r = accumulateTripMileage(100, good, next, 0, 1000);
    expect(r.counted).toBe(false);
    expect(r.totalM).toBe(100);
  });

  it('counts a realistic ~80 km/h segment and adds the distance', () => {
    // ~111 m over 5 s ≈ 80 km/h.
    const next = { lat: 0, lng: 0.001, accuracyM: 5 };
    const r = accumulateTripMileage(1000, good, next, 0, 5000);
    expect(r.counted).toBe(true);
    expect(r.segmentM).toBeGreaterThan(100);
    expect(r.totalM).toBeCloseTo(1000 + r.segmentM, 6);
  });
});

describe('detectAggressiveBrake', () => {
  const mk = (longitudinalMs2: number, timestampMs: number): ImuSample => ({
    longitudinalMs2,
    timestampMs,
  });

  it('returns null for fewer than 2 samples', () => {
    expect(detectAggressiveBrake([])).toBeNull();
    expect(detectAggressiveBrake([mk(HARD, 0)])).toBeNull();
  });

  it('returns null when no sample meets the 0.5g threshold', () => {
    expect(detectAggressiveBrake([mk(SOFT, 0), mk(SOFT, 100), mk(SOFT, 300)])).toBeNull();
  });

  it('fires (returns window start) for a hard brake sustained ≥ 200 ms', () => {
    const start = detectAggressiveBrake([mk(HARD, 0), mk(HARD, 100), mk(HARD, 200)]);
    expect(start).toBe(0);
  });

  it('does NOT fire for a hard but too-brief brake (< 200 ms)', () => {
    expect(detectAggressiveBrake([mk(HARD, 0), mk(HARD, 100)])).toBeNull();
  });

  it('resets the window when a sample drops below threshold', () => {
    // First window broken at t=100, a fresh qualifying window starts at t=200.
    const start = detectAggressiveBrake([
      mk(HARD, 0),
      mk(SOFT, 100), // resets
      mk(HARD, 200),
      mk(HARD, 450),
    ]);
    expect(start).toBe(200);
  });

  it('compares magnitude — a sustained hard ACCELERATION also qualifies', () => {
    // longitudinalMs2 is signed; the detector uses |value|.
    const start = detectAggressiveBrake([
      mk(-HARD, 1_000),
      mk(-HARD, 1_120),
      mk(-HARD, 1_220),
    ]);
    expect(start).toBe(1_000);
  });

  it('returns the FIRST qualifying window start (for caller de-dupe)', () => {
    const start = detectAggressiveBrake([
      mk(HARD, 0),
      mk(HARD, 250),
      mk(HARD, 500),
    ]);
    // Window opens at 0; by t=250 elapsed=250 ≥ 200 → returns 0, not 250.
    expect(start).toBe(0);
  });

  it('exposes the documented thresholds as constants', () => {
    expect(AGGRESSIVE_BRAKE_G_THRESHOLD).toBe(0.5);
    expect(AGGRESSIVE_BRAKE_MIN_DURATION_MS).toBe(200);
  });
});
