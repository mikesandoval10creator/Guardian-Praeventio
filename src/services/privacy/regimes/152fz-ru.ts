// Praeventio Guard — Sprint 31 Bucket SS.
//
// Federal Law No. 152-FZ "On Personal Data" (Федеральный закон
// № 152-ФЗ «О персональных данных»), 27 jul 2006, con enmiendas
// significativas en 2014 (data localization) y 2022 (cross-border
// transfer notification).
//
// Notas:
//   - Derechos del sujeto (art.14): acceso, rectificación, eliminación,
//     retiro de consentimiento (art.9.2). No portabilidad explícita,
//     no derechos de decisión automática reconocidos.
//   - Deadline: 30 días para responder solicitudes (art.20).
//   - Edad de consentimiento: 14 años (Civil Code + práctica
//     Roskomnadzor). Menores requieren consentimiento parental.
//   - Breach notification: art.21 — notificación a Roskomnadzor en 24h
//     (preliminar) + 72h (informe completo) tras enmienda 2022.
//   - DATA RESIDENCY CRÍTICO: art.18.5 (enmienda 2014) — los datos
//     personales de ciudadanos rusos DEBEN almacenarse en bases de
//     datos físicamente ubicadas en territorio ruso. La transferencia
//     cross-border exige notificación a Roskomnadzor y consentimiento
//     explícito o "adequacy" del país destino.
//   - Authority: Roskomnadzor (Федеральная служба по надзору в сфере
//     связи, информационных технологий и массовых коммуникаций).

import type { PrivacyRegimeSpec } from '../types.js';

export const FZ_152_RU: PrivacyRegimeSpec = {
  code: '152-FZ-RU',
  country: 'RU',
  citation: 'Federal Law No.152-FZ "On Personal Data" (2006, rev. 2014/2022) art.14, 18.5',
  authority: 'Roskomnadzor (Федеральная служба по надзору в сфере связи)',
  rights: [
    'access',
    'rectification',
    'erasure',
    'consent_withdrawal',
  ],
  responseDeadlineDays: 30,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 14,
  dpiaRequired: false,
  breachNotificationDeadlineHours: 72,
  recordOfProcessingRequired: true,
  dataResidencyRequired: true,
};
