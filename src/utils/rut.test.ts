// Praeventio Guard — Chilean RUT validator unit tests.
//
// Round 14 (A2 audit) — Several modules accepted user-supplied RUTs without
// validating them against the SII modulo-11 verifier digit, allowing
// malformed inputs to land in `workers`/`empresa` docs and break downstream
// reports (DS 54, Mutual Ley 16.744 emissions). This test suite locks in the
// canonical algorithm:
//
//   • clean   — strip dots/hyphens/whitespace, uppercase the verifier
//   • compute — modulo 11 with weights [2,3,4,5,6,7] cycled, sum mod 11,
//               DV = 11 - (sum mod 11), where 10 → 'K' and 11 → '0'
//   • validate — round-trip body+DV against the computed DV
//   • format  — insert thousands dots and the DV hyphen ("12.345.678-9")
//
// All functions are pure: no Firestore, no clock, no network. This is what
// makes them trivially testable AND safe to call from any layer.

import { describe, it, expect } from 'vitest';
import { cleanRut, computeRutDv, isValidRut, formatRut } from './rut';

describe('cleanRut', () => {
  it('strips dots, hyphens, and whitespace', () => {
    expect(cleanRut(' 12.345.678-5 ')).toBe('123456785');
  });

  it('uppercases the verifier digit (k → K)', () => {
    expect(cleanRut('15.123.456-k')).toBe('15123456K');
  });

  it('returns empty string for empty input', () => {
    expect(cleanRut('')).toBe('');
  });

  it('preserves order — body then DV', () => {
    expect(cleanRut('1-9')).toBe('19');
  });
});

describe('computeRutDv', () => {
  // Known SII test RUTs:
  //   12345678 → DV 5
  //   78231119 → DV 0  (Praeventio's emisor RUT in the wider context)
  //   11111111 → DV 1
  //   22222222 → DV 2
  //   1        → DV 9  (single-digit body)

  it('computes DV "5" for body "12345678"', () => {
    expect(computeRutDv('12345678')).toBe('5');
  });

  it('computes DV "0" for body "78231119"', () => {
    expect(computeRutDv('78231119')).toBe('0');
  });

  it('computes DV "9" for body "1" (single-digit)', () => {
    expect(computeRutDv('1')).toBe('9');
  });

  it('computes DV "K" when modulo gives 10', () => {
    // Body "23" yields DV K — smallest 2-digit body that hits the K branch
    // (mod-11 sum of (3*2 + 2*3) = 12 → 12 mod 11 = 1 → 11-1 = 10 → "K").
    expect(computeRutDv('23')).toBe('K');
  });

  it('returns empty string for empty body (defensive)', () => {
    expect(computeRutDv('')).toBe('');
  });
});

describe('isValidRut', () => {
  it('accepts a well-formed RUT with correct DV', () => {
    expect(isValidRut('12.345.678-5')).toBe(true);
  });

  it('accepts a RUT without dots or hyphens (just digits + DV)', () => {
    expect(isValidRut('123456785')).toBe(true);
  });

  it('accepts the lowercase k verifier', () => {
    // Body "23" → K. Test both shapes (raw + dotted) to lock in case-folding.
    expect(isValidRut('23-k')).toBe(true);
    expect(isValidRut('23-K')).toBe(true);
  });

  it('rejects a RUT with the wrong DV', () => {
    expect(isValidRut('12.345.678-9')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isValidRut('')).toBe(false);
  });

  it('rejects an over-long body (>9 digits)', () => {
    expect(isValidRut('1234567890-5')).toBe(false);
  });

  it('rejects body with non-digit characters', () => {
    expect(isValidRut('12.34A.678-5')).toBe(false);
  });

  it('rejects a RUT with no DV', () => {
    expect(isValidRut('12345678')).toBe(false);
  });
});

describe('formatRut', () => {
  it('formats "123456785" as "12.345.678-5"', () => {
    expect(formatRut('123456785')).toBe('12.345.678-5');
  });

  it('formats already-formatted input idempotently', () => {
    expect(formatRut('12.345.678-5')).toBe('12.345.678-5');
  });

  it('formats short body without padding ("1-9")', () => {
    expect(formatRut('19')).toBe('1-9');
  });

  it('formats with K verifier', () => {
    expect(formatRut('23K')).toBe('23-K');
  });
});

describe('round-trips', () => {
  it('formatRut(cleanRut(x)) is stable for valid input', () => {
    const formatted = formatRut(cleanRut('  12.345.678-5  '));
    expect(formatted).toBe('12.345.678-5');
    expect(isValidRut(formatted)).toBe(true);
  });
});
