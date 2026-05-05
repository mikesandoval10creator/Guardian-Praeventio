// Praeventio Guard — Sprint 23 Bucket FF.
//
// Compliance service for **Ley 19.628 sobre Protección de la Vida Privada**
// (Chile, modificada por Ley 21.719 — "Ley de Datos Personales" 2024). The
// surface mirrors the GDPR data-subject rights (Article 15–22) so the same
// machinery covers tenants who eventually fall under EU jurisdiction or
// expect parity with their international counterparts:
//
//   • Consent recording + revocation per finalidad (purpose).
//   • Registro de Actividades de Tratamiento (RAT, Article 30 GDPR equiv.).
//   • Data-subject access / rectification / erasure / portability requests.
//
// Architectural note — Firestore is injected through `MinimalComplianceDb`
// (the same pattern used by `assertProjectMember`). This keeps the unit
// tests deterministic and free of `firebase-admin` coupling. The production
// caller (`src/server/routes/compliance.ts`) injects `admin.firestore()`.
//
// Retention nuance — eraseUserData(uid, { keepLegalRecords: true }) preserves
// `audit_logs/*` and any `incidents/*` row referencing the uid because Ley
// 16.744 + DS 594 require a 7-year retention window for occupational-safety
// records. Erasure of those rows would break the SUSESO oversight contract
// and is therefore explicitly opt-in (default: keep legal records).

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsentPurpose =
  | 'core_service'
  | 'analytics'
  | 'marketing'
  | 'research_anonymized';

export type LegalBasis =
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'vital_interest'
  | 'public_task'
  | 'legitimate_interest';

export interface ConsentRecord {
  uid: string;
  purpose: ConsentPurpose;
  granted: boolean;
  grantedAt: number;
  revokedAt?: number;
  legalBasis: LegalBasis;
  /** "consent_v1.0" — pin so we can prove what text the user agreed to. */
  textVersion: string;
}

export type DataAccessRequestType =
  | 'access'
  | 'rectification'
  | 'erasure'
  | 'portability';

export type DataAccessRequestStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'rejected';

export interface DataAccessRequest {
  id: string;
  uid: string;
  type: DataAccessRequestType;
  status: DataAccessRequestStatus;
  requestedAt: number;
  completedAt?: number;
  /** Signed URL to the .json/.zip export. Set on `completed` only. */
  exportedToUrl?: string;
  /** Optional payload for rectification requests (field → new value). */
  rectificationPayload?: Record<string, unknown>;
  /** Optional reason for rejection. */
  rejectionReason?: string;
}

/**
 * Registro de Actividades de Tratamiento — Article 30 GDPR equivalent.
 *
 * The catalog is exposed publicly via GET /api/compliance/processing-activities
 * so any data subject (or a SERNAC inspector) can audit what we do with their
 * personal data without a formal access request.
 */
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

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * Internal RAT — catálogo de actividades de tratamiento.
 *
 * IDs are stable so they can be referenced from external compliance
 * documents without breaking when the human-readable name changes.
 */
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

// ---------------------------------------------------------------------------
// MinimalDb — injected for testability
// ---------------------------------------------------------------------------

/**
 * Subset of `admin.firestore.Firestore` we actually consume. Mirrors the
 * shape used by `assertProjectMember` so tests can build a tiny in-memory
 * fake without pulling in `firebase-admin`.
 */
export interface MinimalDocSnap {
  exists: boolean;
  id: string;
  data(): any;
}

export interface MinimalQuerySnap {
  empty: boolean;
  docs: MinimalDocSnap[];
}

export interface MinimalDocRef {
  id: string;
  get(): Promise<MinimalDocSnap>;
  set(data: any, options?: { merge?: boolean }): Promise<void>;
  update(data: any): Promise<void>;
  delete(): Promise<void>;
}

export interface MinimalCollectionRef {
  doc(id?: string): MinimalDocRef;
  add(data: any): Promise<MinimalDocRef>;
  get(): Promise<MinimalQuerySnap>;
  where(field: string, op: string, value: any): MinimalCollectionRef;
}

export interface MinimalComplianceDb {
  collection(name: string): MinimalCollectionRef;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ComplianceError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'ComplianceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Collection paths
// ---------------------------------------------------------------------------

const CONSENTS_COLLECTION = 'compliance_consents';
const REQUESTS_COLLECTION = 'compliance_data_requests';

function consentDocId(uid: string, purpose: ConsentPurpose): string {
  return `${uid}__${purpose}`;
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export async function recordConsent(
  db: MinimalComplianceDb,
  record: Omit<ConsentRecord, 'grantedAt'> & { grantedAt?: number },
): Promise<ConsentRecord> {
  if (!record.uid || record.uid.length === 0) {
    throw new ComplianceError('invalid_uid', 'uid is required', 400);
  }
  const persisted: ConsentRecord = {
    uid: record.uid,
    purpose: record.purpose,
    granted: record.granted,
    legalBasis: record.legalBasis,
    textVersion: record.textVersion,
    grantedAt: record.grantedAt ?? Date.now(),
  };
  await db
    .collection(CONSENTS_COLLECTION)
    .doc(consentDocId(record.uid, record.purpose))
    .set(persisted, { merge: true });
  return persisted;
}

export async function revokeConsent(
  db: MinimalComplianceDb,
  uid: string,
  purpose: ConsentPurpose,
): Promise<void> {
  if (purpose === 'core_service') {
    // core_service is required to operate the platform — revoking it is
    // semantically the same as account deletion. Force the user through
    // the eraseUserData flow instead of silently breaking the app.
    throw new ComplianceError(
      'core_consent_required',
      'core_service consent cannot be revoked without account erasure. Use the erasure request flow.',
      409,
    );
  }
  const ref = db
    .collection(CONSENTS_COLLECTION)
    .doc(consentDocId(uid, purpose));
  const snap = await ref.get();
  if (!snap.exists) {
    // Nothing to revoke — a fresh user revoking a consent they never gave.
    // Treat as idempotent success.
    return;
  }
  await ref.update({ granted: false, revokedAt: Date.now() });
}

export async function getConsentStatus(
  db: MinimalComplianceDb,
  uid: string,
): Promise<Record<string, ConsentRecord>> {
  const snap = await db
    .collection(CONSENTS_COLLECTION)
    .where('uid', '==', uid)
    .get();
  const out: Record<string, ConsentRecord> = {};
  for (const doc of snap.docs) {
    const data = doc.data() as ConsentRecord;
    if (data && data.purpose) {
      out[data.purpose] = data;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data-subject requests
// ---------------------------------------------------------------------------

export async function requestDataAccess(
  db: MinimalComplianceDb,
  uid: string,
  type: DataAccessRequestType,
  extras?: { rectificationPayload?: Record<string, unknown> },
): Promise<DataAccessRequest> {
  if (!uid) {
    throw new ComplianceError('invalid_uid', 'uid is required', 400);
  }
  const allowed: DataAccessRequestType[] = [
    'access',
    'rectification',
    'erasure',
    'portability',
  ];
  if (!allowed.includes(type)) {
    throw new ComplianceError('invalid_type', `Unsupported request type: ${type}`, 400);
  }
  const payload: Record<string, unknown> = {
    uid,
    type,
    status: 'pending' as DataAccessRequestStatus,
    requestedAt: Date.now(),
  };
  if (extras?.rectificationPayload !== undefined) {
    payload.rectificationPayload = extras.rectificationPayload;
  }
  const ref = await db.collection(REQUESTS_COLLECTION).add(payload);
  const snap = await ref.get();
  const data = snap.data() as Omit<DataAccessRequest, 'id'>;
  return { id: snap.id, ...data };
}

export async function getDataAccessRequest(
  db: MinimalComplianceDb,
  requestId: string,
): Promise<DataAccessRequest | null> {
  const snap = await db.collection(REQUESTS_COLLECTION).doc(requestId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Omit<DataAccessRequest, 'id'>;
  return { id: snap.id, ...data };
}

/**
 * Wired by a background worker. Marks the row as `processing` and
 * dispatches to the appropriate handler. Idempotent — a second call on a
 * `completed` row is a no-op.
 */
export async function processDataAccessRequest(
  db: MinimalComplianceDb,
  requestId: string,
  handlers: {
    onExport?: (req: DataAccessRequest) => Promise<{ downloadUrl: string }>;
    onErase?: (req: DataAccessRequest) => Promise<void>;
    onRectify?: (req: DataAccessRequest) => Promise<void>;
  } = {},
): Promise<DataAccessRequest> {
  const ref = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ComplianceError('not_found', 'Request not found', 404);
  }
  const current = { id: snap.id, ...(snap.data() as Omit<DataAccessRequest, 'id'>) };
  if (current.status === 'completed') {
    return current;
  }
  await ref.update({ status: 'processing' as DataAccessRequestStatus });

  let exportedToUrl: string | undefined;
  try {
    if ((current.type === 'access' || current.type === 'portability') && handlers.onExport) {
      const result = await handlers.onExport(current);
      exportedToUrl = result.downloadUrl;
    } else if (current.type === 'erasure' && handlers.onErase) {
      await handlers.onErase(current);
    } else if (current.type === 'rectification' && handlers.onRectify) {
      await handlers.onRectify(current);
    }
    const finalPatch: Partial<DataAccessRequest> = {
      status: 'completed',
      completedAt: Date.now(),
    };
    if (exportedToUrl) finalPatch.exportedToUrl = exportedToUrl;
    await ref.update(finalPatch);
    return { ...current, ...finalPatch };
  } catch (err) {
    await ref.update({
      status: 'rejected' as DataAccessRequestStatus,
      completedAt: Date.now(),
      rejectionReason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Export / erasure
// ---------------------------------------------------------------------------

/**
 * Collections we walk to assemble the user's data export. Each entry
 * contains a Firestore field that holds the user's uid; we use a `where`
 * filter so we never read another tenant's data, even by accident.
 */
const EXPORTABLE_COLLECTIONS: { name: string; uidField: string }[] = [
  { name: 'users', uidField: 'uid' },
  { name: 'compliance_consents', uidField: 'uid' },
  { name: 'compliance_data_requests', uidField: 'uid' },
  { name: 'curriculum_claims', uidField: 'uid' },
  { name: 'gamification_xp', uidField: 'uid' },
  { name: 'commute_sessions', uidField: 'uid' },
  { name: 'notifications', uidField: 'recipientUid' },
];

/**
 * Collections preserved when `keepLegalRecords: true` (default). Driven by
 * Ley 16.744 / DS 594 obligations — we cannot lose audit and incident
 * trails for 7 years post-event.
 */
const LEGAL_RETENTION_COLLECTIONS = ['audit_logs', 'incidents', 'sos_alerts'];

export async function exportUserData(
  db: MinimalComplianceDb,
  uid: string,
): Promise<{ data: Record<string, unknown[]>; exportedAt: number; uid: string }> {
  if (!uid) {
    throw new ComplianceError('invalid_uid', 'uid is required', 400);
  }
  const data: Record<string, unknown[]> = {};
  for (const { name, uidField } of EXPORTABLE_COLLECTIONS) {
    try {
      const snap = await db.collection(name).where(uidField, '==', uid).get();
      const rows: unknown[] = [];
      for (const doc of snap.docs) {
        const docData = doc.data();
        // Belt-and-braces: never include a row whose uid mismatches.
        // If a future caller forgets the .where filter, this still
        // protects against cross-tenant leak.
        if (docData?.[uidField] === uid) {
          rows.push({ id: doc.id, ...docData });
        }
      }
      data[name] = rows;
    } catch {
      // Missing collection → skip, do not abort the whole export.
      data[name] = [];
    }
  }
  return { data, exportedAt: Date.now(), uid };
}

export async function eraseUserData(
  db: MinimalComplianceDb,
  uid: string,
  options: { keepLegalRecords?: boolean } = {},
): Promise<{ erased: string[]; preserved: string[] }> {
  if (!uid) {
    throw new ComplianceError('invalid_uid', 'uid is required', 400);
  }
  const keepLegal = options.keepLegalRecords ?? true;
  const erased: string[] = [];
  const preserved: string[] = [];

  for (const { name, uidField } of EXPORTABLE_COLLECTIONS) {
    try {
      const snap = await db.collection(name).where(uidField, '==', uid).get();
      let count = 0;
      for (const doc of snap.docs) {
        await db.collection(name).doc(doc.id).delete();
        count += 1;
      }
      if (count > 0) erased.push(`${name}:${count}`);
    } catch {
      // ignore missing collection
    }
  }

  if (keepLegal) {
    for (const collection of LEGAL_RETENTION_COLLECTIONS) {
      preserved.push(collection);
    }
  } else {
    for (const collection of LEGAL_RETENTION_COLLECTIONS) {
      try {
        // Audit / incident rows index uid as `userId` (audit_logs) or
        // `reporterUid` (incidents). Try both.
        for (const field of ['userId', 'reporterUid', 'workerUid', 'uid']) {
          const snap = await db.collection(collection).where(field, '==', uid).get();
          for (const doc of snap.docs) {
            await db.collection(collection).doc(doc.id).delete();
          }
        }
        erased.push(`${collection}:legal_purged`);
      } catch {
        // ignore
      }
    }
  }

  return { erased, preserved };
}

// ---------------------------------------------------------------------------
// RAT helpers
// ---------------------------------------------------------------------------

export function getProcessingActivities(): ProcessingActivity[] {
  return PROCESSING_ACTIVITIES;
}

export function findProcessingActivity(
  id: string,
): ProcessingActivity | undefined {
  return PROCESSING_ACTIVITIES.find((a) => a.id === id);
}
