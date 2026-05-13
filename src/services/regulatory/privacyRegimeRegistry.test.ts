// Sprint 48 E.4 — Tests del privacyRegimeRegistry (8 regímenes).

import { describe, it, expect } from 'vitest';
import {
  getRegime,
  listRegimes,
  requiredConsentFor,
} from './privacyRegimeRegistry.js';

describe('privacyRegimeRegistry — catálogo de 8', () => {
  it('listRegimes incluye exactamente los 8 regímenes esperados', () => {
    const codes = listRegimes().map((r) => r.code);
    for (const c of [
      'GDPR',
      'LGPD',
      'PIPEDA',
      'UK-DPA',
      'APP',
      'PIPA-JP',
      'PIPA-KR',
      'DPDP',
    ] as const) {
      expect(codes).toContain(c);
    }
    expect(codes.length).toBe(8);
  });

  it('getRegime(XX) → null', () => {
    // @ts-expect-error — intencional.
    expect(getRegime('XX')).toBeNull();
  });
});

describe('privacyRegimeRegistry — deadlines de breach notification', () => {
  it('GDPR / UK-DPA / LGPD / PIPEDA / PIPA-KR / DPDP → 72h', () => {
    expect(getRegime('GDPR')!.breachNotificationHours).toBe(72);
    expect(getRegime('UK-DPA')!.breachNotificationHours).toBe(72);
    expect(getRegime('LGPD')!.breachNotificationHours).toBe(72);
    expect(getRegime('PIPEDA')!.breachNotificationHours).toBe(72);
    expect(getRegime('PIPA-KR')!.breachNotificationHours).toBe(72);
    expect(getRegime('DPDP')!.breachNotificationHours).toBe(72);
  });

  it('APP (Australia) → 30 días NDB = 720h', () => {
    expect(getRegime('APP')!.breachNotificationHours).toBe(720);
  });

  it('PIPA-JP (Japón) → ~30 días = 720h', () => {
    expect(getRegime('PIPA-JP')!.breachNotificationHours).toBe(720);
  });
});

describe('privacyRegimeRegistry — datos sensibles y consentimiento', () => {
  it('GDPR exige explicit consent para biometric + health + minor + genetic', () => {
    expect(requiredConsentFor('GDPR', 'biometric')).toBe(true);
    expect(requiredConsentFor('GDPR', 'health_medical')).toBe(true);
    expect(requiredConsentFor('GDPR', 'minor_data')).toBe(true);
    expect(requiredConsentFor('GDPR', 'genetic')).toBe(true);
  });

  it('GDPR NO exige explicit consent para pii_basic (caller decide bajo otra base)', () => {
    expect(requiredConsentFor('GDPR', 'pii_basic')).toBe(false);
  });

  it('PIPA-KR exige consentimiento explícito para location_precise (régimen estricto)', () => {
    expect(requiredConsentFor('PIPA-KR', 'location_precise')).toBe(true);
    // GDPR no lo lista explícitamente.
    expect(requiredConsentFor('GDPR', 'location_precise')).toBe(false);
  });

  it('APP (Australia) no incluye genetic en la lista mínima', () => {
    expect(requiredConsentFor('APP', 'genetic')).toBe(false);
  });

  it('PIPEDA exige consentimiento para datos médicos', () => {
    expect(requiredConsentFor('PIPEDA', 'health_medical')).toBe(true);
  });
});

describe('privacyRegimeRegistry — data residency y minor consent age', () => {
  it('PIPA-KR exige data residency local', () => {
    expect(getRegime('PIPA-KR')!.dataResidencyRequired).toBe(true);
  });

  it('DPDP (India) exige data residency local para SDFs', () => {
    expect(getRegime('DPDP')!.dataResidencyRequired).toBe(true);
  });

  it('GDPR NO impone data residency intra-EU como mandatory', () => {
    expect(getRegime('GDPR')!.dataResidencyRequired).toBe(false);
  });

  it('DPDP minorConsentAge = 18 (estricto)', () => {
    expect(getRegime('DPDP')!.minorConsentAge).toBe(18);
  });

  it('LGPD minorConsentAge = 12 (Brasil)', () => {
    expect(getRegime('LGPD')!.minorConsentAge).toBe(12);
  });
});

describe('privacyRegimeRegistry — derechos del titular', () => {
  it('GDPR + UK-DPA tienen los 8 derechos completos', () => {
    const gdpr = getRegime('GDPR')!;
    const uk = getRegime('UK-DPA')!;
    expect(gdpr.dataSubjectRights.length).toBeGreaterThanOrEqual(8);
    expect(uk.dataSubjectRights.length).toBeGreaterThanOrEqual(8);
  });

  it('GDPR + UK-DPA + LGPD soportan automated_decision_review', () => {
    expect(getRegime('GDPR')!.dataSubjectRights).toContain('automated_decision_review');
    expect(getRegime('UK-DPA')!.dataSubjectRights).toContain('automated_decision_review');
    expect(getRegime('LGPD')!.dataSubjectRights).toContain('automated_decision_review');
  });

  it('PIPEDA es más limitado (no portability obligatorio)', () => {
    expect(getRegime('PIPEDA')!.dataSubjectRights).not.toContain('portability');
  });
});

describe('privacyRegimeRegistry — multas y reguladores', () => {
  it('GDPR + UK-DPA: max 4% revenue global', () => {
    expect(getRegime('GDPR')!.maxFinePercentRevenue).toBe(4);
    expect(getRegime('UK-DPA')!.maxFinePercentRevenue).toBe(4);
  });

  it('LGPD: max 2% revenue', () => {
    expect(getRegime('LGPD')!.maxFinePercentRevenue).toBe(2);
  });

  it('reguladores explicitados', () => {
    expect(getRegime('GDPR')!.regulator).toMatch(/DPA|EDPB/);
    expect(getRegime('UK-DPA')!.regulator).toMatch(/ICO/);
    expect(getRegime('APP')!.regulator).toMatch(/OAIC/);
    expect(getRegime('PIPA-JP')!.regulator).toMatch(/PPC/);
    expect(getRegime('PIPA-KR')!.regulator).toMatch(/PIPC/);
  });
});
