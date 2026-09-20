// Praeventio Guard \u2014 unit tests for the Bernoulli finite-input helpers.

import { describe, it, expect } from 'vitest';
import { isFiniteNumber, assertFinite } from './finiteGuards.js';

describe('isFiniteNumber', () => {
  it('returns true for ordinary finite numbers', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
    expect(isFiniteNumber(3.14)).toBe(true);
    expect(isFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('returns false for NaN, +Infinity, -Infinity', () => {
    // [Hy3-audit] Adversarial probes \u2014 these are the inputs that slip
    // past `<= 0` checks and reach the physics formulas. The fix
    // rejects them BEFORE the math runs.
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
  });

  it('returns false for non-number types', () => {
    expect(isFiniteNumber('1')).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber({})).toBe(false);
    expect(isFiniteNumber([])).toBe(false);
    expect(isFiniteNumber(true)).toBe(false);
  });
});

describe('assertFinite', () => {
  it('returns void for finite numbers (no throw)', () => {
    expect(() => assertFinite(0, 'x')).not.toThrow();
    expect(() => assertFinite(-1.5, 'x')).not.toThrow();
  });

  it('throws RangeError with a labelled message for NaN', () => {
    expect(() => assertFinite(NaN, 'weather.windKmh')).toThrow(RangeError);
    expect(() => assertFinite(NaN, 'weather.windKmh')).toThrow(/weather\.windKmh/);
    expect(() => assertFinite(NaN, 'weather.windKmh')).toThrow(/NaN/);
  });

  it('throws RangeError with a labelled message for +Infinity', () => {
    expect(() => assertFinite(Infinity, 'q.b')).toThrow(/q\.b/);
    expect(() => assertFinite(Infinity, 'q.b')).toThrow(/\+Infinity/);
  });

  it('throws RangeError with a labelled message for -Infinity', () => {
    expect(() => assertFinite(-Infinity, 'cp')).toThrow(/cp/);
    expect(() => assertFinite(-Infinity, 'cp')).toThrow(/-Infinity/);
  });

  it('throws RangeError for non-number types (covers defense-in-depth)', () => {
    expect(() => assertFinite(null as unknown as number, 'x')).toThrow(RangeError);
    expect(() => assertFinite('1' as unknown as number, 'x')).toThrow(RangeError);
  });
});
