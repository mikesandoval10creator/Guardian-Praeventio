// Praeventio Guard — Sprint 31 Bucket MM.
//
// Privacy compliance types — abstraction over multiple jurisdictional
// privacy regimes (GDPR, CCPA, CPRA, LGPD, Ley 19.628, PIPEDA, APPI, ...).
//
// Filosofía idéntica a ADR 0014 (regulatory framework abstraction): el
// tenant declara país (+ data residency); el registry compone qué regimes
// aplican y devuelve el "más estricto" cuando hay solape (deadline más
// corto, consentimiento más estricto). Las features no preguntan por
// "GDPR vs CCPA" — preguntan por "rights soportados" y "deadline a
// aplicar".
//
// Coverage honesto:
//   - IMPLEMENTADO end-to-end: Ley 19.628 (CL), LGPD (BR) — endpoints
//     consent / data-request / processing-activities cableados.
//   - IMPLEMENTADO declarativo (registry + matrix UI): GDPR, CCPA, CPRA,
//     PIPEDA, APPI, PDPA, POPIA, DPDP. El endpoint /data-request lee el
//     deadline más estricto del registry. Falta DSAR específico per
//     regime (p.ej. opt_out_sale CCPA, ANPD breach reporting).

export type PrivacyRegimeCode =
  | 'GDPR-EU'
  | 'CCPA-US-CA'
  | 'CPRA-US-CA'
  | 'LGPD-BR'
  | 'LEY-19628-CL'
  | 'PIPEDA-CA'
  | 'APPI-JP'
  | 'PDPA-SG'
  | 'POPIA-ZA'
  | 'PDP-IN-DPDP'
  | 'PIPL-CN'
  | '152-FZ-RU'
  | 'PIPA-TW';

/**
 * Right exposed to the data subject. Superset across all regimes — a given
 * regime supports a subset (see `PrivacyRegimeSpec.rights`).
 */
export type PrivacyRight =
  | 'access'
  | 'portability'
  | 'rectification'
  | 'erasure'
  | 'objection'
  | 'restriction'
  | 'no_automated_decision'
  | 'opt_out_sale'
  | 'consent_withdrawal';

export interface PrivacyRegimeSpec {
  code: PrivacyRegimeCode;
  /**
   * ISO 3166-1 alpha-2 + region for sub-national regimes (CCPA → 'US-CA').
   */
  country: string;
  /** Citation string. e.g. 'Regulation (EU) 2016/679 art.15-22'. */
  citation: string;
  /** Supervisory authority abbreviation. e.g. 'EDPB', 'CPPA', 'ANPD'. */
  authority: string;
  rights: PrivacyRight[];
  /** Deadline to honor a data-subject access request, in calendar days. */
  responseDeadlineDays: number;
  dataPortabilityFormat: 'json' | 'csv' | 'machine_readable';
  consentBaseRequired: boolean;
  /** Age below which parental consent is required. */
  ageOfConsent: number;
  /** Whether a Data Protection Impact Assessment is mandated. */
  dpiaRequired: boolean;
  /**
   * Hours within which a data breach must be notified to the authority.
   * `null` if the regime requires "reasonable time" without a hard cap.
   */
  breachNotificationDeadlineHours: number | null;
  /** GDPR art. 30 / LGPD art. 37 equivalent — register of processing. */
  recordOfProcessingRequired: boolean;
  /**
   * Sprint 31 SS — Data localization flag. `true` cuando la ley exige
   * que los datos personales de sujetos del país residan físicamente
   * dentro del país (ej. Russia 152-FZ art.18.5; PIPL-CN cross-border
   * assessment). Las features de procesamiento offshore deben rechazar
   * el flujo cuando este flag es `true`.
   */
  dataResidencyRequired?: boolean;
}

/**
 * Helper: a row in the compliance matrix UI. One per right, with the list
 * of regimes that support it.
 */
export interface ComplianceMatrixRow {
  right: PrivacyRight;
  /** Regimes that grant this right + the deadline they impose. */
  supportedBy: Array<{
    code: PrivacyRegimeCode;
    deadlineDays: number;
    citation: string;
  }>;
}
