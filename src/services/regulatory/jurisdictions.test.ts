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
import { JP_REFERENCES } from './jurisdictions/jp.js';
import { KR_REFERENCES } from './jurisdictions/kr.js';
import { IN_REFERENCES } from './jurisdictions/in.js';
import { CN_REFERENCES } from './jurisdictions/cn.js';
import { TW_REFERENCES } from './jurisdictions/tw.js';
import { RU_REFERENCES } from './jurisdictions/ru.js';
import { ISO_45001_BY_ID } from './iso45001.js';

const ISO_CONTROL_IDS = Object.keys(ISO_45001_BY_ID);

function expectAdapterShape(
  table: Record<string, unknown[]>,
  jurisdiction: 'UK' | 'CA' | 'AU' | 'JP' | 'KR' | 'IN' | 'CN' | 'TW' | 'RU',
) {
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

// ───────────────────────────────────────────────────────────────────────
// Sprint 31 NN — Asia-Pacific tier (Japan, Korea, India)
// ───────────────────────────────────────────────────────────────────────

describe('JP jurisdiction (Sprint 31 NN)', () => {
  it('country aliases JP / JPN / Japan resolve to JP', () => {
    expect(getActiveJurisdictions({ country: 'JP' })).toEqual(['ISO-45001', 'JP']);
    expect(getActiveJurisdictions({ country: 'JPN' })).toEqual(['ISO-45001', 'JP']);
    expect(getActiveJurisdictions({ country: 'japan' })).toEqual(['ISO-45001', 'JP']);
  });

  it('every JP reference has a valid shape and points to a real ISO control', () => {
    expectAdapterShape(JP_REFERENCES as Record<string, unknown[]>, 'JP');
  });

  it('exposes ISHA 1972 + JIS Z 45001 + Stress Check Program', () => {
    const allCodes = Object.values(JP_REFERENCES).flat().map((r) => r.code);
    expect(allCodes).toContain('ISHA-1972');
    expect(allCodes).toContain('JIS-Z-45001');
    expect(allCodes).toContain('ISHA-1972-art.66-10'); // Stress Check
    expect(allCodes).toContain('ISH-Reg-Ordinance');
  });

  it('Stress Check Program scope mentions umbral de 50 trabajadores', () => {
    const refs = JP_REFERENCES.PERFORMANCE_MONITORING ?? [];
    const stress = refs.find((r) => r.code === 'ISHA-1972-art.66-10');
    expect(stress).toBeDefined();
    expect(stress!.scope).toMatch(/50/);
  });

  it('combines ISO baseline + JP refs for HAZARD_IDENTIFICATION', () => {
    const refs = getReferencesForControl('HAZARD_IDENTIFICATION', ['ISO-45001', 'JP']);
    const codes = refs.map((r) => r.code);
    expect(codes).toContain('ISO-45001:6.1.2');
    expect(codes).toContain('ISHA-1972-art.28-2');
  });

  it('cite() emits Japón label', () => {
    const out = cite('LEADERSHIP_COMMITMENT', { jurisdictions: ['ISO-45001', 'JP'] });
    expect(out.some((s) => s.includes('Japón'))).toBe(true);
  });

  it('maps ≥6 ISO controls to Japanese regulations', () => {
    expect(Object.keys(JP_REFERENCES).length).toBeGreaterThanOrEqual(6);
  });
});

describe('KR jurisdiction (Sprint 31 NN)', () => {
  it('country aliases KR / KOR / Korea / South-Korea resolve to KR', () => {
    expect(getActiveJurisdictions({ country: 'KR' })).toEqual(['ISO-45001', 'KR']);
    expect(getActiveJurisdictions({ country: 'KOR' })).toEqual(['ISO-45001', 'KR']);
    expect(getActiveJurisdictions({ country: 'korea' })).toEqual(['ISO-45001', 'KR']);
    expect(getActiveJurisdictions({ country: 'south-korea' })).toEqual(['ISO-45001', 'KR']);
  });

  it('every KR reference has a valid shape and points to a real ISO control', () => {
    expectAdapterShape(KR_REFERENCES as Record<string, unknown[]>, 'KR');
  });

  it('exposes OSHA-K + KOSHA-MS + Serious Accidents Punishment Act 2022', () => {
    const allCodes = Object.values(KR_REFERENCES).flat().map((r) => r.code);
    expect(allCodes).toContain('OSHA-K-2019');
    expect(allCodes).toContain('KOSHA-MS');
    expect(allCodes).toContain('SAPA-2022');
  });

  it('resolveControl merges Korea refs with ISO baseline', () => {
    const c = resolveControl('OPERATIONAL_CONTROL', ['ISO-45001', 'KR']);
    expect(c).toBeDefined();
    const codes = c!.references.map((r) => r.code);
    expect(codes).toContain('ISO-45001:8.1');
    expect(codes).toContain('KOSHA-MS');
  });

  it('cite() emits Corea label', () => {
    const out = cite('LEADERSHIP_COMMITMENT', { jurisdictions: ['ISO-45001', 'KR'] });
    expect(out.some((s) => s.includes('Corea'))).toBe(true);
  });

  it('maps ≥6 ISO controls to Korean regulations', () => {
    expect(Object.keys(KR_REFERENCES).length).toBeGreaterThanOrEqual(6);
  });
});

describe('IN jurisdiction (Sprint 31 NN)', () => {
  it('country aliases IN / IND / India resolve to IN', () => {
    expect(getActiveJurisdictions({ country: 'IN' })).toEqual(['ISO-45001', 'IN']);
    expect(getActiveJurisdictions({ country: 'IND' })).toEqual(['ISO-45001', 'IN']);
    expect(getActiveJurisdictions({ country: 'india' })).toEqual(['ISO-45001', 'IN']);
  });

  it('every IN reference has a valid shape and points to a real ISO control', () => {
    expectAdapterShape(IN_REFERENCES as Record<string, unknown[]>, 'IN');
  });

  it('exposes Factories Act 1948 + OSH Code 2020 + BOCW 1996 + NSC', () => {
    const allCodes = Object.values(IN_REFERENCES).flat().map((r) => r.code);
    expect(allCodes).toContain('Factories-Act-1948');
    expect(allCodes).toContain('OSH-Code-2020');
    expect(allCodes).toContain('BOCW-Act-1996');
    expect(allCodes.some((c) => c.startsWith('NSC-'))).toBe(true);
  });

  it('combines ISO + IN for OPERATIONAL_CONTROL with construction coverage', () => {
    const refs = getReferencesForControl('OPERATIONAL_CONTROL', ['ISO-45001', 'IN']);
    const codes = refs.map((r) => r.code);
    expect(codes).toContain('ISO-45001:8.1');
    expect(codes).toContain('BOCW-Act-1996');
  });

  it('cite() emits India label', () => {
    const out = cite('NONCONFORMITY_CORRECTIVE_ACTION', { jurisdictions: ['ISO-45001', 'IN'] });
    expect(out.some((s) => s.includes('India'))).toBe(true);
  });

  it('maps ≥6 ISO controls to Indian regulations', () => {
    expect(Object.keys(IN_REFERENCES).length).toBeGreaterThanOrEqual(6);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Sprint 31 NN — APAC cross-cutting integration
// ───────────────────────────────────────────────────────────────────────

describe('Sprint 31 NN — APAC cross-jurisdiction integration', () => {
  it('JP/KR/IN coexist with ISO + EU jurisdictions in a single resolution', () => {
    const refs = getReferencesForControl('HAZARD_IDENTIFICATION', [
      'ISO-45001',
      'JP',
      'KR',
      'IN',
    ]);
    const jurisdictions = new Set(refs.map((r) => r.jurisdiction));
    expect(jurisdictions.has('ISO-45001')).toBe(true);
    expect(jurisdictions.has('JP')).toBe(true);
    expect(jurisdictions.has('KR')).toBe(true);
    expect(jurisdictions.has('IN')).toBe(true);
  });

  it('country aliases for APAC do not collide with existing aliases', () => {
    // Neither IN nor KR should accidentally route to a pre-Sprint-31 code.
    expect(getActiveJurisdictions({ country: 'IN' })).toEqual(['ISO-45001', 'IN']);
    expect(getActiveJurisdictions({ country: 'KR' })).toEqual(['ISO-45001', 'KR']);
    expect(getActiveJurisdictions({ country: 'JP' })).toEqual(['ISO-45001', 'JP']);
    // Existing CA/CL/BR aliases must still resolve to their pre-Sprint-31
    // jurisdictions, not to anything APAC.
    expect(getActiveJurisdictions({ country: 'CA' })).toEqual(['ISO-45001', 'CA']);
    expect(getActiveJurisdictions({ country: 'CL' })).toEqual(['ISO-45001', 'CL']);
    expect(getActiveJurisdictions({ country: 'BR' })).toEqual(['ISO-45001', 'BR']);
  });

  it('sortReferences keeps APAC jurisdictions in alphabetical order (AU < CA < IN < JP < KR < UK)', () => {
    const refs = getReferencesForControl('OPERATIONAL_CONTROL', [
      'ISO-45001',
      'UK',
      'CA',
      'AU',
      'JP',
      'KR',
      'IN',
    ]);
    expect(refs[0].jurisdiction).toBe('ISO-45001');
    const rest = refs.slice(1).map((r) => r.jurisdiction);
    const sortedRest = rest.slice().sort((a, b) => a.localeCompare(b));
    expect(rest).toEqual(sortedRest);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Sprint 31 SS — APAC tier global (China, Taiwan, Russia)
// ───────────────────────────────────────────────────────────────────────

describe('CN jurisdiction (Sprint 31 SS)', () => {
  it('country aliases CN / CHN / China / mainland-china resolve to CN', () => {
    expect(getActiveJurisdictions({ country: 'CN' })).toEqual(['ISO-45001', 'CN']);
    expect(getActiveJurisdictions({ country: 'CHN' })).toEqual(['ISO-45001', 'CN']);
    expect(getActiveJurisdictions({ country: 'china' })).toEqual(['ISO-45001', 'CN']);
    expect(getActiveJurisdictions({ country: 'mainland-china' })).toEqual(['ISO-45001', 'CN']);
  });

  it('every CN reference has a valid shape and points to a real ISO control', () => {
    expectAdapterShape(CN_REFERENCES as Record<string, unknown[]>, 'CN');
  });

  it('exposes Work Safety Law 2021 + GB/T 33000 + OPDL + Special Equipment Safety Law', () => {
    const allCodes = Object.values(CN_REFERENCES).flat().map((r) => r.code);
    expect(allCodes.some((c) => c.startsWith('WSL-2021'))).toBe(true);
    expect(allCodes).toContain('GB/T-33000-2016');
    expect(allCodes.some((c) => c.startsWith('OPDL'))).toBe(true);
    expect(allCodes).toContain('SESL-2013');
  });

  it('cite() emits China label', () => {
    const out = cite('LEADERSHIP_COMMITMENT', { jurisdictions: ['ISO-45001', 'CN'] });
    expect(out.some((s) => s.includes('China'))).toBe(true);
  });

  it('maps ≥7 ISO controls to Chinese regulations', () => {
    expect(Object.keys(CN_REFERENCES).length).toBeGreaterThanOrEqual(7);
  });
});

describe('TW jurisdiction (Sprint 31 SS)', () => {
  it('country aliases TW / TWN / Taiwan / republic-of-china / ROC resolve to TW', () => {
    expect(getActiveJurisdictions({ country: 'TW' })).toEqual(['ISO-45001', 'TW']);
    expect(getActiveJurisdictions({ country: 'TWN' })).toEqual(['ISO-45001', 'TW']);
    expect(getActiveJurisdictions({ country: 'taiwan' })).toEqual(['ISO-45001', 'TW']);
    expect(getActiveJurisdictions({ country: 'republic-of-china' })).toEqual(['ISO-45001', 'TW']);
    expect(getActiveJurisdictions({ country: 'ROC' })).toEqual(['ISO-45001', 'TW']);
  });

  it('Taiwan aliases NEVER collide with CN — TW must not resolve to CN', () => {
    // Critical: Taiwan is a separate jurisdiction. Verify no Taiwan alias
    // accidentally lands in CN.
    for (const alias of ['TW', 'TWN', 'TAIWAN', 'REPUBLIC-OF-CHINA', 'ROC']) {
      const j = getActiveJurisdictions({ country: alias });
      expect(j).not.toContain('CN');
      expect(j).toContain('TW');
    }
    // And CN aliases never collapse to TW.
    for (const alias of ['CN', 'CHN', 'CHINA', 'MAINLAND-CHINA']) {
      const j = getActiveJurisdictions({ country: alias });
      expect(j).not.toContain('TW');
      expect(j).toContain('CN');
    }
  });

  it('every TW reference has a valid shape', () => {
    expectAdapterShape(TW_REFERENCES as Record<string, unknown[]>, 'TW');
  });

  it('exposes OSH Act + Enforcement Rules', () => {
    const allCodes = Object.values(TW_REFERENCES).flat().map((r) => r.code);
    expect(allCodes.some((c) => c.startsWith('OSHA-TW'))).toBe(true);
  });

  it('cite() emits Taiwán label', () => {
    const out = cite('LEADERSHIP_COMMITMENT', { jurisdictions: ['ISO-45001', 'TW'] });
    expect(out.some((s) => s.includes('Taiwán'))).toBe(true);
  });

  it('maps ≥5 ISO controls to Taiwanese regulations', () => {
    expect(Object.keys(TW_REFERENCES).length).toBeGreaterThanOrEqual(5);
  });
});

describe('RU jurisdiction (Sprint 31 SS)', () => {
  it('country aliases RU / RUS / Russia / russian-federation resolve to RU', () => {
    expect(getActiveJurisdictions({ country: 'RU' })).toEqual(['ISO-45001', 'RU']);
    expect(getActiveJurisdictions({ country: 'RUS' })).toEqual(['ISO-45001', 'RU']);
    expect(getActiveJurisdictions({ country: 'russia' })).toEqual(['ISO-45001', 'RU']);
    expect(getActiveJurisdictions({ country: 'russian-federation' })).toEqual(['ISO-45001', 'RU']);
  });

  it('every RU reference has a valid shape', () => {
    expectAdapterShape(RU_REFERENCES as Record<string, unknown[]>, 'RU');
  });

  it('exposes Labor Code Ch.36 + 426-FZ (СОУТ) + GOST R 12.0.230', () => {
    const allCodes = Object.values(RU_REFERENCES).flat().map((r) => r.code);
    expect(allCodes.some((c) => c.startsWith('TK-RF'))).toBe(true);
    expect(allCodes).toContain('FZ-426');
    expect(allCodes).toContain('GOST-R-12.0.230');
  });

  it('combines ISO baseline + RU refs for HAZARD_IDENTIFICATION (СОУТ)', () => {
    const refs = getReferencesForControl('HAZARD_IDENTIFICATION', ['ISO-45001', 'RU']);
    const codes = refs.map((r) => r.code);
    expect(codes).toContain('ISO-45001:6.1.2');
    expect(codes).toContain('FZ-426');
  });

  it('cite() emits Rusia label', () => {
    const out = cite('LEADERSHIP_COMMITMENT', { jurisdictions: ['ISO-45001', 'RU'] });
    expect(out.some((s) => s.includes('Rusia'))).toBe(true);
  });

  it('maps ≥6 ISO controls to Russian regulations', () => {
    expect(Object.keys(RU_REFERENCES).length).toBeGreaterThanOrEqual(6);
  });
});

describe('Sprint 31 SS — APAC global cross-jurisdiction integration', () => {
  it('CN/TW/RU coexist with ISO + EU jurisdictions in a single resolution', () => {
    const refs = getReferencesForControl('OPERATIONAL_CONTROL', [
      'ISO-45001',
      'CN',
      'TW',
      'RU',
    ]);
    const jurisdictions = new Set(refs.map((r) => r.jurisdiction));
    expect(jurisdictions.has('ISO-45001')).toBe(true);
    expect(jurisdictions.has('CN')).toBe(true);
    expect(jurisdictions.has('TW')).toBe(true);
    expect(jurisdictions.has('RU')).toBe(true);
  });

  it('sortReferences preserves alphabetical order with new jurisdictions (AU < CA < CN < IN < JP < KR < RU < TW < UK)', () => {
    const refs = getReferencesForControl('OPERATIONAL_CONTROL', [
      'ISO-45001',
      'UK',
      'CA',
      'AU',
      'JP',
      'KR',
      'IN',
      'CN',
      'TW',
      'RU',
    ]);
    expect(refs[0].jurisdiction).toBe('ISO-45001');
    const rest = refs.slice(1).map((r) => r.jurisdiction);
    const sortedRest = rest.slice().sort((a, b) => a.localeCompare(b));
    expect(rest).toEqual(sortedRest);
  });
});
