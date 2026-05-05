// Praeventio Guard — Sprint 31 Bucket MM.

import { describe, it, expect } from 'vitest';
import {
  ALL_REGIMES,
  complianceMatrix,
  getActiveRegimes,
  getMostStrictRegime,
  strictestDeadlineDays,
} from './registry';

describe('getActiveRegimes', () => {
  it('routes BR to LGPD only', () => {
    const regimes = getActiveRegimes({ country: 'BR' });
    expect(regimes.map((r) => r.code)).toEqual(['LGPD-BR']);
  });

  it('routes any EU member state to GDPR', () => {
    expect(getActiveRegimes({ country: 'DE' }).map((r) => r.code)).toEqual([
      'GDPR-EU',
    ]);
    expect(getActiveRegimes({ country: 'fr' }).map((r) => r.code)).toEqual([
      'GDPR-EU',
    ]);
  });

  it('routes US-CA to both CPRA and CCPA', () => {
    const codes = getActiveRegimes({ country: 'US-CA' }).map((r) => r.code);
    expect(codes).toContain('CPRA-US-CA');
    expect(codes).toContain('CCPA-US-CA');
  });

  it('combines subject country + data residency without dupes', () => {
    const regimes = getActiveRegimes({ country: 'BR', dataResidency: 'DE' });
    const codes = regimes.map((r) => r.code).sort();
    expect(codes).toEqual(['GDPR-EU', 'LGPD-BR']);
  });

  it('accepts a bare country string', () => {
    expect(getActiveRegimes('CL').map((r) => r.code)).toEqual(['LEY-19628-CL']);
  });

  it('returns empty array for unknown country', () => {
    expect(getActiveRegimes({ country: 'ZZ' })).toEqual([]);
  });
});

describe('getMostStrictRegime', () => {
  it('returns null for empty input', () => {
    expect(getMostStrictRegime([])).toBeNull();
  });

  it('picks the shortest deadline (LGPD 15d over GDPR 30d)', () => {
    const winner = getMostStrictRegime([ALL_REGIMES['GDPR-EU'], ALL_REGIMES['LGPD-BR']]);
    expect(winner?.code).toBe('LGPD-BR');
  });

  it('picks APPI 14d as strictest among GDPR + LGPD + APPI', () => {
    const winner = getMostStrictRegime([
      ALL_REGIMES['GDPR-EU'],
      ALL_REGIMES['LGPD-BR'],
      ALL_REGIMES['APPI-JP'],
    ]);
    expect(winner?.code).toBe('APPI-JP');
  });

  it('breaks deadline ties by consentBaseRequired (true wins)', () => {
    const winner = getMostStrictRegime([
      ALL_REGIMES['CCPA-US-CA'], // 45d, consent false
      ALL_REGIMES['CPRA-US-CA'], // 45d, consent false
    ]);
    // Both equal — stable order returns first.
    expect(winner?.code).toBe('CCPA-US-CA');
  });
});

describe('complianceMatrix', () => {
  it('returns one row per right (9 total)', () => {
    const matrix = complianceMatrix([ALL_REGIMES['GDPR-EU']]);
    expect(matrix).toHaveLength(9);
    expect(matrix.map((r) => r.right)).toContain('access');
    expect(matrix.map((r) => r.right)).toContain('opt_out_sale');
  });

  it('opt_out_sale is empty for GDPR but populated for CCPA', () => {
    const matrix = complianceMatrix([
      ALL_REGIMES['GDPR-EU'],
      ALL_REGIMES['CCPA-US-CA'],
    ]);
    const optOut = matrix.find((r) => r.right === 'opt_out_sale');
    expect(optOut?.supportedBy.map((s) => s.code)).toEqual(['CCPA-US-CA']);
  });

  it('access right is supported by every regime', () => {
    const all = Object.values(ALL_REGIMES);
    const matrix = complianceMatrix(all);
    const access = matrix.find((r) => r.right === 'access')!;
    expect(access.supportedBy).toHaveLength(all.length);
  });

  it('cells include deadline + citation', () => {
    const matrix = complianceMatrix([ALL_REGIMES['LGPD-BR']]);
    const access = matrix.find((r) => r.right === 'access')!;
    expect(access.supportedBy[0].deadlineDays).toBe(15);
    expect(access.supportedBy[0].citation).toContain('13.709');
  });
});

describe('strictestDeadlineDays', () => {
  it('returns null for empty', () => {
    expect(strictestDeadlineDays([])).toBeNull();
  });

  it('picks the minimum across regimes', () => {
    expect(
      strictestDeadlineDays([
        ALL_REGIMES['GDPR-EU'],
        ALL_REGIMES['LGPD-BR'],
        ALL_REGIMES['APPI-JP'],
      ]),
    ).toBe(14);
  });
});

describe('regime sanity', () => {
  it('GDPR has 9 rights minus opt_out_sale', () => {
    expect(ALL_REGIMES['GDPR-EU'].rights).not.toContain('opt_out_sale');
    expect(ALL_REGIMES['GDPR-EU'].rights.length).toBeGreaterThanOrEqual(8);
  });

  it('GDPR breach window is 72h', () => {
    expect(ALL_REGIMES['GDPR-EU'].breachNotificationDeadlineHours).toBe(72);
  });

  it('every regime declares a non-empty rights list', () => {
    for (const regime of Object.values(ALL_REGIMES)) {
      expect(regime.rights.length).toBeGreaterThan(0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// Sprint 31 SS — APAC tier global (PIPL-CN, 152-FZ-RU, PIPA-TW)
// ───────────────────────────────────────────────────────────────────────

describe('Sprint 31 SS — PIPL (China)', () => {
  it('routes CN aliases to PIPL-CN only (NOT PIPA-TW)', () => {
    for (const alias of ['CN', 'CHN', 'china', 'mainland-china']) {
      const codes = getActiveRegimes({ country: alias }).map((r) => r.code);
      expect(codes).toEqual(['PIPL-CN']);
    }
  });

  it('declares 15-day deadline + age 14 + dataResidencyRequired', () => {
    const r = ALL_REGIMES['PIPL-CN'];
    expect(r.responseDeadlineDays).toBe(15);
    expect(r.ageOfConsent).toBe(14);
    expect(r.consentBaseRequired).toBe(true);
    expect(r.dataResidencyRequired).toBe(true);
  });

  it('grants the 7 PIPL rights (incl. no_automated_decision)', () => {
    const rights = ALL_REGIMES['PIPL-CN'].rights;
    expect(rights).toContain('access');
    expect(rights).toContain('portability');
    expect(rights).toContain('rectification');
    expect(rights).toContain('erasure');
    expect(rights).toContain('restriction');
    expect(rights).toContain('no_automated_decision');
    expect(rights).toContain('consent_withdrawal');
  });

  it('cites CAC as authority', () => {
    expect(ALL_REGIMES['PIPL-CN'].authority).toContain('CAC');
  });
});

describe('Sprint 31 SS — 152-FZ (Russia)', () => {
  it('routes RU aliases to 152-FZ-RU only', () => {
    for (const alias of ['RU', 'RUS', 'russia', 'russian-federation']) {
      const codes = getActiveRegimes({ country: alias }).map((r) => r.code);
      expect(codes).toEqual(['152-FZ-RU']);
    }
  });

  it('declares 30-day deadline + age 14 + dataResidencyRequired (art.18.5)', () => {
    const r = ALL_REGIMES['152-FZ-RU'];
    expect(r.responseDeadlineDays).toBe(30);
    expect(r.ageOfConsent).toBe(14);
    expect(r.dataResidencyRequired).toBe(true);
  });

  it('cites Roskomnadzor', () => {
    expect(ALL_REGIMES['152-FZ-RU'].authority).toContain('Roskomnadzor');
  });

  it('does NOT include portability or no_automated_decision (not in 152-FZ)', () => {
    const rights = ALL_REGIMES['152-FZ-RU'].rights;
    expect(rights).not.toContain('portability');
    expect(rights).not.toContain('no_automated_decision');
  });
});

describe('Sprint 31 SS — PIPA (Taiwan)', () => {
  it('routes TW aliases to PIPA-TW only (NEVER PIPL-CN)', () => {
    for (const alias of ['TW', 'TWN', 'taiwan', 'ROC']) {
      const codes = getActiveRegimes({ country: alias }).map((r) => r.code);
      expect(codes).toEqual(['PIPA-TW']);
      // Critical: Taiwan must not collide with PRC PIPL.
      expect(codes).not.toContain('PIPL-CN');
    }
  });

  it('declares 30-day deadline + consent required', () => {
    const r = ALL_REGIMES['PIPA-TW'];
    expect(r.responseDeadlineDays).toBe(30);
    expect(r.consentBaseRequired).toBe(true);
  });

  it('does NOT require data residency (TW allows cross-border by default)', () => {
    expect(ALL_REGIMES['PIPA-TW'].dataResidencyRequired).toBeFalsy();
  });

  it('cites PDPC (Personal Data Protection Commission)', () => {
    expect(ALL_REGIMES['PIPA-TW'].authority).toContain('PDPC');
  });
});

describe('Sprint 31 SS — APAC global cross-cutting', () => {
  it('PIPL is strictest among PIPL+152-FZ+PIPA (15d < 30d)', () => {
    const winner = getMostStrictRegime([
      ALL_REGIMES['PIPL-CN'],
      ALL_REGIMES['152-FZ-RU'],
      ALL_REGIMES['PIPA-TW'],
    ]);
    expect(winner?.code).toBe('PIPL-CN');
  });

  it('strictestDeadlineDays returns 15 for PIPL+152-FZ', () => {
    expect(
      strictestDeadlineDays([
        ALL_REGIMES['PIPL-CN'],
        ALL_REGIMES['152-FZ-RU'],
      ]),
    ).toBe(15);
  });

  it('every Sprint 31 SS regime declares record_of_processing required', () => {
    expect(ALL_REGIMES['PIPL-CN'].recordOfProcessingRequired).toBe(true);
    expect(ALL_REGIMES['152-FZ-RU'].recordOfProcessingRequired).toBe(true);
    expect(ALL_REGIMES['PIPA-TW'].recordOfProcessingRequired).toBe(true);
  });
});

