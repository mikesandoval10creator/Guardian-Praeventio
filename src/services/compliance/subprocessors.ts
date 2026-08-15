// Praeventio Guard — [P1][privacidad] Sub-procesador list (GDPR art.28).
//
// GDPR art.28 + LGPD + Ley 21.719 obligan al responsable del tratamiento a
// publicar la lista de sub-procesadores (encargados del tratamiento) que
// procesan datos personales en su nombre, con: identidad, país de
// procesamiento, base legal y tipo de dato que reciben.
//
// Esta lista NO incluye proveedores que solo infraestructura de red (CDN,
// monitoring pasivo) sin acceso a contenido. Solo quien procesa datos
// personales del titular.
//
// DATA PROVENANCE (regla dura: nunca fabricar datos legales)
// ────────────────────────────────────────────────────────────────
// Cada entrada fue verificada contra fuente autoritativa:
//   • Firebase / FCM   → firebase.google.com/products/firestore, firebase.google.com/products/cloud-messaging
//   • Google Gemini API → ai.google.dev/terms, ai.google.dev/regions
//   • Resend           → resend.com/legal/sub-processors
//   • Google Cloud KMS → cloud.google.com/kms/docs/locations
// Regiones son las usadas por el proyecto Guardian Praeventio en
// producción. Las regiones de Gemini y KMS son elegibles — el código
// actual deja explícito `us-central1` (Firestore legacy) y permite
// seleccionar la región Gemini vía configuración.
//
// ADR 0021: este endpoint NO es gated por tier — la lista de
// sub-procesadores es un derecho del titular (GDPR art.13.1(e)).
// El rate-limit global de /api/ ya cubre DDoS.

export type SubprocessorCategory =
  | 'datastore'
  | 'auth'
  | 'messaging'
  | 'ai_inference'
  | 'key_management'
  | 'email';

export type SubprocessorRegion =
  | 'us-central1'
  | 'us-east4'
  | 'us'
  | 'us-or-eu';

export interface Subprocessor {
  /** ID estable — sirve para que documentos externos referencien al
   *  sub-procesador sin romperse al cambiar el nombre humano-legible. */
  id: string;
  /** Nombre comercial del sub-procesador. */
  name: string;
  /** Categoría del procesamiento que realiza para Guardian. */
  category: SubprocessorCategory;
  /** País o región de procesamiento declarado por el sub-procesador. */
  region: SubprocessorRegion;
  /** Finalidad del tratamiento (art. 28.3.a GDPR). */
  purpose: string;
  /** Tipos de datos personales que el sub-procesador recibe. */
  dataCategories: string[];
  /** Base legal de la transferencia (GDPR art.46 / LGPD art.33). */
  legalBasis: string;
  /** Enlace al DPA / Terms of Service del sub-procesador. */
  dpaUrl: string;
  /** Fecha de la última revisión de cumplimiento del sub-procesador
   *  por parte de Guardian. */
  lastReviewedAt: string;
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    id: 'firebase-firestore',
    name: 'Firebase Firestore (Google Cloud)',
    category: 'datastore',
    region: 'us-central1',
    purpose: 'Persistencia de datos personales: trabajadores, proyectos, incidentes.',
    dataCategories: ['identidad', 'datos_laborales', 'salud_ocupacional', 'incidentes', 'geolocalizacion'],
    legalBasis: 'Google Cloud DPA + Data Processing Addendum; transferencia intragrupo Google.',
    dpaUrl: 'https://cloud.google.com/terms/data-processing-addendum',
    lastReviewedAt: '2026-08-14',
  },
  {
    id: 'firebase-auth',
    name: 'Firebase Authentication (Google Cloud)',
    category: 'auth',
    region: 'us-central1',
    purpose: 'Identidad del titular: passkeys (WebAuthn), credenciales, MFA TOTP.',
    dataCategories: ['identidad', 'credenciales'],
    legalBasis: 'Google Cloud DPA; Firebase Auth ToS sección "Data processing".',
    dpaUrl: 'https://firebase.google.com/terms/auth-terms',
    lastReviewedAt: '2026-08-14',
  },
  {
    id: 'firebase-cloud-messaging',
    name: 'Firebase Cloud Messaging (FCM)',
    category: 'messaging',
    region: 'us-central1',
    purpose: 'Envío de push notifications al dispositivo del titular (FCM device token).',
    dataCategories: ['identificadores_pseudonimizados', 'datos_dispositivo'],
    legalBasis: 'Firebase Cloud Messaging ToS; Google Cloud DPA aplica.',
    dpaUrl: 'https://firebase.google.com/terms/cloud-messaging',
    lastReviewedAt: '2026-08-14',
  },
  {
    id: 'google-gemini-api',
    name: 'Google Gemini API (Vertex AI / ai.google.dev)',
    category: 'ai_inference',
    region: 'us-or-eu',
    purpose:
      'Inferencia multimodal: lectura de fotos EPP del trabajador, OCR de documentos, análisis de incidentes.',
    dataCategories: ['imagenes_personales', 'documentos_personales', 'incidentes'],
    legalBasis:
      'Google Cloud Vertex AI DPA; configuración regional permite seleccionar residencia US o EU según el tenant.',
    dpaUrl: 'https://ai.google.dev/terms',
    lastReviewedAt: '2026-08-14',
  },
  {
    id: 'google-cloud-kms',
    name: 'Google Cloud KMS',
    category: 'key_management',
    region: 'us-central1',
    purpose:
      'Custodia de claves de encriptación envelope (KMS_envelope) para campos PII sensibles (RUT, datos de salud).',
    dataCategories: ['metadata_claves', 'no_pii_directa'],
    legalBasis: 'Google Cloud DPA; las claves nunca salen de la región sin rotación explícita.',
    dpaUrl: 'https://cloud.google.com/kms/docs/security',
    lastReviewedAt: '2026-08-14',
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'email',
    region: 'us-east4',
    purpose:
      'Email transaccional: recuperación de cuenta, alertas críticas de seguridad al titular.',
    dataCategories: ['email', 'nombres'],
    legalBasis: 'Resend DPA (Data Processing Addendum v3.0); sub-procesadores propios de Resend en su página.',
    dpaUrl: 'https://resend.com/legal/sub-processors',
    lastReviewedAt: '2026-08-14',
  },
];
