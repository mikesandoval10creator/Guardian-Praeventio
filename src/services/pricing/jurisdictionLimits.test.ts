// Sprint 31 OO — jurisdictionLimits tests.

import { describe, it, expect } from 'vitest';
import {
  getMaxJurisdictionsForTier,
  assertJurisdictionLimit,
} from './jurisdictionLimits';

describe('getMaxJurisdictionsForTier', () => {
  it('returns 1 for nacional gratis tier', () => {
    expect(getMaxJurisdictionsForTier('gratis')).toBe(1);
  });

  it('returns 1 for premium nacional tiers (titanio, platino)', () => {
    expect(getMaxJurisdictionsForTier('titanio')).toBe(1);
    expect(getMaxJurisdictionsForTier('platino')).toBe(1);
  });

  it('returns Infinity for diamante (the multi-jurisdiction jewel)', () => {
    expect(getMaxJurisdictionsForTier('diamante')).toBe(Infinity);
  });

  it('returns 1 for oro as a default', () => {
    expect(getMaxJurisdictionsForTier('oro')).toBe(1);
  });
});

describe('assertJurisdictionLimit', () => {
  it('allows ISO-45001 alone for any tier (excluded from count)', () => {
    const r = assertJurisdictionLimit('gratis', ['ISO-45001']);
    expect(r.allowed).toBe(true);
    expect(r.countableCount).toBe(0);
  });

  it('allows ISO-45001 + 1 country jurisdiction for nacional tier', () => {
    const r = assertJurisdictionLimit('plata', ['ISO-45001', 'CL']);
    expect(r.allowed).toBe(true);
    expect(r.countableCount).toBe(1);
    expect(r.limit).toBe(1);
  });

  it('denies 2 country jurisdictions on nacional tier', () => {
    const r = assertJurisdictionLimit('titanio', ['ISO-45001', 'CL', 'BR']);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/diamante/);
    expect(r.countableCount).toBe(2);
    expect(r.limit).toBe(1);
  });

  it('allows multi-country on diamante (Infinity limit)', () => {
    const r = assertJurisdictionLimit('diamante', [
      'ISO-45001',
      'CL',
      'US-OSHA',
      'EU',
      'JP',
      'KR',
      'IN',
      'BR',
      'MX',
      'UK',
      'CA',
      'AU',
    ]);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(Infinity);
    expect(r.countableCount).toBe(11);
  });

  it('dedupes repeated jurisdictions before counting', () => {
    const r = assertJurisdictionLimit('titanio', [
      'ISO-45001',
      'CL',
      'CL',
      'CL',
    ]);
    expect(r.allowed).toBe(true);
    expect(r.countableCount).toBe(1);
  });

  it('handles empty list (only ISO baseline implied)', () => {
    const r = assertJurisdictionLimit('gratis', []);
    expect(r.allowed).toBe(true);
    expect(r.countableCount).toBe(0);
  });

  it('downgrade scenario: tenant on diamante with 4 countries → moving to titanio fails the assert', () => {
    const onGlobal = assertJurisdictionLimit('diamante', [
      'ISO-45001',
      'CL',
      'BR',
      'US-OSHA',
      'EU',
    ]);
    expect(onGlobal.allowed).toBe(true);

    const onNacional = assertJurisdictionLimit('titanio', [
      'ISO-45001',
      'CL',
      'BR',
      'US-OSHA',
      'EU',
    ]);
    expect(onNacional.allowed).toBe(false);
    expect(onNacional.countableCount).toBe(4);
    expect(onNacional.limit).toBe(1);
  });

  it('downgrade scenario where usage already fits target tier: allowed', () => {
    const r = assertJurisdictionLimit('plata', ['ISO-45001', 'CL']);
    expect(r.allowed).toBe(true);
  });
});
