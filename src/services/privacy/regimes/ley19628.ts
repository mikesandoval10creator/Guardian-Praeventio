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
//   - Notificación de brecha: art.31 Ley 21.719 — "tan pronto como sea
//     posible" sin cap horario explícito (a diferencia del 72h GDPR).
//     Encodeamos `null` honestamente.
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
  breachNotificationDeadlineHours: null,
  recordOfProcessingRequired: true,
};
