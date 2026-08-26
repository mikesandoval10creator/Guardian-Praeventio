import { describe, it, expect } from 'vitest';
import { formatClp, ClpFormatError } from './formatClp';

describe('formatClp — canonical CLP formatter', () => {
  // [Hy3-audit 3c4aa66d-73fe-8104-bf91-fac11385c028 2026-08-25]
  // Pins the rule that all 6 ad-hoc copies of formatClp across the
  // codebase were drifting on. A drift in any of the rule points
  // here would have produced silently inconsistent displays (e.g.
  // "$1.234,56" with comma decimal, or "$1,234" with comma group)
  // and a consumer bug report several weeks later.

  describe('rule: thousands grouped with `.` (period), sign before `$`', () => {
    it('formats 0', () => expect(formatClp(0)).toBe('$0'));
    it('formats 1', () => expect(formatClp(1)).toBe('$1'));
    it('formats 1234', () => expect(formatClp(1234)).toBe('$1.234'));
    it('formats 1234567', () => expect(formatClp(1234567)).toBe('$1.234.567'));
    it('formats negative -1234567 with sign before `$`', () =>
      expect(formatClp(-1234567)).toBe('-$1.234.567'));
    it('formats negative -1', () => expect(formatClp(-1)).toBe('-$1'));
    it('rounds 0.4 down', () => expect(formatClp(0.4)).toBe('$0'));
    it('rounds 0.5 up', () => expect(formatClp(0.5)).toBe('$1'));
    it('rounds 1.5 to even (banker? no — Math.round rounds 1.5 → 2)', () =>
      expect(formatClp(1.5)).toBe('$2'));
  });

  describe('rule: reject non-finite inputs with ClpFormatError', () => {
    it('rejects NaN', () =>
      expect(() => formatClp(Number.NaN)).toThrow(ClpFormatError));
    it('rejects Infinity', () =>
      expect(() => formatClp(Number.POSITIVE_INFINITY)).toThrow(ClpFormatError));
    it('rejects -Infinity', () =>
      expect(() => formatClp(Number.NEGATIVE_INFINITY)).toThrow(ClpFormatError));
    it('error code is invalid_clp_amount', () => {
      try {
        formatClp(Number.NaN);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as ClpFormatError).code).toBe('invalid_clp_amount');
      }
    });
  });

  describe('rule: very large amounts', () => {
    it('formats 1e15 (quadrillion range)', () =>
      expect(formatClp(1e15)).toBe('$1.000.000.000.000.000'));
  });
});