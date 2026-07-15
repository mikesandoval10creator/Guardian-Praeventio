import { describe, expect, it } from 'vitest';
import { formatChileDate, formatChileDateTime, stablePdfFileId } from './deterministicPdf.js';

describe('deterministic PDF helpers', () => {
  it('uses a stable trailer identifier', () => {
    expect(stablePdfFileId('tenant-1/form-1')).toBe(stablePdfFileId('tenant-1/form-1'));
    expect(stablePdfFileId('tenant-1/form-1')).not.toBe(stablePdfFileId('tenant-1/form-2'));
  });

  it('formats legal dates in the explicit Chile timezone', () => {
    const instant = '2026-07-15T02:30:00.000Z';
    expect(formatChileDateTime(instant)).toBe('14-07-2026, 22:30:00');
    expect(formatChileDate(instant)).toBe('15-07-2026');
    expect(formatChileDate('2026-01-01')).toBe('01-01-2026');
  });

  it('rejects invalid dates instead of rendering environment-dependent text', () => {
    expect(() => formatChileDateTime('invalid')).toThrow(TypeError);
    expect(() => formatChileDate('invalid')).toThrow(TypeError);
  });
});
