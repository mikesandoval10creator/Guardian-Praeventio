import { describe, it, expect } from 'vitest';
import { deriveLegalStatusAlert } from './useLegalStatusAlert';

describe('deriveLegalStatusAlert — dotación threshold derivation (CL pack)', () => {
  it('returns null when no project is selected', () => {
    expect(deriveLegalStatusAlert(null)).toBeNull();
    expect(deriveLegalStatusAlert(undefined)).toBeNull();
  });

  it('returns null below the CPHS threshold (24)', () => {
    expect(deriveLegalStatusAlert({ id: 'p1', workersCount: 24 })).toBeNull();
  });

  it('returns a CPHS advisory at exactly 25', () => {
    const a = deriveLegalStatusAlert({ id: 'p1', workersCount: 25 });
    expect(a).toEqual({ alertType: 'cphs', projectId: 'p1', workersCount: 25, threshold: 25 });
  });

  it('stays on CPHS at 99 (below the DPRP threshold)', () => {
    expect(deriveLegalStatusAlert({ id: 'p1', workersCount: 99 })?.alertType).toBe('cphs');
  });

  it('escalates to DPRP at exactly 100 (supersedes CPHS)', () => {
    const a = deriveLegalStatusAlert({ id: 'p1', workersCount: 100 });
    expect(a).toEqual({ alertType: 'dprp', projectId: 'p1', workersCount: 100, threshold: 100 });
  });

  it('stays on DPRP well above the threshold (500)', () => {
    expect(deriveLegalStatusAlert({ id: 'p1', workersCount: 500 })?.alertType).toBe('dprp');
  });

  it('returns null for a non-CL project even above the threshold', () => {
    expect(deriveLegalStatusAlert({ id: 'p1', workersCount: 300, country: 'AR' })).toBeNull();
  });

  it('treats an absent country as CL (platform default) and still advises', () => {
    expect(deriveLegalStatusAlert({ id: 'p1', workersCount: 40 })?.alertType).toBe('cphs');
  });

  it('returns null when headcount is missing, zero, or not finite', () => {
    expect(deriveLegalStatusAlert({ id: 'p1' })).toBeNull();
    expect(deriveLegalStatusAlert({ id: 'p1', workersCount: 0 })).toBeNull();
    expect(deriveLegalStatusAlert({ id: 'p1', workersCount: Number.NaN })).toBeNull();
  });
});
