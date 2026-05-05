// Praeventio Guard — Sprint 31 Bucket MM.
//
// Privacy regime registry. Mirrors the regulatory framework abstraction
// from ADR 0014 but for privacy/data-protection regimes:
//
//   getActiveRegimes(country)
//     → PrivacyRegimeSpec[] for the country (+ data-residency when
//       processing crosses borders).
//
//   getMostStrictRegime(regimes)
//     → returns the regime that imposes the strictest combined
//       constraints (shortest deadline + consent base required).
//       Used by /api/compliance/data-request to honor the strictest
//       deadline when multiple regimes apply.
//
//   complianceMatrix(regimes)
//     → row-per-right table for the UI showing which regimes support
//       each right and with what deadline.
//
// Filosofía: cuando hay solape (BR user + EU processing → LGPD + GDPR),
// la respuesta es el AND lógico de obligaciones. Nunca relajamos a la
// menos estricta.

import type {
  PrivacyRegimeCode,
  PrivacyRegimeSpec,
  PrivacyRight,
  ComplianceMatrixRow,
} from './types.js';
import { GDPR_EU } from './regimes/gdpr.js';
import { CCPA_US_CA } from './regimes/ccpa.js';
import { CPRA_US_CA } from './regimes/cpra.js';
import { LGPD_BR } from './regimes/lgpd.js';
import { LEY_19628_CL } from './regimes/ley19628.js';
import { PIPEDA_CA } from './regimes/pipeda.js';
import { APPI_JP } from './regimes/appi.js';
import { PDPA_SG } from './regimes/pdpa.js';
import { PIPL_CN } from './regimes/pipl-cn.js';
import { FZ_152_RU } from './regimes/152fz-ru.js';
import { PIPA_TW } from './regimes/pipa-tw.js';

export const ALL_REGIMES: Record<PrivacyRegimeCode, PrivacyRegimeSpec> = {
  'GDPR-EU': GDPR_EU,
  'CCPA-US-CA': CCPA_US_CA,
  'CPRA-US-CA': CPRA_US_CA,
  'LGPD-BR': LGPD_BR,
  'LEY-19628-CL': LEY_19628_CL,
  'PIPEDA-CA': PIPEDA_CA,
  'APPI-JP': APPI_JP,
  'PDPA-SG': PDPA_SG,
  'PIPL-CN': PIPL_CN,
  '152-FZ-RU': FZ_152_RU,
  'PIPA-TW': PIPA_TW,
  // Stubs — declared for completeness, full specs deferred.
  'POPIA-ZA': {
    code: 'POPIA-ZA',
    country: 'ZA',
    citation: 'Protection of Personal Information Act 4 of 2013',
    authority: 'Information Regulator (ZA)',
    rights: ['access', 'rectification', 'erasure', 'objection', 'consent_withdrawal'],
    responseDeadlineDays: 30,
    dataPortabilityFormat: 'machine_readable',
    consentBaseRequired: true,
    ageOfConsent: 18,
    dpiaRequired: false,
    breachNotificationDeadlineHours: null,
    recordOfProcessingRequired: true,
  },
  'PDP-IN-DPDP': {
    code: 'PDP-IN-DPDP',
    country: 'IN',
    citation: 'Digital Personal Data Protection Act 2023',
    authority: 'Data Protection Board of India',
    rights: ['access', 'rectification', 'erasure', 'consent_withdrawal'],
    responseDeadlineDays: 30,
    dataPortabilityFormat: 'machine_readable',
    consentBaseRequired: true,
    ageOfConsent: 18,
    dpiaRequired: true,
    breachNotificationDeadlineHours: 72,
    recordOfProcessingRequired: true,
  },
};

// ---------------------------------------------------------------------------
// Country → regime resolution
// ---------------------------------------------------------------------------

/**
 * Maps an ISO 3166-1 alpha-2 country code (or informal alias) to the
 * PrivacyRegimeCode that primarily governs personal-data processing of a
 * subject in that country. EU bloc collapses to GDPR. California is a
 * special case (US-CA → CPRA which supersedes CCPA; we still expose CCPA
 * for tenants that contractually pin to it).
 */
const COUNTRY_TO_REGIME: Record<string, PrivacyRegimeCode[]> = {
  // EU bloc
  AT: ['GDPR-EU'],
  BE: ['GDPR-EU'],
  BG: ['GDPR-EU'],
  CY: ['GDPR-EU'],
  CZ: ['GDPR-EU'],
  DE: ['GDPR-EU'],
  DK: ['GDPR-EU'],
  EE: ['GDPR-EU'],
  ES: ['GDPR-EU'],
  FI: ['GDPR-EU'],
  FR: ['GDPR-EU'],
  GR: ['GDPR-EU'],
  HR: ['GDPR-EU'],
  HU: ['GDPR-EU'],
  IE: ['GDPR-EU'],
  IT: ['GDPR-EU'],
  LT: ['GDPR-EU'],
  LU: ['GDPR-EU'],
  LV: ['GDPR-EU'],
  MT: ['GDPR-EU'],
  NL: ['GDPR-EU'],
  PL: ['GDPR-EU'],
  PT: ['GDPR-EU'],
  RO: ['GDPR-EU'],
  SE: ['GDPR-EU'],
  SI: ['GDPR-EU'],
  SK: ['GDPR-EU'],
  EU: ['GDPR-EU'],
  // Americas
  'US-CA': ['CPRA-US-CA', 'CCPA-US-CA'],
  US: ['CPRA-US-CA', 'CCPA-US-CA'],
  CA: ['PIPEDA-CA'],
  CL: ['LEY-19628-CL'],
  CHILE: ['LEY-19628-CL'],
  BR: ['LGPD-BR'],
  BRAZIL: ['LGPD-BR'],
  BRASIL: ['LGPD-BR'],
  // Asia Pacific
  JP: ['APPI-JP'],
  SG: ['PDPA-SG'],
  IN: ['PDP-IN-DPDP'],
  ZA: ['POPIA-ZA'],
  // Sprint 31 SS — APAC tier global.
  CN: ['PIPL-CN'],
  CHN: ['PIPL-CN'],
  CHINA: ['PIPL-CN'],
  'MAINLAND-CHINA': ['PIPL-CN'],
  // Taiwan — jurisdicción completamente separada de PRC.
  TW: ['PIPA-TW'],
  TWN: ['PIPA-TW'],
  TAIWAN: ['PIPA-TW'],
  ROC: ['PIPA-TW'],
  // Russia — Roskomnadzor.
  RU: ['152-FZ-RU'],
  RUS: ['152-FZ-RU'],
  RUSSIA: ['152-FZ-RU'],
  'RUSSIAN-FEDERATION': ['152-FZ-RU'],
};

export interface ActiveRegimesContext {
  /** Country of the data subject (alpha-2). */
  country?: string;
  /** Where processing happens (often differs from `country`). */
  dataResidency?: string;
}

/**
 * Returns the deduplicated list of regimes that apply when a subject in
 * `country` is processed in `dataResidency`. There may be overlap (subject
 * in BR + processing in EU → LGPD + GDPR).
 */
export function getActiveRegimes(
  ctx: ActiveRegimesContext | string,
): PrivacyRegimeSpec[] {
  const c: ActiveRegimesContext =
    typeof ctx === 'string' ? { country: ctx } : ctx;

  const codes = new Set<PrivacyRegimeCode>();
  if (c.country) {
    for (const code of COUNTRY_TO_REGIME[c.country.toUpperCase()] ?? []) {
      codes.add(code);
    }
  }
  if (c.dataResidency) {
    for (const code of COUNTRY_TO_REGIME[c.dataResidency.toUpperCase()] ?? []) {
      codes.add(code);
    }
  }
  return [...codes].map((code) => ALL_REGIMES[code]);
}

/**
 * Of the supplied regimes, returns the one that imposes the strictest
 * combined constraint surface:
 *   1. Shortest `responseDeadlineDays`.
 *   2. `consentBaseRequired === true` wins ties.
 *   3. Stable order from the input array breaks final ties.
 *
 * Returns `null` if `regimes` is empty.
 */
export function getMostStrictRegime(
  regimes: PrivacyRegimeSpec[],
): PrivacyRegimeSpec | null {
  if (regimes.length === 0) return null;
  let best = regimes[0];
  for (let i = 1; i < regimes.length; i += 1) {
    const candidate = regimes[i];
    if (candidate.responseDeadlineDays < best.responseDeadlineDays) {
      best = candidate;
    } else if (
      candidate.responseDeadlineDays === best.responseDeadlineDays &&
      candidate.consentBaseRequired &&
      !best.consentBaseRequired
    ) {
      best = candidate;
    }
  }
  return best;
}

const ALL_RIGHTS: PrivacyRight[] = [
  'access',
  'portability',
  'rectification',
  'erasure',
  'objection',
  'restriction',
  'no_automated_decision',
  'opt_out_sale',
  'consent_withdrawal',
];

/**
 * Builds the {right × regime[]} matrix used by the UI. Empty
 * `supportedBy` arrays are kept (rendered as ✗ in the matrix) so the
 * compliance gap is explicit, never silently omitted.
 */
export function complianceMatrix(
  regimes: PrivacyRegimeSpec[],
): ComplianceMatrixRow[] {
  return ALL_RIGHTS.map((right) => ({
    right,
    supportedBy: regimes
      .filter((r) => r.rights.includes(right))
      .map((r) => ({
        code: r.code,
        deadlineDays: r.responseDeadlineDays,
        citation: r.citation,
      })),
  }));
}

/**
 * Convenience: the strictest deadline (in days) across the active
 * regimes. Used by the data-request endpoint to apply the floor.
 */
export function strictestDeadlineDays(
  regimes: PrivacyRegimeSpec[],
): number | null {
  if (regimes.length === 0) return null;
  return Math.min(...regimes.map((r) => r.responseDeadlineDays));
}
