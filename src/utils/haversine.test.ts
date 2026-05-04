// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { haversineMeters, boundingBox } from './haversine';

describe('haversineMeters', () => {
  it('returns 0 when both points are identical', () => {
    const p = { lat: -33.45, lng: -70.66 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it('matches the canonical Santiago→New York distance (~8250 km, ±50 km)', () => {
    // Santiago (-33.4489, -70.6693) — New York (40.7128, -74.0060).
    // Reference value (great-circle): ~8250 km; we accept ±50 km.
    const santiago = { lat: -33.4489, lng: -70.6693 };
    const newYork = { lat: 40.7128, lng: -74.006 };
    const meters = haversineMeters(santiago, newYork);
    expect(meters / 1000).toBeGreaterThan(8200);
    expect(meters / 1000).toBeLessThan(8300);
  });

  it('is symmetric (h(a,b) === h(b,a))', () => {
    const a = { lat: 10, lng: 20 };
    const b = { lat: -5, lng: 175 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('handles equator-crossing pairs without sign-error blowups', () => {
    // 1° latitude apart, straddling the equator. The arc should be
    // ~111.32 km regardless of direction.
    const north = { lat: 0.5, lng: 0 };
    const south = { lat: -0.5, lng: 0 };
    const meters = haversineMeters(north, south);
    expect(meters).toBeGreaterThan(111_000);
    expect(meters).toBeLessThan(111_700);
  });
});

describe('boundingBox', () => {
  it('returns a box containing the center', () => {
    const center = { lat: -33.45, lng: -70.66 };
    const box = boundingBox(center, 100);
    expect(center.lat).toBeGreaterThan(box.latMin);
    expect(center.lat).toBeLessThan(box.latMax);
    expect(center.lng).toBeGreaterThan(box.lngMin);
    expect(center.lng).toBeLessThan(box.lngMax);
  });

  it('grows the longitude delta at high latitudes (cos correction)', () => {
    const equator = boundingBox({ lat: 0, lng: 0 }, 1000);
    const polar = boundingBox({ lat: 80, lng: 0 }, 1000);
    const equatorWidth = equator.lngMax - equator.lngMin;
    const polarWidth = polar.lngMax - polar.lngMin;
    // At lat=80°, cos≈0.174, so lngDelta should be ~5.76× the equator's.
    expect(polarWidth).toBeGreaterThan(equatorWidth * 4);
  });
});
