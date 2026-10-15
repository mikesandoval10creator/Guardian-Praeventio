// Shared processing-activity catalog. Keep this module free of server SDK imports.

export interface ProcessingActivity {
  id: string;
  name: string;
  purpose: string;
  legalBasis: string;
  /** ['identidad', 'salud_ocupacional', 'geolocalizacion'] */
  dataCategories: string[];
  /** ['trabajadores', 'supervisores'] */
  dataSubjects: string[];
  /** ['Firebase Firestore', 'Sentry'] — third-party processors. */
  recipients: string[];
  internationalTransfer: boolean;
  /** '7 años post-empleo' */
  retention: string;
  /** ['encryption_at_rest', 'KMS_envelope'] */
  technicalMeasures: string[];
}

export const PROCESSING_ACTIVITIES: ProcessingActivity[] = [
  {
    id: 'core_safety_data',
    name: 'Datos de seguridad y salud ocupacional',
    purpose: 'Cumplimiento Ley 16.744 + DS 594 + DS 109',
    legalBasis: 'Obligación legal (Ley 16.744)',
    dataCategories: [
      'identidad',
      'salud_ocupacional',
      'datos_laborales',
      'incidentes',
    ],
    dataSubjects: ['trabajadores', 'supervisores', 'prevencionistas'],
    recipients: [
      'Firebase Firestore',
      'SUSESO (cuando exista obligación de reporte)',
      'Mutualidad (Ley 16.744)',
    ],
    internationalTransfer: true, // Firestore us-central1
    retention: '7 años post-empleo (DS 594)',
    technicalMeasures: [
      'encryption_at_rest',
      'KMS_envelope',
      'access_audit_logs',
      'tenant_isolation',
    ],
  },
  {
    id: 'geolocation_telemetry',
    name: 'Geolocalización en faena',
    purpose:
      'Detección de accidentes (SOS), trayecto laboral (Ley 16.744 art. 5°), zonas de exclusión',
    legalBasis: 'Interés legítimo + consentimiento (commute mode)',
    dataCategories: ['geolocalizacion', 'telemetría_dispositivo'],
    dataSubjects: ['trabajadores en terreno'],
    recipients: ['Firebase Firestore', 'Google Maps API'],
    internationalTransfer: true,
    retention: '90 días para telemetría continua, indefinido para alertas SOS',
    technicalMeasures: [
      'encryption_at_rest',
      'tenant_isolation',
      'opt_in_per_session',
    ],
  },
  {
    id: 'identity_authentication',
    name: 'Identidad y autenticación',
    purpose: 'Acceso a la plataforma, MFA, recuperación de cuenta',
    legalBasis: 'Ejecución de contrato',
    dataCategories: ['identidad', 'credenciales', 'datos_dispositivo'],
    dataSubjects: ['usuarios registrados'],
    recipients: ['Firebase Auth', 'Resend (correo transaccional)'],
    internationalTransfer: true,
    retention: 'Mientras la cuenta esté activa + 90 días',
    technicalMeasures: [
      'webauthn_passkeys',
      'mfa_totp',
      'session_rotation',
      'rate_limiting',
    ],
  },
  {
    id: 'gamification_engagement',
    name: 'Gamificación y métricas de uso',
    purpose: 'XP positivo, medallas, cuadrillas, leaderboards opt-in',
    legalBasis: 'Consentimiento (analytics + research_anonymized)',
    dataCategories: ['metricas_uso', 'identificadores_pseudonimizados'],
    dataSubjects: ['trabajadores que aceptan gamificación'],
    recipients: ['Firebase Firestore'],
    internationalTransfer: true,
    retention: '24 meses para datos identificables, indefinido para agregados anónimos',
    technicalMeasures: ['pseudonymization', 'aggregation_for_research'],
  },
  {
    id: 'billing_subscription',
    name: 'Facturación y suscripción',
    purpose: 'Cobro de planes (Khipu, Webpay, Google Play, MercadoPago)',
    legalBasis: 'Ejecución de contrato',
    dataCategories: ['datos_facturación', 'identidad_tributaria_RUT'],
    dataSubjects: ['titulares de cuenta'],
    recipients: ['Khipu', 'Transbank Webpay', 'Google Play', 'MercadoPago', 'SII'],
    internationalTransfer: false, // Pagos locales chilenos
    retention: '6 años (Código Tributario art. 17)',
    technicalMeasures: [
      'no_card_storage',
      'tokenization_via_provider',
      'idempotency_keys',
      'pci_dss_scope_minimization',
    ],
  },
  {
    id: 'observability_errors',
    name: 'Observabilidad y errores de aplicación',
    purpose: 'Monitoreo de errores, performance, debugging',
    legalBasis: 'Interés legítimo (seguridad de la información)',
    dataCategories: ['logs_aplicacion', 'identificadores_pseudonimizados'],
    dataSubjects: ['todos los usuarios'],
    recipients: ['Sentry', 'Google Cloud Logging'],
    internationalTransfer: true,
    retention: '90 días',
    technicalMeasures: ['pii_redaction', 'sample_rate_throttling'],
  },
];
