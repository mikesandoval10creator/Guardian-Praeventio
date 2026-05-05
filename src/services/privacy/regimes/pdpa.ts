// Praeventio Guard — Sprint 31 Bucket MM.
//
// PDPA Singapore (Personal Data Protection Act 2012, last amended 2020).
// Cap. 26 of 2012.
//
// Notes:
//   - Access (s.21) and correction (s.22) obligations. Erasure not
//     codified as a standalone right but covered via s.25 retention
//     limitation.
//   - Deadline: 30 days for access ("as soon as reasonably possible").
//   - 2020 amendment introduced data portability obligation (Part 6B,
//     not yet in force pending PDPC commencement order at time of
//     writing — we encode it as supported declaratively).
//   - Mandatory breach notification: Part 6A, within 3 calendar days
//     (72 hours) to PDPC if breach is of significant scale or impact.
//   - Consent withdrawal: s.16.
//   - Age: PDPC guidance treats 13 as the lower bound for valid consent.

import type { PrivacyRegimeSpec } from '../types.js';

export const PDPA_SG: PrivacyRegimeSpec = {
  code: 'PDPA-SG',
  country: 'SG',
  citation: 'Personal Data Protection Act 2012 (Cap. 26) ss.21-22, Part 6A-6B',
  authority: 'PDPC (Personal Data Protection Commission)',
  rights: [
    'access',
    'portability',
    'rectification',
    'consent_withdrawal',
  ],
  responseDeadlineDays: 30,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 13,
  dpiaRequired: false,
  breachNotificationDeadlineHours: 72,
  recordOfProcessingRequired: true,
};
