// Praeventio Guard — Sprint 31 Bucket MM.
//
// LGPD (Lei Geral de Proteção de Dados Pessoais, Lei nº 13.709/2018).
// Brazil. Modeled closely on GDPR with localized differences:
//   - art.18 lists rights of the titular (data subject): confirmation
//     of processing, access, correction, anonymization/blocking/deletion,
//     portability, deletion of consent-based data, info about sharing,
//     consent revocation, opposition.
//   - art.19 establishes 15-day deadline for confirmation/access (note:
//     other actions follow art.52 reasonable time, but 15 days is the
//     hard floor for access).
//   - art.48 establishes breach notification — "reasonable time"
//     ("prazo razoável") with no fixed hour cap. ANPD interpretation
//     post-2022 leans toward 2 days when feasible, but the law itself
//     does not codify it. We encode `null` to be honest.
//   - art.50 PMS / DPO obligations.
//   - art.14: age of consent — children under 12 require parental
//     consent; teens 12-17 may consent for their own benefit.
//   - DPIA equivalent ("Relatório de Impacto à Proteção de Dados Pessoais")
//     required by art.38 when ANPD requests it; we mark `true` because
//     occupational-health processing is high-risk.

import type { PrivacyRegimeSpec } from '../types.js';

export const LGPD_BR: PrivacyRegimeSpec = {
  code: 'LGPD-BR',
  country: 'BR',
  citation: 'Lei nº 13.709/2018 art.18-22',
  authority: 'ANPD',
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
  responseDeadlineDays: 15,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 12,
  dpiaRequired: true,
  breachNotificationDeadlineHours: null,
  recordOfProcessingRequired: true,
};
