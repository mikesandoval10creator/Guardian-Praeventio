// Praeventio Guard — Sprint 31 Bucket MM.
//
// Ley 19.628 (Chile) "Sobre Protección de la Vida Privada", modificada
// por Ley 21.719 (2024) — "Ley de Datos Personales". La modernización
// 2024 acerca el régimen al GDPR pero conserva diferencias:
//
//   - Derechos ARCO: acceso, rectificación, cancelación (erasure),
//     oposición. Ley 21.719 agrega portabilidad, no decisión automatizada
//     y revocación del consentimiento.
//   - Plazo respuesta: 30 días corridos (art.16 Ley 21.719). El régimen
//     19.628 original no tenía plazo explícito; usamos el plazo nuevo.
//   - Edad de consentimiento: 14 años (Ley 21.719 art.18; menores
//     requieren consentimiento del representante legal).
//   - DPIA: la nueva ley introduce la "Evaluación de Impacto en
//     Protección de Datos" (EIPD) cuando hay alto riesgo. Para datos
//     ocupacionales (sensibles) → marcamos `true`.
//   - Notificación de brecha: 72 horas. Ley 21.719 (plena vigencia
//     01-12-2026) introduce el deber de notificar a la Agencia de
//     Protección de Datos Personales "sin dilaciones indebidas" desde que
//     el responsable/encargado toma conocimiento, y a los titulares cuando
//     hay alto riesgo para sus derechos. Adoptamos 72h como cap operacional
//     — alineado con el estándar GDPR-equivalente al que converge la
//     reforma chilena y con el runbook interno de respuesta a incidentes.
//     (Antes se codificaba `null`; era un bug factual que dejaba la app sin
//     reloj de brecha para Chile.)
//     TODO(legal): confirmar con counsel el artículo/plazo exacto del
//     reglamento de la Agencia una vez publicado. Borrador — pendiente
//     revisión legal.
//   - Registro de actividades de tratamiento: lo introduce Ley 21.719
//     art.50 para responsables que tratan datos a gran escala.

import type { PrivacyRegimeSpec } from '../types.js';

export const LEY_19628_CL: PrivacyRegimeSpec = {
  code: 'LEY-19628-CL',
  country: 'CL',
  citation: 'Ley 19.628 (Chile) modificada por Ley 21.719/2024 art.12-22',
  authority: 'Agencia de Protección de Datos Personales (creada Ley 21.719)',
  rights: [
    'access',
    'portability',
    'rectification',
    'erasure',
    'objection',
    'no_automated_decision',
    'consent_withdrawal',
  ],
  responseDeadlineDays: 30,
  dataPortabilityFormat: 'machine_readable',
  consentBaseRequired: true,
  ageOfConsent: 14,
  dpiaRequired: true,
  // 72h breach notification — Ley 21.719 (vigencia 01-12-2026). See header.
  breachNotificationDeadlineHours: 72,
  recordOfProcessingRequired: true,
};
