// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { calculateDistance, calculateBearing, getCompassDirection } from './geo';

describe('calculateDistance', () => {
  it('Santiago to Buenos Aires is approximately 1100-1300 km', () => {
    const dist = calculateDistance(-33.45, -70.67, -34.6, -58.38);
    expect(dist).toBeGreaterThan(1100);
    expect(dist).toBeLessThan(1300);
  });

  it('same point to same point is 0', () => {
    expect(calculateDistance(-33.45, -70.67, -33.45, -70.67)).toBe(0);
  });
});

describe('calculateBearing', () => {
  it('due North returns ~0 or ~360', () => {
    const bearing = calculateBearing(0, 0, 1, 0);
    // atan2(sin(0)*cos(...),...) → 0°, normalized to 0
    expect(bearing).toBeCloseTo(0, 0);
  });

  it('due East returns ~90', () => {
    const bearing = calculateBearing(0, 0, 0, 1);
    expect(bearing).toBeCloseTo(90, 0);
  });

  it('due South returns ~180', () => {
    const bearing = calculateBearing(1, 0, 0, 0);
    expect(bearing).toBeCloseTo(180, 0);
  });
});

describe('getCompassDirection', () => {
  it('0° → N', () => {
    expect(getCompassDirection(0)).toBe('N');
  });

  it('90° → E', () => {
    expect(getCompassDirection(90)).toBe('E');
  });

  it('180° → S', () => {
    expect(getCompassDirection(180)).toBe('S');
  });

  it('270° → W', () => {
    expect(getCompassDirection(270)).toBe('W');
  });

  it('45° → NE', () => {
    expect(getCompassDirection(45)).toBe('NE');
  });

  it('22° → NNE (22/22.5 ≈ 0.978 → rounds to index 1)', () => {
    expect(getCompassDirection(22)).toBe('NNE');
  });
});
