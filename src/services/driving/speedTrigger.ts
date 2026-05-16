// Praeventio Guard — Sprint 12.
//
// Speed-monitor + aggressive-brake detection for SafeDrivingMode.
//
// Three responsibilities, kept as pure-as-possible primitives so the
// React hook stays a thin coordinator and the unit tests can hit the
// math without spinning a DOM:
//
//   • `useSpeedMonitor()`           — React hook over `watchPosition`
//   • `accumulateTripMileage(...)`  — pure incremental haversine reducer
//   • `detectAggressiveBrake(...)`  — pure IMU window evaluator
//
// Why pure helpers: `watchPosition` and `@capacitor/motion` are heavy
// to mock in jsdom and we don't want the test suite to depend on a
// fake Capacitor harness. By isolating the math we can test the only
// parts that have logic. The React hook is exercised at the call-site
// (SafeDrivingMode) where a real device drives it — the hook itself
// has no branches worth unit-testing in isolation.

import { useEffect, useRef, useState } from 'react';

// ─── Constants ──────────────────────────────────────────────────────

/** Earth mean radius in meters. Standard haversine constant. */
const EARTH_RADIUS_M = 6_371_000;

/** Meters → km/h. (3600 / 1000) */
const MS_TO_KMH = 3.6;

/** GPS sample is considered stale if older than this. */
const STALE_AFTER_MS = 10_000;

/** Aggressive brake: |Δv/Δt| ≥ 0.5g over a sustained window. */
export const AGGRESSIVE_BRAKE_G_THRESHOLD = 0.5;
const G_TO_MS2 = 9.80665;
export const AGGRESSIVE_BRAKE_MIN_DURATION_MS = 200;

/** Below this we consider the device stationary; ignore trip mileage. */
const STATIONARY_KMH = 3;

// ─── Types ──────────────────────────────────────────────────────────

export interface SpeedSample {
  /** Speed in meters per second. */
  speedMs: number;
  /** Speed in km/h, derived from `speedMs`. */
  speedKmh: number;
  /** GPS horizontal accuracy in meters. */
  gpsAccuracyM: number;
  /** Wall-clock timestamp of the underlying GeolocationPosition. */
  timestampMs: number;
  /** True when the last sample is older than STALE_AFTER_MS. */
  isStale: boolean;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Optional, used by `accumulateTripMileage` to discard low-quality fixes. */
  accuracyM?: number;
}

export interface ImuSample {
  /** Linear acceleration along the device's longitudinal (forward) axis, m/s². */
  longitudinalMs2: number;
  /** Wall-clock timestamp. */
  timestampMs: number;
}

// ─── Pure helpers ───────────────────────────────────────────────────

/**
 * Haversine distance between two lat/lng points, in meters. Pure;
 * deterministic. Used by `accumulateTripMileage` and exposed for tests.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Increment a running trip-distance counter. Returns the new total and
 * whether the segment was counted (for telemetry hooks).
 *
 * Discards segments where:
 *   • `prev` is null (first fix)
 *   • either fix has accuracy worse than 50m
 *   • the implied instantaneous speed is below STATIONARY_KMH
 *     (filters GPS jitter while parked)
 *   • the implied instantaneous speed exceeds 250 km/h
 *     (filters large GPS jumps after tunnels / cold-starts)
 */
export function accumulateTripMileage(
  prevTotalM: number,
  prev: GeoPoint | null,
  next: GeoPoint,
  prevTimestampMs: number,
  nextTimestampMs: number,
): { totalM: number; counted: boolean; segmentM: number } {
  if (!prev) {
    return { totalM: prevTotalM, counted: false, segmentM: 0 };
  }
  if ((prev.accuracyM ?? 0) > 50 || (next.accuracyM ?? 0) > 50) {
    return { totalM: prevTotalM, counted: false, segmentM: 0 };
  }
  const dtMs = nextTimestampMs - prevTimestampMs;
  if (dtMs <= 0) {
    return { totalM: prevTotalM, counted: false, segmentM: 0 };
  }
  const segmentM = haversineMeters(prev, next);
  const speedKmh = (segmentM / dtMs) * 1000 * MS_TO_KMH;
  if (speedKmh < STATIONARY_KMH || speedKmh > 250) {
    return { totalM: prevTotalM, counted: false, segmentM };
  }
  return { totalM: prevTotalM + segmentM, counted: true, segmentM };
}

/**
 * Evaluate a sliding window of IMU samples against the aggressive-brake
 * criterion. A brake event fires when the longitudinal deceleration
 * meets or exceeds 0.5g (`AGGRESSIVE_BRAKE_G_THRESHOLD`) and is
 * sustained for at least 200ms (`AGGRESSIVE_BRAKE_MIN_DURATION_MS`).
 *
 * `longitudinalMs2` is signed: negative = deceleration. We compare the
 * magnitude.
 *
 * Returns the timestamp of the *first* sample in the qualifying window
 * (so the caller can de-dupe rolling re-detections), or `null`.
 */
export function detectAggressiveBrake(samples: ImuSample[]): number | null {
  if (samples.length < 2) return null;
  const thresholdMs2 = AGGRESSIVE_BRAKE_G_THRESHOLD * G_TO_MS2;

  let windowStart: number | null = null;
  for (const s of samples) {
    const meets = Math.abs(s.longitudinalMs2) >= thresholdMs2;
    if (meets) {
      if (windowStart === null) windowStart = s.timestampMs;
      const elapsed = s.timestampMs - windowStart;
      if (elapsed >= AGGRESSIVE_BRAKE_MIN_DURATION_MS) {
        return windowStart;
      }
    } else {
      windowStart = null;
    }
  }
  return null;
}

// ─── React hook ─────────────────────────────────────────────────────

/**
 * Subscribe to `navigator.geolocation.watchPosition` and surface a
 * stable `SpeedSample`. Returns zeroed defaults on platforms without
 * geolocation. Cleans up the watch on unmount.
 *
 * The hook intentionally does NOT use Capacitor's native plugin even
 * though it would also work on device — the production migration path
 * is to swap the `navigator.geolocation` block for `Geolocation.watchPosition`
 * once Sprint 13 lands the iOS background-mode entitlement. Both APIs
 * deliver the same `coords.speed` field (m/s) so consumers won't change.
 */
export function useSpeedMonitor(enabled: boolean = true): SpeedSample {
  const [sample, setSample] = useState<SpeedSample>({
    speedMs: 0,
    speedKmh: 0,
    gpsAccuracyM: 0,
    timestampMs: 0,
    isStale: true,
  });

  // Keep the most recent timestamp in a ref so the staleness ticker
  // doesn't depend on `sample` (which would re-create the timer).
  const lastTsRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const speedMs = pos.coords.speed ?? 0;
        const ts = pos.timestamp ?? Date.now();
        lastTsRef.current = ts;
        setSample({
          speedMs: speedMs < 0 ? 0 : speedMs,
          speedKmh: (speedMs < 0 ? 0 : speedMs) * MS_TO_KMH,
          gpsAccuracyM: pos.coords.accuracy ?? 0,
          timestampMs: ts,
          isStale: false,
        });
      },
      () => {
        // Permission denied / timeout — mark stale, leave previous values.
        setSample((s) => ({ ...s, isStale: true }));
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    );

    // Periodic staleness check — flips `isStale` if no fix in 10s.
    const staleTimer = setInterval(() => {
      if (lastTsRef.current === 0) return;
      const age = Date.now() - lastTsRef.current;
      if (age > STALE_AFTER_MS) {
        setSample((s) => (s.isStale ? s : { ...s, isStale: true }));
      }
    }, 2_000);

    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(staleTimer);
    };
  }, [enabled]);

  return sample;
}
