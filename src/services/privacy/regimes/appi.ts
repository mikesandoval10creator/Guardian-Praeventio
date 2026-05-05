// Praeventio Guard — Sprint 31 Bucket MM.
//
// APPI (Act on the Protection of Personal Information, 個人情報保護法).
// Japan, Act No. 57 of 2003, last major revision 2022.
//
// Notes:
//   - Rights of access, correction, suspension of use, deletion (art.28-30).
//   - 2022 revision adds disclosure right with electromagnetic format
//     (machine readable export). Effective 2022-04-01.
//   - Deadline: PPC guidance "without delay" — operational interpretation
//     is 14 days for access requests.
//   - Breach notification: 2022 amendment art.26 — must report to PPC
//     "promptly" (a maximum of 3-5 days for confirmed reports, with a
//     preliminary "as soon as you become aware" duty). Strictest practical
//     interpretation: hours, no fixed cap. We encode 72 hours as a
//     conservative practical cap (matches the PPC's preliminary report
//     guidance) — strict regimes treat APPI as the most demanding.
//   - Age of consent: not codified explicitly; PPC guidance recognizes
//     12-15 as the lower bound for self-consent; we pin 16.
//   - DPIA: not mandated by APPI itself, but the PPC publishes guidelines
//     for high-risk processing.

import type { PrivacyRegimeSpec } from '../types.js';

export const APPI_JP: PrivacyRegimeSpec = {
  code: 'APPI-JP',
  country: 'JP',
  citation: 'Act on the Protection of Personal Information (Act No. 57/2003) art.28-30',
  authority: 'PPC (Personal Information Protection Commission)',
  rights: [
    'access',
    'portability',
    'rectification',
    'erasure',
    'restriction',
    'consent_withdrawal',
  ],
  responseDeadlineDays: 14,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 16,
  dpiaRequired: false,
  breachNotificationDeadlineHours: 72,
  recordOfProcessingRequired: true,
};
