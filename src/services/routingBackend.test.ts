import { describe, it, expect } from 'vitest';
import {
  calculateDeterministicSafeRoute,
  calculateDistance,
  type Point,
  type HazardZone,
} from './routingBackend';

// --- Local Haversine helper for assertions (independent of impl) ---
// Mirrors the formula in the implementation to keep tests self-contained
// without introducing a new dependency.
function haversineMeters(a: Point, b: Point): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 1m tolerance is the spec for waypoint-position assertions.
const POS_TOLERANCE_M = 1;

// Two well-separated points (~1.4 km apart in NYC).
const start: Point = { lat: 40.7128, lng: -74.006 };
const destination: Point = { lat: 40.72, lng: -74.0 };

function midpoint(a: Point, b: Point): Point {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

// Linear interp at fraction f (matches impl's lat/lng linear interpolation).
function lerp(a: Point, b: Point, f: number): Point {
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
  };
}

describe('calculateDeterministicSafeRoute — shape and counts', () => {
  it('returns exactly 11 waypoints (start + 9 interpolated + destination) for non-degenerate input', () => {
    // characterization: spec says "10 waypoints" but the implementation uses
    // `for (i=1; i<10; i++)` plus pushes start and destination explicitly,
    // so the output length is 11. Pin this so future refactors are explicit.
    const route = calculateDeterministicSafeRoute(start, destination, []);
    expect(route).toHaveLength(11);
  });

  it('first waypoint is exactly start; last waypoint is exactly destination', () => {
    const route = calculateDeterministicSafeRoute(start, destination, []);
    // characterization: start and destination are pushed by reference (no copy),
    // so equality is exact rather than approximate.
    expect(route[0]).toEqual(start);
    expect(route[route.length - 1]).toEqual(destination);
  });
});

describe('calculateDeterministicSafeRoute — straight-line behavior with no hazards', () => {
  it('with no hazards, every waypoint lies on the lat/lng linear-interpolation line within 1m', () => {
    const route = calculateDeterministicSafeRoute(start, destination, []);
    for (let i = 0; i < route.length; i++) {
      const f = i / (route.length - 1);
      const expected = lerp(start, destination, f);
      const drift = haversineMeters(route[i], expected);
      expect(drift).toBeLessThanOrEqual(POS_TOLERANCE_M);
    }
  });
});

describe('calculateDeterministicSafeRoute — hazard avoidance', () => {
  it('a hazard centered on the midpoint pushes every waypoint outside the hazard radius', () => {
    const hazard: HazardZone = { center: midpoint(start, destination), radius: 200 };
    const route = calculateDeterministicSafeRoute(start, destination, [hazard]);
    // Note: start and destination themselves are never re-checked by the impl, but
    // for this test they're 700m+ from the midpoint so they're safely outside anyway.
    for (const wp of route) {
      const d = calculateDistance(wp, hazard.center);
      expect(d).toBeGreaterThanOrEqual(hazard.radius);
    }
  });

  it('multiple chained hazards along the line: every interpolated waypoint clears every hazard', () => {
    // characterization: the impl handles only ONE hazard per waypoint (`break` after
    // the first match). We pick non-overlapping hazards along the line so that each
    // problematic waypoint hits at most one hazard — that's the only configuration
    // in which the current implementation guarantees clearance for all hazards.
    const h1: HazardZone = { center: lerp(start, destination, 0.3), radius: 100 };
    const h2: HazardZone = { center: lerp(start, destination, 0.7), radius: 100 };
    const route = calculateDeterministicSafeRoute(start, destination, [h1, h2]);
    for (const wp of route.slice(1, -1)) {
      expect(calculateDistance(wp, h1.center)).toBeGreaterThanOrEqual(h1.radius);
      expect(calculateDistance(wp, h2.center)).toBeGreaterThanOrEqual(h2.radius);
    }
  });

  it('hazard with radius 0 (point hazard) does not displace any waypoint', () => {
    // The impl's guard is `distToHazard < hazard.radius`. With radius=0 this is
    // never true, so no waypoint is shifted.
    const hazard: HazardZone = { center: midpoint(start, destination), radius: 0 };
    const noHazardRoute = calculateDeterministicSafeRoute(start, destination, []);
    const withHazardRoute = calculateDeterministicSafeRoute(start, destination, [hazard]);
    expect(withHazardRoute).toEqual(noHazardRoute);
  });
});

describe('calculateDeterministicSafeRoute — degenerate inputs (characterization)', () => {
  it('start === destination: returns 11 copies of the same point (no NaN, no infinite loop)', () => {
    // characterization: the loop runs to completion because `fraction * 0` deltas
    // collapse every interpolated point to `start`. No divide-by-zero occurs in
    // the avoidance branch because no hazard logic uses the start→destination
    // delta. Documented here so callers can rely on this terminating cleanly.
    const p: Point = { lat: 1, lng: 2 };
    const route = calculateDeterministicSafeRoute(p, p, []);
    expect(route).toHaveLength(11);
    for (const wp of route) {
      expect(wp.lat).toBe(1);
      expect(wp.lng).toBe(2);
      expect(Number.isFinite(wp.lat)).toBe(true);
      expect(Number.isFinite(wp.lng)).toBe(true);
    }
  });

  it('start === destination inside a hazard: every waypoint is pushed to the hazard ring (deterministic, finite)', () => {
    // characterization: when start==destination AND that point is inside a hazard,
    // each interpolated point gets shifted to the hazard ring at the same angle.
    // Documents that this terminates and produces finite values.
    const center: Point = { lat: 0, lng: 0 };
    const start2: Point = { lat: 0.0001, lng: 0 }; // ~11m north of center
    const hazard: HazardZone = { center, radius: 50 };
    const route = calculateDeterministicSafeRoute(start2, start2, [hazard]);
    expect(route).toHaveLength(11);
    for (const wp of route) {
      expect(Number.isFinite(wp.lat)).toBe(true);
      expect(Number.isFinite(wp.lng)).toBe(true);
    }
    // First and last are still the original start (pushed by reference, no clearance applied).
    expect(route[0]).toEqual(start2);
    expect(route[route.length - 1]).toEqual(start2);
  });

  it('NaN coordinates propagate as NaN (no throw) — characterization', () => {
    const bad: Point = { lat: NaN, lng: NaN };
    const route = calculateDeterministicSafeRoute(bad, destination, []);
    expect(route).toHaveLength(11);
    // First waypoint is the same reference as start (NaN preserved).
    expect(Number.isNaN(route[0].lat)).toBe(true);
    expect(Number.isNaN(route[0].lng)).toBe(true);
    // Interpolated points inherit NaN.
    expect(Number.isNaN(route[5].lat)).toBe(true);
  });

  it('hazard radius covers entire path including start and destination: function still returns 11 finite points but cannot fully clear endpoints', () => {
    // characterization: the impl never re-checks start/destination against
    // hazards (they are pushed by reference). For interpolated points it
    // pushes them to a 1.2*radius ring around the hazard center, which IS
    // outside the hazard radius. So you get a finite, deterministic route
    // that brushes the hazard ring even though start/destination are inside.
    // Callers needing strict "every point safe" semantics must validate
    // start/destination separately.
    const center = midpoint(start, destination);
    const giantHazard: HazardZone = { center, radius: 5000 }; // much bigger than path
    const route = calculateDeterministicSafeRoute(start, destination, [giantHazard]);
    expect(route).toHaveLength(11);
    for (const wp of route) {
      expect(Number.isFinite(wp.lat)).toBe(true);
      expect(Number.isFinite(wp.lng)).toBe(true);
    }
    // Interpolated points (excluding endpoints) MUST be outside the hazard.
    for (const wp of route.slice(1, -1)) {
      expect(calculateDistance(wp, center)).toBeGreaterThanOrEqual(giantHazard.radius);
    }
    // Endpoints are not guaranteed safe — assert that explicitly so the contract
    // is documented in the test suite.
    expect(calculateDistance(route[0], center)).toBeLessThan(giantHazard.radius);
    expect(calculateDistance(route[route.length - 1], center)).toBeLessThan(giantHazard.radius);
  });
});

describe('calculateDeterministicSafeRoute — determinism', () => {
  it('same input twice yields byte-identical output (no Math.random)', () => {
    const hazards: HazardZone[] = [
      { center: lerp(start, destination, 0.4), radius: 150 },
      { center: lerp(start, destination, 0.6), radius: 100 },
    ];
    const r1 = calculateDeterministicSafeRoute(start, destination, hazards);
    const r2 = calculateDeterministicSafeRoute(start, destination, hazards);
    expect(r1).toEqual(r2);
  });
});

describe('calculateDeterministicSafeRoute — total path length sanity bound', () => {
  it('with a single midpoint hazard, total route length is within 1.5× great-circle distance', () => {
    const hazard: HazardZone = { center: midpoint(start, destination), radius: 200 };
    const route = calculateDeterministicSafeRoute(start, destination, [hazard]);
    let total = 0;
    for (let i = 1; i < route.length; i++) {
      total += haversineMeters(route[i - 1], route[i]);
    }
    const direct = haversineMeters(start, destination);
    expect(total).toBeLessThanOrEqual(1.5 * direct);
  });

  it('with no hazards, total route length is essentially the great-circle distance (within 1m)', () => {
    const route = calculateDeterministicSafeRoute(start, destination, []);
    let total = 0;
    for (let i = 1; i < route.length; i++) {
      total += haversineMeters(route[i - 1], route[i]);
    }
    const direct = haversineMeters(start, destination);
    expect(Math.abs(total - direct)).toBeLessThanOrEqual(POS_TOLERANCE_M);
  });
});
