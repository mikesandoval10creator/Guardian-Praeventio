// Sprint 48 E.4 — Catálogo de regímenes de privacidad. Determinístico,
// números concretos (deadlines en horas, retenciones en días).
//
// Consumido por `privacyRegimeRegistry.ts` (API pública) y por
// `JurisdictionProfile.privacyRegime` para mapear country → régimen.
//
// FUENTES (versiones vigentes al 2026-05):
//   - GDPR (EU 2016/679)            — 72h breach notification
//   - LGPD (Brasil Lei 13.709/2018) — "razoável" (estandarizamos 72h)
//   - PIPEDA (Canadá, 2000)         — "as soon as feasible" (estandar 72h)
//   - UK-DPA 2018 + UK GDPR         — 72h breach notification
//   - APP (Australia Privacy Act 1988) — 30 días NDB scheme
//   - PIPA-JP (Japón APPI 2003 rev. 2022) — 30 días
//   - PIPA-KR (Corea PIPA 2011 rev. 2024) — 72h
//   - DPDP (India 2023)             — "as soon as possible" (estandar 72h)
//   - PIPL-CN (China 2021)          — "immediate" (estandar 24h)
//   - PIPA-TW (Taiwan PDPA 2015)    — 72h breach notification
//   - 152-FZ (Russia 2006/2022)     — 24h notification + data localization
//
// 🔴 Fix 2026-05-15: antes CN/TW/RU apuntaban erróneamente a 'PIPA-JP'
// como placeholder (`profiles.ts:588,601,615`). Esto es riesgo regulatorio
// real — un cliente chino procesando bajo "régimen japonés" violaría PIPL.

export type PrivacyRegimeCode =
  | 'GDPR'
  | 'LGPD'
  | 'PIPEDA'
  | 'UK-DPA'
  | 'APP'
  | 'PIPA-JP'
  | 'PIPA-KR'
  | 'DPDP'
  | 'PIPL-CN'
  | 'PIPA-TW'
  | '152-FZ-RU';

export type DataSubjectRight =
  | 'access'
  | 'rectification'
  | 'erasure'
  | 'portability'
  | 'object'
  | 'restrict_processing'
  | 'withdraw_consent'
  | 'automated_decision_review';

export type ConsentLegalBasis =
  | 'explicit_consent'
  | 'contract_performance'
  | 'legal_obligation'
  | 'vital_interests'
  | 'public_task'
  | 'legitimate_interests';

export type DataKind =
  | 'pii_basic'
  | 'pii_contact'
  | 'biometric'
  | 'health_medical'
  | 'minor_data'
  | 'genetic'
  | 'location_precise'
  | 'cookies_analytics';

export interface PrivacyRegime {
  code: PrivacyRegimeCode;
  name: string;
  jurisdiction: string;
  effectiveYear: number;
  /** Derechos del titular reconocidos por el régimen. */
  dataSubjectRights: DataSubjectRight[];
  /** Bases legales válidas para procesamiento. */
  validConsentBases: ConsentLegalBasis[];
  /** Datos que SIEMPRE requieren consentimiento explícito adicional. */
  alwaysRequireExplicitConsent: DataKind[];
  /** Deadline en HORAS para notificar al regulator tras detección. */
  breachNotificationHours: number;
  /** ¿Requiere notificar a los individuos afectados? */
  breachNotificationToIndividuals: boolean;
  /** ¿Exige residencia local de datos sensibles? */
  dataResidencyRequired: boolean;
  /** Edad mínima para consentimiento sin tutor. */
  minorConsentAge: number;
  /** Multa máxima como % de revenue global anual (cuando el régimen lo define). */
  maxFinePercentRevenue?: number;
  /** Regulador / Data Protection Authority. */
  regulator: string;
}

const REGIMES: Record<PrivacyRegimeCode, PrivacyRegime> = {
  GDPR: {
    code: 'GDPR',
    name: 'General Data Protection Regulation (EU)',
    jurisdiction: 'EU + EEA',
    effectiveYear: 2018,
    dataSubjectRights: [
      'access',
      'rectification',
      'erasure',
      'portability',
      'object',
      'restrict_processing',
      'withdraw_consent',
      'automated_decision_review',
    ],
    validConsentBases: [
      'explicit_consent',
      'contract_performance',
      'legal_obligation',
      'vital_interests',
      'public_task',
      'legitimate_interests',
    ],
    alwaysRequireExplicitConsent: [
      'biometric',
      'health_medical',
      'minor_data',
      'genetic',
    ],
    breachNotificationHours: 72,
    breachNotificationToIndividuals: true,
    dataResidencyRequired: false,
    minorConsentAge: 16, // varía 13–16 según Member State
    maxFinePercentRevenue: 4,
    regulator: 'National DPA (EDPB coordinated)',
  },
  LGPD: {
    code: 'LGPD',
    name: 'Lei Geral de Proteção de Dados (Brasil)',
    jurisdiction: 'Brasil',
    effectiveYear: 2020,
    dataSubjectRights: [
      'access',
      'rectification',
      'erasure',
      'portability',
      'object',
      'withdraw_consent',
      'automated_decision_review',
    ],
    validConsentBases: [
      'explicit_consent',
      'contract_performance',
      'legal_obligation',
      'vital_interests',
      'public_task',
      'legitimate_interests',
    ],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data', 'genetic'],
    breachNotificationHours: 72, // ANPD: "prazo razoável" — estandarizamos GDPR-like
    breachNotificationToIndividuals: true,
    dataResidencyRequired: false,
    minorConsentAge: 12,
    maxFinePercentRevenue: 2,
    regulator: 'ANPD — Autoridade Nacional de Proteção de Dados',
  },
  PIPEDA: {
    code: 'PIPEDA',
    name: 'Personal Information Protection and Electronic Documents Act',
    jurisdiction: 'Canadá (federal)',
    effectiveYear: 2000,
    dataSubjectRights: ['access', 'rectification', 'withdraw_consent'],
    validConsentBases: [
      'explicit_consent',
      'contract_performance',
      'legal_obligation',
      'legitimate_interests',
    ],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data', 'genetic'],
    breachNotificationHours: 72, // PIPEDA: "as soon as feasible" — estandar 72h
    breachNotificationToIndividuals: true,
    dataResidencyRequired: false,
    minorConsentAge: 13,
    regulator: 'Office of the Privacy Commissioner of Canada (OPC)',
  },
  'UK-DPA': {
    code: 'UK-DPA',
    name: 'UK Data Protection Act 2018 + UK GDPR',
    jurisdiction: 'United Kingdom',
    effectiveYear: 2018,
    dataSubjectRights: [
      'access',
      'rectification',
      'erasure',
      'portability',
      'object',
      'restrict_processing',
      'withdraw_consent',
      'automated_decision_review',
    ],
    validConsentBases: [
      'explicit_consent',
      'contract_performance',
      'legal_obligation',
      'vital_interests',
      'public_task',
      'legitimate_interests',
    ],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data', 'genetic'],
    breachNotificationHours: 72,
    breachNotificationToIndividuals: true,
    dataResidencyRequired: false,
    minorConsentAge: 13,
    maxFinePercentRevenue: 4,
    regulator: 'Information Commissioner\'s Office (ICO)',
  },
  APP: {
    code: 'APP',
    name: 'Australian Privacy Principles (Privacy Act 1988)',
    jurisdiction: 'Australia',
    effectiveYear: 1988,
    dataSubjectRights: ['access', 'rectification', 'withdraw_consent'],
    validConsentBases: [
      'explicit_consent',
      'contract_performance',
      'legal_obligation',
      'legitimate_interests',
    ],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data'],
    // NDB (Notifiable Data Breaches): 30 días para evaluar y notificar.
    breachNotificationHours: 720,
    breachNotificationToIndividuals: true,
    dataResidencyRequired: false,
    minorConsentAge: 15,
    regulator: 'Office of the Australian Information Commissioner (OAIC)',
  },
  'PIPA-JP': {
    code: 'PIPA-JP',
    name: 'Act on the Protection of Personal Information (個人情報保護法)',
    jurisdiction: 'Japón',
    effectiveYear: 2003,
    dataSubjectRights: ['access', 'rectification', 'erasure', 'withdraw_consent'],
    validConsentBases: [
      'explicit_consent',
      'contract_performance',
      'legal_obligation',
      'legitimate_interests',
    ],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data', 'genetic'],
    // APPI 2022: notification "promptly" — PPC guidance ~3–5 días post detección.
    // Estandarizamos 30 días (720h) consistente con APP.
    breachNotificationHours: 720,
    breachNotificationToIndividuals: true,
    dataResidencyRequired: false,
    minorConsentAge: 15,
    regulator: 'Personal Information Protection Commission (PPC)',
  },
  'PIPA-KR': {
    code: 'PIPA-KR',
    name: 'Personal Information Protection Act (개인정보 보호법)',
    jurisdiction: 'Corea del Sur',
    effectiveYear: 2011,
    dataSubjectRights: [
      'access',
      'rectification',
      'erasure',
      'portability',
      'withdraw_consent',
      'automated_decision_review',
    ],
    validConsentBases: ['explicit_consent', 'contract_performance', 'legal_obligation'],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data', 'genetic', 'location_precise'],
    breachNotificationHours: 72,
    breachNotificationToIndividuals: true,
    dataResidencyRequired: true,
    minorConsentAge: 14,
    regulator: 'Personal Information Protection Commission (PIPC)',
  },
  DPDP: {
    code: 'DPDP',
    name: 'Digital Personal Data Protection Act 2023',
    jurisdiction: 'India',
    effectiveYear: 2023,
    dataSubjectRights: [
      'access',
      'rectification',
      'erasure',
      'withdraw_consent',
    ],
    validConsentBases: ['explicit_consent', 'legal_obligation'],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data', 'genetic'],
    breachNotificationHours: 72, // DPDP: "as soon as possible" — estandar GDPR
    breachNotificationToIndividuals: true,
    dataResidencyRequired: true, // localización para SDFs (Significant Data Fiduciaries)
    minorConsentAge: 18, // DPDP es estricto: <18 requiere consentimiento parental
    regulator: 'Data Protection Board of India',
  },
  // 🔴 NUEVO 2026-05-15: regímenes que antes faltaban — CN/TW/RU apuntaban
  // erróneamente a 'PIPA-JP' como placeholder en profiles.ts. Eso era
  // riesgo regulatorio real (un cliente chino procesando bajo "régimen
  // japonés" violaría PIPL art.40 cross-border + data localization).
  'PIPL-CN': {
    code: 'PIPL-CN',
    name: '个人信息保护法 (Personal Information Protection Law)',
    jurisdiction: 'China',
    effectiveYear: 2021,
    dataSubjectRights: [
      'access',
      'rectification',
      'erasure',
      'portability',
      'withdraw_consent',
      'automated_decision_review',
    ],
    // PIPL exige consent base separada y específica — no acepta legitimate_interests
    validConsentBases: ['explicit_consent', 'contract_performance', 'legal_obligation'],
    alwaysRequireExplicitConsent: [
      'biometric',
      'health_medical',
      'minor_data',
      'genetic',
      'location_precise',
    ],
    // PIPL art.57: notification "immediate" — estandarizamos 24h conservador
    breachNotificationHours: 24,
    breachNotificationToIndividuals: true,
    // PIPL art.40: data localization OBLIGATORIA para datos de ciudadanos chinos
    dataResidencyRequired: true,
    minorConsentAge: 14, // PIPL art.31
    regulator: 'Cyberspace Administration of China (CAC)',
  },
  'PIPA-TW': {
    code: 'PIPA-TW',
    name: '個人資料保護法 (Personal Data Protection Act)',
    jurisdiction: 'Taiwan',
    effectiveYear: 2015,
    dataSubjectRights: [
      'access',
      'rectification',
      'erasure',
      'withdraw_consent',
    ],
    validConsentBases: ['explicit_consent', 'contract_performance', 'legal_obligation'],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data', 'genetic'],
    breachNotificationHours: 72,
    breachNotificationToIndividuals: true,
    dataResidencyRequired: false,
    minorConsentAge: 20, // Civil Code Taiwan (mayoría de edad)
    regulator: 'National Development Council (NDC) / Personal Data Protection Commission',
  },
  '152-FZ-RU': {
    code: '152-FZ-RU',
    name: 'Федеральный закон №152-ФЗ "О персональных данных"',
    jurisdiction: 'Federación Rusa',
    effectiveYear: 2006, // Última reforma 2022
    dataSubjectRights: [
      'access',
      'rectification',
      'erasure',
      'withdraw_consent',
    ],
    validConsentBases: ['explicit_consent', 'legal_obligation', 'contract_performance'],
    alwaysRequireExplicitConsent: ['biometric', 'health_medical', 'minor_data', 'genetic'],
    // 152-FZ art.21.3: notificación "inmediata" — estandar 24h
    breachNotificationHours: 24,
    breachNotificationToIndividuals: true,
    // 152-FZ art.18.5: data localization OBLIGATORIA en servidores en Rusia
    dataResidencyRequired: true,
    minorConsentAge: 14,
    regulator: 'Roskomnadzor (Roscomnadzor)',
  },
};

export function getRegime(code: PrivacyRegimeCode): PrivacyRegime | null {
  return REGIMES[code] ?? null;
}

export function listRegimes(): PrivacyRegime[] {
  return Object.values(REGIMES);
}

/**
 * Devuelve `true` si el régimen exige consentimiento explícito para esa
 * categoría de dato. Categorías nunca contempladas (caller pasa dataKind
 * desconocido) → false (política conservadora: el caller decide).
 */
export function requiredConsentFor(
  regime: PrivacyRegimeCode,
  dataKind: DataKind,
): boolean {
  const r = REGIMES[regime];
  if (!r) return false;
  return r.alwaysRequireExplicitConsent.includes(dataKind);
}
