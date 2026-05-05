// Praeventio Guard — Sprint 31 Bucket SS.
//
// PIPL — Personal Information Protection Law of the People's Republic
// of China (《中华人民共和国个人信息保护法》), promulgada 20 ago 2021,
// vigente desde 1 nov 2021.
//
// Notas:
//   - Derechos del sujeto (art.44-50): acceso, copia (portabilidad),
//     rectificación, eliminación, restricción de procesamiento, derecho
//     a no ser objeto de decisión automática (art.24), retiro de
//     consentimiento (art.15).
//   - Deadline: 15 días naturales para responder a solicitudes (CAC
//     guidance art.50 + Implementing Regulations 2024).
//   - Edad de consentimiento: 14 años (art.31). Menores requieren
//     consentimiento parental + documento de procesamiento separado.
//   - Breach notification: art.57 — notificación inmediata al CAC y a
//     los sujetos afectados; sin ventana fija codificada, interpretación
//     "sin demora" (codificamos null).
//   - DATA RESIDENCY CRÍTICO: art.40 + art.38-39 — Critical Information
//     Infrastructure Operators (CIIO) y procesadores que manejen
//     volumen significativo deben almacenar datos en China; cualquier
//     transferencia fuera requiere CAC Security Assessment, certificación
//     o Standard Contract Clauses chinas. Para Praeventio, asumimos
//     `dataResidencyRequired: true` por defecto en tenants chinos.
//   - Authority: Cyberspace Administration of China (CAC, 国家互联网
//     信息办公室).

import type { PrivacyRegimeSpec } from '../types.js';

export const PIPL_CN: PrivacyRegimeSpec = {
  code: 'PIPL-CN',
  country: 'CN',
  citation: 'Personal Information Protection Law of PRC (《个人信息保护法》, 2021) art.44-50',
  authority: 'CAC (Cyberspace Administration of China, 国家互联网信息办公室)',
  rights: [
    'access',
    'portability',
    'rectification',
    'erasure',
    'restriction',
    'no_automated_decision',
    'consent_withdrawal',
  ],
  responseDeadlineDays: 15,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 14,
  dpiaRequired: true,
  breachNotificationDeadlineHours: null,
  recordOfProcessingRequired: true,
  dataResidencyRequired: true,
};
