import { describe, it, expect } from 'vitest';
import { legalFormValue, MISSING_LEGAL_VALUE } from './legalFormValue';

describe('legalFormValue — official compliance forms never show fabricated data', () => {
  it('returns the real value (not missing) when present', () => {
    expect(legalFormValue('11.111.111-1')).toEqual({ text: '11.111.111-1', missing: false });
  });

  it('trims surrounding whitespace from a real value', () => {
    expect(legalFormValue('  Juan Pérez  ')).toEqual({ text: 'Juan Pérez', missing: false });
  });

  it('flags absent/blank values as missing with the honest marker', () => {
    for (const empty of [undefined, null, '', '   ']) {
      const r = legalFormValue(empty);
      expect(r.missing).toBe(true);
      expect(r.text).toBe(MISSING_LEGAL_VALUE);
    }
  });

  it('NEVER returns the legacy fabricated RUT (regression guard)', () => {
    // The DIAT/DIEP form used to fall back to a valid-format fake RUT.
    expect(legalFormValue(undefined).text).not.toBe('12.345.678-9');
    // Nor any value shaped like a Chilean RUT for a missing input.
    expect(legalFormValue('').text).not.toMatch(/^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/);
  });
});
