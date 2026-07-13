// Sprint 28 Bucket B1 — Regulatory registry tests.

import { describe, it, expect } from 'vitest';
import {
  getActiveJurisdictions,
  getReferencesForControl,
  resolveControl,
  cite,
  listControls,
  assertTenantHasJurisdiction,
} from './registry.js';
import { ISO_45001_CONTROLS } from './iso45001.js';

describe('getActiveJurisdictions', () => {
  it('always includes ISO-45001 even with empty context', () => {
    expect(getActiveJurisdictions({})).toEqual(['ISO-45001']);
  });

  it('resolves Chile alpha-2 to CL', () => {
    expect(getActiveJurisdictions({ country: 'CL' })).toEqual(['ISO-45001', 'CL']);
  });

  it('resolves US/USA aliases to US-OSHA', () => {
    expect(getActiveJurisdictions({ country: 'US' })).toEqual(['ISO-45001', 'US-OSHA']);
    expect(getActiveJurisdictions({ country: 'USA' })).toEqual(['ISO-45001', 'US-OSHA']);
  });

  it('collapses an EU member country to EU jurisdiction', () => {
    expect(getActiveJurisdictions({ country: 'ES' })).toEqual(['ISO-45001', 'EU']);
    expect(getActiveJurisdictions({ country: 'DE' })).toEqual(['ISO-45001', 'EU']);
  });

  it('falls back to ISO-45001 only when country is unknown', () => {
    expect(getActiveJurisdictions({ country: 'ZZ' })).toEqual(['ISO-45001']);
  });

  it('uses dataResidency when country is missing', () => {
    expect(getActiveJurisdictions({ dataResidency: 'BR' })).toEqual(['ISO-45001', 'BR']);
  });

  it('is case insensitive', () => {
    expect(getActiveJurisdictions({ country: 'mx' })).toEqual(['ISO-45001', 'MX']);
  });
});

describe('getReferencesForControl', () => {
  it('returns ISO baseline only when no country adapter applies', () => {
    const refs = getReferencesForControl('WORKER_PARTICIPATION', ['ISO-45001']);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((r) => r.jurisdiction === 'ISO-45001')).toBe(true);
  });

  it('combines ISO baseline with Chile DS 44 (ex DS 54) for participation', () => {
    const refs = getReferencesForControl('WORKER_PARTICIPATION', ['ISO-45001', 'CL']);
    const codes = refs.map((r) => r.code);
    expect(codes).toContain('ISO-45001:5.4');
    expect(codes).toContain('DS-44');
  });

  it('returns empty array for unknown control id', () => {
    expect(getReferencesForControl('NOT_A_REAL_CONTROL', ['ISO-45001', 'CL'])).toEqual([]);
  });

  it('sorts ISO first, then alphabetical by jurisdiction', () => {
    const refs = getReferencesForControl('OPERATIONAL_CONTROL', [
      'ISO-45001',
      'US-OSHA',
      'CL',
      'BR',
      'MX',
      'EU',
    ]);
    expect(refs[0].jurisdiction).toBe('ISO-45001');
    const rest = refs.slice(1).map((r) => r.jurisdiction);
    const sortedRest = rest.slice().sort((a, b) => a.localeCompare(b));
    expect(rest).toEqual(sortedRest);
  });

  it('returns Brasil NR-7 for performance monitoring', () => {
    const refs = getReferencesForControl('PERFORMANCE_MONITORING', ['ISO-45001', 'BR']);
    const codes = refs.map((r) => r.code);
    expect(codes).toContain('NR-7');
  });
});

describe('resolveControl', () => {
  it('returns control with merged references', () => {
    const c = resolveControl('OPERATIONAL_CONTROL', ['ISO-45001', 'CL']);
    expect(c).toBeDefined();
    expect(c?.iso45001Clause).toBe('8.1');
    expect(c?.references.some((r) => r.code === 'DS-594')).toBe(true);
  });

  it('returns undefined for unknown control id', () => {
    expect(resolveControl('NOPE', ['ISO-45001'])).toBeUndefined();
  });
});

describe('cite', () => {
  it('produces consistent short-form citations', () => {
    const out = cite('WORKER_PARTICIPATION', { jurisdictions: ['ISO-45001', 'CL'] });
    expect(out).toContain('ISO-45001:5.4');
    expect(out.some((s) => s.includes('DS-44') && s.includes('Chile'))).toBe(true);
  });

  it('uses long format when requested', () => {
    const out = cite('OPERATIONAL_CONTROL', {
      jurisdictions: ['ISO-45001', 'US-OSHA'],
      format: 'long',
    });
    expect(out.every((s) => s.includes(' — '))).toBe(true);
    expect(out.some((s) => s.includes('US-OSHA'))).toBe(true);
  });

  it('returns empty array for unknown control', () => {
    expect(cite('UNKNOWN', { jurisdictions: ['ISO-45001'] })).toEqual([]);
  });
});

// Sprint 31 OO — Tenant-tier gate for cross-jurisdiction citation.
describe('assertTenantHasJurisdiction (Sprint 31 OO)', () => {
  it('allows ISO-45001 baseline for any tier', () => {
    expect(
      assertTenantHasJurisdiction({ country: 'CL' }, 'ISO-45001', 'gratis'),
    ).toBe(true);
  });

  it('allows native country jurisdiction on nacional tier', () => {
    expect(
      assertTenantHasJurisdiction({ country: 'CL' }, 'CL', 'titanio'),
    ).toBe(true);
  });

  it('denies non-native country on nacional tier (Chilean tenant cannot cite Brazil regs)', () => {
    expect(
      assertTenantHasJurisdiction({ country: 'CL' }, 'BR', 'titanio'),
    ).toBe(false);
  });

  it('allows non-native country on diamante when declared in extraCountries', () => {
    expect(
      assertTenantHasJurisdiction(
        { country: 'CL', extraCountries: ['BR', 'US'] },
        'BR',
        'diamante',
      ),
    ).toBe(true);
    expect(
      assertTenantHasJurisdiction(
        { country: 'CL', extraCountries: ['BR', 'US'] },
        'US-OSHA',
        'diamante',
      ),
    ).toBe(true);
  });

  it('denies undeclared jurisdiction even on diamante (must be in extraCountries)', () => {
    expect(
      assertTenantHasJurisdiction(
        { country: 'CL', extraCountries: ['BR'] },
        'JP',
        'diamante',
      ),
    ).toBe(false);
  });

  it('getActiveJurisdictions respects tier limit (nacional ignores extraCountries)', () => {
    const active = getActiveJurisdictions(
      { country: 'CL', extraCountries: ['BR', 'US', 'EU'] },
      'titanio',
    );
    expect(active).toEqual(['ISO-45001', 'CL']);
  });

  it('getActiveJurisdictions for diamante expands with extraCountries', () => {
    const active = getActiveJurisdictions(
      { country: 'CL', extraCountries: ['BR', 'US', 'EU'] },
      'diamante',
    );
    expect(active).toContain('ISO-45001');
    expect(active).toContain('CL');
    expect(active).toContain('BR');
    expect(active).toContain('US-OSHA');
    expect(active).toContain('EU');
  });
});

describe('catalog integrity', () => {
  it('lists at least 10 ISO 45001 controls', () => {
    expect(listControls().length).toBeGreaterThanOrEqual(10);
  });

  it('every ISO control has at least one reference and an iso45001Clause', () => {
    for (const c of ISO_45001_CONTROLS) {
      expect(c.references.length).toBeGreaterThan(0);
      expect(c.iso45001Clause).toBeTruthy();
      expect(c.references[0].jurisdiction).toBe('ISO-45001');
    }
  });

  it('every control has a unique id', () => {
    const ids = ISO_45001_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
