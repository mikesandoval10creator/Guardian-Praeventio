// Sprint 48 E.4 — Tests del jurisdictionRegistry (perfiles UK/CA/AU/JP/KR/IN).

import { describe, it, expect } from 'vitest';
import {
  getJurisdiction,
  listSupportedJurisdictions,
  compareRegimes,
} from './jurisdictionRegistry.js';

describe('jurisdictionRegistry — perfiles base', () => {
  it('listSupportedJurisdictions devuelve al menos las 6 nuevas (Sprint 48 E.4)', () => {
    const list = listSupportedJurisdictions();
    for (const code of ['UK', 'CA', 'AU', 'JP', 'KR', 'IN'] as const) {
      expect(list).toContain(code);
    }
  });

  it('listSupportedJurisdictions está en orden alfabético estable', () => {
    const list = listSupportedJurisdictions();
    const sorted = list.slice().sort((a, b) => a.localeCompare(b));
    expect(list).toEqual(sorted);
  });

  it('getJurisdiction(XX) desconocido → null', () => {
    // @ts-expect-error — intencional: forzar código no listado.
    expect(getJurisdiction('XX')).toBeNull();
  });
});

describe('jurisdictionRegistry — UK profile', () => {
  const uk = getJurisdiction('UK');

  it('exists con HSE como regulator y privacy regime UK-DPA', () => {
    expect(uk).not.toBeNull();
    expect(uk!.primaryRegulator).toMatch(/HSE|Health and Safety Executive/i);
    expect(uk!.privacyRegime).toBe('UK-DPA');
  });

  it('RIDDOR 7-day rule codificado en incidentReporting', () => {
    expect(uk!.incidentReporting.deadlineDays).toBe(7);
    expect(uk!.incidentReporting.fatalityImmediate).toBe(true);
    expect(uk!.incidentReporting.formName).toMatch(/RIDDOR/);
  });

  it('MHSWR-1999 marca mandatoryAtCount=5 (written risk assessment)', () => {
    const mhswr = uk!.regulations.find((r) => r.id === 'MHSWR-1999');
    expect(mhswr).toBeDefined();
    expect(mhswr!.mandatoryAtCount).toBe(5);
  });

  it('tiene HSWA-1974 como statute primario', () => {
    const hswa = uk!.regulations.find((r) => r.id === 'HSWA-1974');
    expect(hswa).toBeDefined();
    expect(hswa!.category).toBe('statute');
  });
});

describe('jurisdictionRegistry — Canada profile', () => {
  const ca = getJurisdiction('CA');

  it('JHSC threshold ≥20 employees codificado en Ontario regs', () => {
    expect(ca).not.toBeNull();
    const ontario = ca!.regulations.find((r) => r.id === 'ON-OHSA');
    expect(ontario).toBeDefined();
    expect(ontario!.mandatoryAtCount).toBe(20);
  });

  it('privacy regime PIPEDA', () => {
    expect(ca!.privacyRegime).toBe('PIPEDA');
  });

  it('incluye WHMIS 2015 + provincial statutes (Alberta + BC)', () => {
    const ids = ca!.regulations.map((r) => r.id);
    expect(ids).toContain('WHMIS-2015');
    expect(ids).toContain('AB-OHSA');
    expect(ids).toContain('BC-WCA');
  });

  it('mandatoryCommittees incluye JHSC Ontario ≥20', () => {
    const jhsc = ca!.mandatoryCommittees.find((c) => c.name.includes('Joint Health'));
    expect(jhsc).toBeDefined();
    expect(jhsc!.minEmployees).toBe(20);
  });
});

describe('jurisdictionRegistry — Australia profile', () => {
  const au = getJurisdiction('AU');

  it('WHS Act 2011 + privacy APP + ICAM framework', () => {
    expect(au).not.toBeNull();
    expect(au!.privacyRegime).toBe('APP');
    const ids = au!.regulations.map((r) => r.id);
    expect(ids).toContain('WHS-Act-2011');
    expect(ids).toContain('ICAM');
  });

  it('Victoria OHS Act 2004 incluido (state-specific harmonization)', () => {
    const vic = au!.regulations.find((r) => r.id === 'VIC-OHS-Act-2004');
    expect(vic).toBeDefined();
  });

  it('HSR threshold = 20 codificado', () => {
    const hsr = au!.mandatoryCommittees.find((c) => c.name.includes('HSR'));
    expect(hsr).toBeDefined();
    expect(hsr!.minEmployees).toBe(20);
  });

  it('emergency 000 codificado', () => {
    expect(au!.localizedNumbers.medical).toBe('000');
  });
});

describe('jurisdictionRegistry — Japan profile', () => {
  const jp = getJurisdiction('JP');

  it('ISHA 1972 + MHLW regulator + privacy PIPA-JP', () => {
    expect(jp).not.toBeNull();
    expect(jp!.primaryRegulator).toMatch(/MHLW|Ministry of Health/);
    expect(jp!.privacyRegime).toBe('PIPA-JP');
  });

  it('Safety Manager + Stress Check Program ambos en threshold 50', () => {
    const mgr = jp!.regulations.find((r) => r.id === 'ISHA-1972-art.10');
    const stress = jp!.regulations.find((r) => r.id === 'ISHA-1972-art.66-10');
    expect(mgr!.mandatoryAtCount).toBe(50);
    expect(stress!.mandatoryAtCount).toBe(50);
  });

  it('Safety and Health Committee ≥50 trabajadores', () => {
    const c = jp!.mandatoryCommittees.find((x) => x.name.includes('Safety and Health'));
    expect(c!.minEmployees).toBe(50);
  });

  it('emergency 119 / police 110 codificado', () => {
    expect(jp!.localizedNumbers.medical).toBe('119');
    expect(jp!.localizedNumbers.police).toBe('110');
  });
});

describe('jurisdictionRegistry — Korea profile', () => {
  const kr = getJurisdiction('KR');

  it('OSHA-K + SAPA 2022 (criminal-liability)', () => {
    expect(kr).not.toBeNull();
    expect(kr!.privacyRegime).toBe('PIPA-KR');
    const sapa = kr!.regulations.find((r) => r.id === 'SAPA-2022');
    expect(sapa).toBeDefined();
    expect(sapa!.category).toBe('criminal-liability');
    expect(sapa!.mandatoryAtCount).toBe(50);
  });

  it('KCS-04-01 construction standard incluido', () => {
    const ids = kr!.regulations.map((r) => r.id);
    expect(ids).toContain('KCS-04-01');
  });

  it('Industrial Safety and Health Committee ≥100', () => {
    const c = kr!.mandatoryCommittees.find((x) => x.name.includes('Industrial Safety'));
    expect(c!.minEmployees).toBe(100);
  });
});

describe('jurisdictionRegistry — India profile', () => {
  const inP = getJurisdiction('IN');

  it('Factories Act 1948 + OSH Code 2020 + privacy DPDP', () => {
    expect(inP).not.toBeNull();
    expect(inP!.privacyRegime).toBe('DPDP');
    const ids = inP!.regulations.map((r) => r.id);
    expect(ids).toContain('Factories-Act-1948');
    expect(ids).toContain('OSH-Code-2020');
  });

  it('Safety Committee threshold 250 trabajadores (§41G)', () => {
    const c = inP!.mandatoryCommittees.find((x) => x.name.includes('Safety Committee'));
    expect(c!.minEmployees).toBe(250);
  });

  it('BOCW 1996 cubre construcción con threshold 10', () => {
    const bocw = inP!.regulations.find((r) => r.id === 'BOCW-Act-1996');
    expect(bocw!.mandatoryAtCount).toBe(10);
  });
});

describe('compareRegimes', () => {
  it('UK vs CA — privacy regime difiere (UK-DPA vs PIPEDA)', () => {
    const diff = compareRegimes('UK', 'CA');
    expect(diff).not.toBeNull();
    expect(diff!.samePrivacyRegime).toBe(false);
    expect(diff!.privacyRegimeA).toBe('UK-DPA');
    expect(diff!.privacyRegimeB).toBe('PIPEDA');
  });

  it('UK vs AU — breach notification UK más estricto (72h) vs AU (720h NDB)', () => {
    const diff = compareRegimes('UK', 'AU');
    expect(diff!.breachNotificationHoursDelta).toBeLessThan(0); // UK − AU < 0
  });

  it('JP vs KR — comités count distinto', () => {
    const diff = compareRegimes('JP', 'KR');
    expect(diff!.mandatoryCommitteesCount.a).toBeGreaterThanOrEqual(2);
    expect(diff!.mandatoryCommitteesCount.b).toBeGreaterThanOrEqual(2);
  });

  it('UK vs UK — mismo régimen, deltas en cero', () => {
    const diff = compareRegimes('UK', 'UK');
    expect(diff!.samePrivacyRegime).toBe(true);
    expect(diff!.breachNotificationHoursDelta).toBe(0);
    expect(diff!.incidentDeadlineDaysDelta).toBe(0);
  });

  it('summary string es no-vacía y menciona ambos códigos', () => {
    const diff = compareRegimes('IN', 'JP');
    expect(diff!.summary).toMatch(/IN/);
    expect(diff!.summary).toMatch(/JP/);
  });

  it('jurisdicción inexistente → null', () => {
    // @ts-expect-error — intencional.
    expect(compareRegimes('XX', 'UK')).toBeNull();
  });
});
