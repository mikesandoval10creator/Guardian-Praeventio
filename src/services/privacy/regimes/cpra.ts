// Praeventio Guard — Sprint 31 Bucket MM.
//
// CPRA (California Privacy Rights Act of 2020, effective 2023-01-01).
// Amends and supersedes CCPA. Adds:
//   - Right to correct (rectification) § 1798.106.
//   - Right to limit use of sensitive personal information § 1798.121.
//   - Mandatory risk assessments for high-risk processing (CPRA-equivalent
//     of DPIA) § 1798.185(a)(15).
//   - Establishes the CPPA (California Privacy Protection Agency) as
//     dedicated enforcement body.
//
// Notes:
//   - Same 45-day deadline as CCPA.
//   - DPIA-equivalent ("risk assessment") becomes required for sensitive
//     processing.

import type { PrivacyRegimeSpec } from '../types.js';

export const CPRA_US_CA: PrivacyRegimeSpec = {
  code: 'CPRA-US-CA',
  country: 'US-CA',
  citation: 'Cal. Civ. Code § 1798.100-1798.199.100 (CPRA amendments)',
  authority: 'CPPA',
  rights: [
    'access',
    'portability',
    'rectification',
    'erasure',
    'opt_out_sale',
    'restriction',
    'consent_withdrawal',
  ],
  responseDeadlineDays: 45,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: false,
  ageOfConsent: 13,
  dpiaRequired: true,
  breachNotificationDeadlineHours: null,
  recordOfProcessingRequired: true,
};
