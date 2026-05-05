// Praeventio Guard — Sprint 31 Bucket MM.
//
// GDPR (Regulation (EU) 2016/679). Rights cited from arts. 15-22:
//   art.15 access, art.16 rectification, art.17 erasure ("right to be
//   forgotten"), art.18 restriction, art.20 portability, art.21 objection,
//   art.22 no automated decision-making.
//
// Notes:
//   - Deadline 1 month (≈30 days) per art.12(3); extendable +2 months for
//     complex requests (we encode the floor: 30).
//   - Age of consent 16 default (art.8); member states may lower to 13.
//     We pin 16 — when a tenant operates in a country with a lower local
//     floor we still satisfy GDPR by being stricter.
//   - DPIA required when art.35 triggers (high risk processing). We
//     encode `true` because Praeventio processes occupational health data
//     (special category) → DPIA is required for our specific use-case.
//   - Breach notification 72h to supervisory authority (art.33).

import type { PrivacyRegimeSpec } from '../types.js';

export const GDPR_EU: PrivacyRegimeSpec = {
  code: 'GDPR-EU',
  country: 'EU',
  citation: 'Regulation (EU) 2016/679 art.15-22',
  authority: 'EDPB',
  rights: [
    'access',
    'portability',
    'rectification',
    'erasure',
    'objection',
    'restriction',
    'no_automated_decision',
    'consent_withdrawal',
  ],
  responseDeadlineDays: 30,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 16,
  dpiaRequired: true,
  breachNotificationDeadlineHours: 72,
  recordOfProcessingRequired: true,
};
