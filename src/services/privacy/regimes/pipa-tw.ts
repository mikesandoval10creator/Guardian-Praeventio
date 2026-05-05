// Praeventio Guard — Sprint 31 Bucket SS.
//
// Personal Data Protection Act of Taiwan (個人資料保護法, PDPA-TW),
// promulgada 1995 como Computer-Processed Personal Data Protection
// Law, refundida en 2010 como PDPA y enmendada en 2015 y 2023.
//
// Notas:
//   - Derechos del sujeto (art.3): consultar/inspeccionar (acceso),
//     hacer copia, suplementar/corregir (rectificación), suspender/
//     eliminar (erasure), retirar consentimiento.
//   - Deadline: 30 días naturales para responder solicitudes (art.13).
//   - Edad de consentimiento: 7 años para acuerdos limitados, 20 años
//     mayoría legal civil; práctica administrativa pin 18 para PD.
//     Codificamos 18 (operacional).
//   - Breach notification: art.12 — notificación al sujeto "según
//     forma apropiada" tras tomar conocimiento. Sin ventana fija;
//     reforma 2023 endurece a notificación expedita a la autoridad.
//   - Authority: Personal Data Protection Commission (個人資料保護
//     委員會, PDPC), establecida en 2023; antes Ministry of Justice.
//   - Data residency: PDPA permite transferencia cross-border salvo
//     que el National Development Council restrinja a un país
//     concreto. NO obligación general de localización.
//   - Independencia jurisdiccional: Taiwan se trata como jurisdicción
//     completamente separada de PRC; PIPA-TW NO se solapa con PIPL-CN.

import type { PrivacyRegimeSpec } from '../types.js';

export const PIPA_TW: PrivacyRegimeSpec = {
  code: 'PIPA-TW',
  country: 'TW',
  citation: 'Personal Data Protection Act (個人資料保護法, 1995/2010/2023) art.3, 13',
  authority: 'PDPC (Personal Data Protection Commission, 個人資料保護委員會)',
  rights: [
    'access',
    'rectification',
    'erasure',
    'consent_withdrawal',
  ],
  responseDeadlineDays: 30,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 18,
  dpiaRequired: false,
  breachNotificationDeadlineHours: null,
  recordOfProcessingRequired: true,
};
