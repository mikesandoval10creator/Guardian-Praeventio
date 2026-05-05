// Praeventio Guard — Sprint 31 Bucket MM.
//
// CCPA (California Consumer Privacy Act, Cal. Civ. Code § 1798.100 et
// seq.). Pre-CPRA. Rights:
//   - 1798.100 right to know / access
//   - 1798.105 right to delete (limited)
//   - 1798.120 right to opt-out of sale of personal information
//   - 1798.135 right to non-discrimination
//
// Notes:
//   - Deadline: 45 days (extendable +45) per § 1798.130(a)(2).
//   - Age of consent: 13 (children's opt-in for sale § 1798.120(c)).
//   - No general DPIA mandate (CPRA adds it).
//   - No fixed breach window in CCPA itself (handled by Cal. Civ. Code
//     § 1798.82 — "in the most expedient time possible and without
//     unreasonable delay").

import type { PrivacyRegimeSpec } from '../types.js';

export const CCPA_US_CA: PrivacyRegimeSpec = {
  code: 'CCPA-US-CA',
  country: 'US-CA',
  citation: 'Cal. Civ. Code § 1798.100-1798.199',
  authority: 'CPPA',
  rights: [
    'access',
    'portability',
    'erasure',
    'opt_out_sale',
  ],
  responseDeadlineDays: 45,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: false,
  ageOfConsent: 13,
  dpiaRequired: false,
  breachNotificationDeadlineHours: null,
  recordOfProcessingRequired: false,
};
