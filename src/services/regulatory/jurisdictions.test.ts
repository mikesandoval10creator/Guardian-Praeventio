// Sprint 29 Bucket EE — Tests UK/CA/AU jurisdictions.

import { describe, it, expect } from 'vitest';
import {
  getActiveJurisdictions,
  getReferencesForControl,
  cite,
  resolveControl,
} from './registry.js';
import { UK_REFERENCES } from './jurisdictions/uk.js';
import { CA_REFERENCES } from './jurisdictions/ca.js';
import { AU_REFERENCES } from './jurisdictions/au.js';
import { ISO_45001_BY_ID } from './iso45001.js';

const ISO_CONTROL_IDS = Object.keys(ISO_45001_BY_ID);

function expectAdapterShape(table: Record<string, unknown[]>, jurisdiction: 'UK' | 'CA' | 'AU') {
  // Cada control referenciado debe existir en el catálogo ISO 45001.
  for (const controlId of Object.keys(table)) {
    expect(ISO_CONTROL_IDS).toContain(controlId);
  }
  // Cada referencia tiene los campos requeridos y la jurisdicción correcta.
  for (const refs of Object.values(table)) {
    expect(Array.isArray(refs)).toBe(true);
    for (const r of refs as Array<{ code: string; title: string; jurisdiction: string; scope: string }>) {
      expect(r.code).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.scope).toBeTruthy();
      expect(r.jurisdiction).toBe(jurisdiction);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// UK
// ───────────────────────────────────────────────────────────────────────

describe('UK jurisdiction (Sprint 29 EE)', () => {
  it('country alias GB resolves to UK', () => {
    expect(getActiveJurisdictions({ country: 'GB' })).toEqual(['ISO-45001', 'UK']);
  });

  it('country alias UK / United-Kingdom resolves to UK', () => {
    expect(getActiveJurisdictions({ country: 'UK' })).toEqual(['ISO-45001', 'UK']);
    expect(getActiveJurisdictions({ country: 'united-kingdom' })).toEqual(['ISO-45001', 'UK']);
  });

  it('every UK reference has a valid shape and points to a real ISO control', () => {
    expectAdapterShape(UK_REFERENCES as Record<string, unknown[]>, 'UK');
  });

  it('exposes HSWA 1974 + RIDDOR 2013 + COSHH + PPER + CDM', () => {
    const allCodes = Object.values(UK_REFERENCES).flat().map((r) => r.code);
    expect(allCodes).toContain('HSWA-1974');
    expect(allCodes).toContain('RIDDOR-2013');
    expect(allCodes).toContain('COSHH-2002');
    expect(allCodes).toContain('PPER-2022');
    expect(allCodes).toContain('CDM-2015');
  });

  it('combines ISO baseline + UK refs for OPERATIONAL_CONTROL', () => {
    const refs = getReferencesForControl('OPERATIONAL_CONTROL', ['ISO-45001', 'UK']);
    const codes = refs.map((r) => r.code);
    expect(codes).toContain('ISO-45001:8.1');
    expect(codes).toContain('PPER-2022');
    expect(codes).toContain('CDM-2015');
  });

  it('cite() formats UK references with (UK) label', () => {
    const out = cite('NONCONFORMITY_CORRECTIVE_ACTION', { jurisdictions: ['ISO-45001', 'UK'] });
    expect(out.some((s) => s.includes('RIDDOR-2013') && s.includes('UK'))).toBe(true);
  });

  it('maps ≥5 ISO controls to UK regulations', () => {
    expect(Object.keys(UK_REFERENCES).length).toBeGreaterThanOrEqual(5);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Canadá
// ───────────────────────────────────────────────────────────────────────

describe('CA jurisdiction (Sprint 29 EE)', () => {
  it('country aliases CA / CAN / Canada resolve to CA', () => {
    expect(getActiveJurisdictions({ country: 'CA' })).toEqual(['ISO-45001', 'CA']);
    expect(getActiveJurisdictions({ country: 'CAN' })).toEqual(['ISO-45001', 'CA']);
    expect(getActiveJurisdictions({ country: 'canada' })).toEqual(['ISO-45001', 'CA']);
  });

  it('every CA reference has a valid shape and points to a real ISO control', () => {
    expectAdapterShape(CA_REFERENCES as Record<string, unknown[]>, 'CA');
  });

  it('exposes WHMIS 2015 + COHSR + CSA Z1000 + Ontario OHSA', () => {
    const allCodes = Object.values(CA_REFERENCES).flat().map((r) => r.code);
    expect(allCodes).toContain('WHMIS-2015');
    expect(allCodes.some((c) => c.startsWith('COHSR-'))).toBe(true);
    expect(allCodes).toContain('CSA-Z1000');
    expect(allCodes).toContain('ON-OHSA-s.9');
  });

  it('resolveControl merges Canada refs with ISO baseline', () => {
    const c = resolveControl('HAZARD_IDENTIFICATION', ['ISO-45001', 'CA']);
    expect(c).toBeDefined();
    const codes = c!.references.map((r) => r.code);
    expect(codes).toContain('ISO-45001:6.1.2');
    expect(codes).toContain('WHMIS-2015');
  });

  it('cite() emits Canadá label', () => {
    const out = cite('LEADERSHIP_COMMITMENT', { jurisdictions: ['ISO-45001', 'CA'] });
    expect(out.some((s) => s.includes('Canadá'))).toBe(true);
  });

  it('maps ≥5 ISO controls to Canadian regulations', () => {
    expect(Object.keys(CA_REFERENCES).length).toBeGreaterThanOrEqual(5);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Australia
// ───────────────────────────────────────────────────────────────────────

describe('AU jurisdiction (Sprint 29 EE)', () => {
  it('country aliases AU / AUS / Australia resolve to AU', () => {
    expect(getActiveJurisdictions({ country: 'AU' })).toEqual(['ISO-45001', 'AU']);
    expect(getActiveJurisdictions({ country: 'AUS' })).toEqual(['ISO-45001', 'AU']);
    expect(getActiveJurisdictions({ country: 'australia' })).toEqual(['ISO-45001', 'AU']);
  });

  it('every AU reference has a valid shape and points to a real ISO control', () => {
    expectAdapterShape(AU_REFERENCES as Record<string, unknown[]>, 'AU');
  });

  it('exposes WHS Act 2011 + WHS Regulations + Safe Work Australia codes of practice', () => {
    const allCodes = Object.values(AU_REFERENCES).flat().map((r) => r.code);
    expect(allCodes).toContain('WHS-Act-2011');
    expect(allCodes.some((c) => c.startsWith('WHS-Reg-2011'))).toBe(true);
    expect(allCodes.some((c) => c.startsWith('COP-'))).toBe(true);
  });

  it('combines ISO + AU for EMERGENCY_PREPAREDNESS', () => {
    const refs = getReferencesForControl('EMERGENCY_PREPAREDNESS', ['ISO-45001', 'AU']);
    const codes = refs.map((r) => r.code);
    expect(codes).toContain('ISO-45001:8.2');
    expect(codes).toContain('WHS-Reg-2011-r.43');
  });

  it('cite() emits Australia label', () => {
    const out = cite('WORKER_PARTICIPATION', { jurisdictions: ['ISO-45001', 'AU'] });
    expect(out.some((s) => s.includes('Australia'))).toBe(true);
  });

  it('maps ≥5 ISO controls to Australian regulations', () => {
    expect(Object.keys(AU_REFERENCES).length).toBeGreaterThanOrEqual(5);
  });

  it('mentions Victoria OHS Act 2004 in scope (state-specific harmonization note)', () => {
    const allScopes = Object.values(AU_REFERENCES).flat().map((r) => r.scope).join(' ');
    expect(allScopes).toMatch(/Victoria/i);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Cross-cutting integration
// ───────────────────────────────────────────────────────────────────────

describe('Sprint 29 EE — cross-jurisdiction integration', () => {
  it('all 3 new jurisdictions can coexist in a single control resolution', () => {
    const refs = getReferencesForControl('OPERATIONAL_CONTROL', [
      'ISO-45001',
      'UK',
      'CA',
      'AU',
    ]);
    const jurisdictions = new Set(refs.map((r) => r.jurisdiction));
    expect(jurisdictions.has('ISO-45001')).toBe(true);
    expect(jurisdictions.has('UK')).toBe(true);
    expect(jurisdictions.has('CA')).toBe(true);
    expect(jurisdictions.has('AU')).toBe(true);
  });

  it('sortReferences keeps ISO first, then alphabetical (AU < CA < UK)', () => {
    const refs = getReferencesForControl('OPERATIONAL_CONTROL', [
      'ISO-45001',
      'UK',
      'CA',
      'AU',
    ]);
    expect(refs[0].jurisdiction).toBe('ISO-45001');
    const rest = refs.slice(1).map((r) => r.jurisdiction);
    const sortedRest = rest.slice().sort((a, b) => a.localeCompare(b));
    expect(rest).toEqual(sortedRest);
  });

  it('unknown country still falls back to ISO-45001 only', () => {
    expect(getActiveJurisdictions({ country: 'XX' })).toEqual(['ISO-45001']);
  });
});
