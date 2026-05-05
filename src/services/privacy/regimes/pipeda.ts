// Praeventio Guard — Sprint 31 Bucket MM.
//
// PIPEDA (Personal Information Protection and Electronic Documents Act),
// federal Canada. S.C. 2000, c. 5. Applies to commercial organizations
// outside provinces with substantially similar laws (Quebec, Alberta,
// BC have their own regimes that are recognized as equivalent).
//
// Notes:
//   - 10 Fair Information Principles in Schedule 1.
//   - Right of access: principle 4.9 — response within 30 days
//     (Schedule 1, principle 4.9.4). Extension permitted but capped.
//   - No general portability right at the federal level (Bill C-27,
//     proposed CPPA, would add it; not yet in force as of 2026-05).
//   - Mandatory breach notification since 2018 (PIPEDA s.10.1) — "as
//     soon as feasible" + record-keeping; no fixed hour cap.
//   - Age of consent not explicitly codified; OPC guidance says 13 for
//     online consent.
//   - PIA (privacy impact assessment) required for federal institutions
//     under Treasury Board Directive; private sector under PIPEDA does
//     not have a hard mandate but OPC strongly recommends.

import type { PrivacyRegimeSpec } from '../types.js';

export const PIPEDA_CA: PrivacyRegimeSpec = {
  code: 'PIPEDA-CA',
  country: 'CA',
  citation: 'PIPEDA S.C. 2000 c.5 Schedule 1 principles 4.1-4.10',
  authority: 'OPC (Office of the Privacy Commissioner of Canada)',
  rights: [
    'access',
    'rectification',
    'consent_withdrawal',
    'objection',
  ],
  responseDeadlineDays: 30,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 13,
  dpiaRequired: false,
  breachNotificationDeadlineHours: null,
  recordOfProcessingRequired: true,
};
