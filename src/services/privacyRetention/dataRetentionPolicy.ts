// Praeventio Guard — Sprint 44 §125-128: Política de retención + consent
// + separación PII médica.
//
// Cierra §125 (retención), §126 (consentimiento explícito), §127 (datos
// médicos separados) y §128 (privacy by design) de la 2da tanda usuario.
//
// 100% determinístico. El motor decide:
//   - Si un registro debe ser retenido, archivado o purgado dado su edad
//     + categoría + jurisdicción.
//   - Si un consent específico está vigente.
//   - Qué nivel de redacción aplicar al exportar un registro.
//
// Reusa shapes existentes de F.18 (`redactPII`).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type DataCategory =
  | 'incident'
  | 'medical_aptitude'
  | 'medical_diagnosis'
  | 'training_record'
  | 'epp_assignment'
  | 'attendance'
  | 'audit_log'
  | 'sensor_telemetry'
  | 'consent_artifact'
  | 'communication_log'
  | 'document_version';

export type Jurisdiction =
  | 'CL' // Chile Ley 19.628 + 21.719
  | 'AR'
  | 'PE'
  | 'MX'
  | 'BR' // LGPD
  | 'US' // mostly state-specific
  | 'EU' // GDPR
  | 'UK'
  | 'CA'
  | 'AU';

export type RetentionAction = 'keep_active' | 'archive_immutable' | 'purge';

export interface RetentionRule {
  category: DataCategory;
  jurisdiction: Jurisdiction;
  /** Días que se mantiene activo (consultable + editable). */
  activeDays: number;
  /** Días totales antes de purga (typically > activeDays). */
  totalDays: number;
}

export interface DataRecord {
  id: string;
  category: DataCategory;
  jurisdiction: Jurisdiction;
  createdAt: string;
  /** Si hay una orden legal de hold (audit en curso, juicio) — bloquea purga. */
  legalHold?: boolean;
  /** Override manual (caller explicitly extends). */
  retentionOverrideDays?: number;
}

export interface RetentionDecision {
  recordId: string;
  action: RetentionAction;
  rationale: string;
  daysAge: number;
  effectiveRetentionDays: number;
  blockedByLegalHold: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Retention rules — defaults per (category, jurisdiction)
// ────────────────────────────────────────────────────────────────────────

// Pesos en días. Estos números reflejan obligaciones legales razonables
// (Chile DS 6 REAS / Ley 19.628 / Ley 21.719; UE GDPR storage limitation;
// Brazil LGPD; USA HIPAA-like 6yr). El caller puede override vía
// `customRules`.
const DEFAULT_RULES: RetentionRule[] = [
  // Incidente: 5 años activo, 10 archivado (Ley 16.744 + DS 6 REAS).
  { category: 'incident', jurisdiction: 'CL', activeDays: 1825, totalDays: 3650 },
  { category: 'incident', jurisdiction: 'EU', activeDays: 1825, totalDays: 3650 },
  // Aptitud médica: durante empleo + 30 años post término (sílice, asbesto)
  // → simplificamos a 10950 días (30 años) post createdAt.
  { category: 'medical_aptitude', jurisdiction: 'CL', activeDays: 3650, totalDays: 10950 },
  // Diagnóstico médico: alta sensibilidad, retención mínima estricta.
  // 5 años activo, total 10 años; nunca expuesto cross-tenant.
  { category: 'medical_diagnosis', jurisdiction: 'CL', activeDays: 1825, totalDays: 3650 },
  { category: 'medical_diagnosis', jurisdiction: 'EU', activeDays: 1825, totalDays: 3650 },
  // Training: durante vigencia + 2 años post.
  { category: 'training_record', jurisdiction: 'CL', activeDays: 1095, totalDays: 1825 },
  // EPP assignment: 3 años.
  { category: 'epp_assignment', jurisdiction: 'CL', activeDays: 365, totalDays: 1095 },
  // Attendance: 1 año activo, 3 archivado.
  { category: 'attendance', jurisdiction: 'CL', activeDays: 365, totalDays: 1095 },
  // Audit log: 7 años activo (auditoría externa puede llegar después).
  { category: 'audit_log', jurisdiction: 'CL', activeDays: 2555, totalDays: 3650 },
  // Sensor telemetry: 90d activo, 365 archivado (no es legalmente exigido).
  { category: 'sensor_telemetry', jurisdiction: 'CL', activeDays: 90, totalDays: 365 },
  // Consent artifact: durante todo el tratamiento + 5 años post revocación.
  { category: 'consent_artifact', jurisdiction: 'CL', activeDays: 9999, totalDays: 9999 },
  // Comunicaciones (mensajes operativos): 90d/180d.
  { category: 'communication_log', jurisdiction: 'CL', activeDays: 90, totalDays: 180 },
  // Versionado documentos: durante vigencia + 5 años (RIOHS, ODI).
  { category: 'document_version', jurisdiction: 'CL', activeDays: 1825, totalDays: 3650 },
];

function findRule(
  category: DataCategory,
  jurisdiction: Jurisdiction,
  customRules?: ReadonlyArray<RetentionRule>,
): RetentionRule | null {
  const all = [...(customRules ?? []), ...DEFAULT_RULES];
  const exact = all.find((r) => r.category === category && r.jurisdiction === jurisdiction);
  if (exact) return exact;
  // Fallback a CL para jurisdicciones sin override (válido para LATAM
  // típicamente).
  return all.find((r) => r.category === category && r.jurisdiction === 'CL') ?? null;
}

// ────────────────────────────────────────────────────────────────────────
// Decision engine
// ────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export interface DecideOptions {
  now?: Date;
  customRules?: ReadonlyArray<RetentionRule>;
}

export function decideRetention(
  record: DataRecord,
  options: DecideOptions = {},
): RetentionDecision {
  const now = options.now ?? new Date();
  const ageMs = now.getTime() - Date.parse(record.createdAt);
  const daysAge = Math.max(0, Math.floor(ageMs / DAY_MS));

  const rule = findRule(record.category, record.jurisdiction, options.customRules);

  // Sin regla → mantener activo (no purgar por accidente).
  if (!rule) {
    return {
      recordId: record.id,
      action: 'keep_active',
      rationale: 'Sin regla — política conservadora: mantener activo.',
      daysAge,
      effectiveRetentionDays: Infinity,
      blockedByLegalHold: !!record.legalHold,
    };
  }

  const effectiveTotal =
    rule.totalDays + (record.retentionOverrideDays ?? 0);

  let action: RetentionAction;
  let rationale: string;

  if (daysAge < rule.activeDays) {
    action = 'keep_active';
    rationale = `Dentro de ventana activa (${rule.activeDays}d) para ${record.category}/${record.jurisdiction}.`;
  } else if (daysAge < effectiveTotal) {
    action = 'archive_immutable';
    rationale = `Fuera de ventana activa pero dentro de ventana total (${effectiveTotal}d) — archivar inmutable.`;
  } else {
    action = 'purge';
    rationale = `Fuera de ventana total (${effectiveTotal}d) — elegible para purga.`;
  }

  // Legal hold bloquea toda purga.
  if (record.legalHold && action === 'purge') {
    return {
      recordId: record.id,
      action: 'archive_immutable',
      rationale: 'Legal hold activo — purga bloqueada, mantener archivado.',
      daysAge,
      effectiveRetentionDays: effectiveTotal,
      blockedByLegalHold: true,
    };
  }

  return {
    recordId: record.id,
    action,
    rationale,
    daysAge,
    effectiveRetentionDays: effectiveTotal,
    blockedByLegalHold: !!record.legalHold,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Consent
// ────────────────────────────────────────────────────────────────────────

export type ConsentPurpose =
  | 'data_processing_basic'
  | 'medical_data_share_mutual'
  | 'biometric_authentication'
  | 'photo_evidence_capture'
  | 'gps_location_tracking'
  | 'analytics_telemetry'
  | 'marketing_communications';

export interface ConsentArtifact {
  subjectUid: string;
  purpose: ConsentPurpose;
  /** ISO-8601 cuando se otorgó. */
  grantedAt: string;
  /** ISO-8601 si fue revocado. */
  revokedAt?: string;
  /** Versión del texto legal aceptado. */
  legalTextVersion: string;
  /** Si fue obtenido vía huella/biometric. */
  signatureMethod: 'webauthn' | 'biometric' | 'click_through' | 'paper_then_uploaded';
}

export interface ConsentCheck {
  granted: boolean;
  revoked: boolean;
  /** Si está en grace period (consentimiento previo expiró pero renovación pendiente). */
  gracePeriod?: boolean;
  rationale: string;
}

export interface CheckConsentOptions {
  now?: Date;
  /** Si la versión del texto legal cambió → consent considerada caducada. */
  currentLegalTextVersion: string;
  /** Grace period en días tras cambio de texto antes de bloquear. */
  graceDays?: number;
}

export function checkConsent(
  artifact: ConsentArtifact | null,
  options: CheckConsentOptions,
): ConsentCheck {
  if (!artifact) {
    return { granted: false, revoked: false, rationale: 'No hay consentimiento registrado.' };
  }
  const now = options.now ?? new Date();
  if (artifact.revokedAt && Date.parse(artifact.revokedAt) <= now.getTime()) {
    return {
      granted: false,
      revoked: true,
      rationale: `Consentimiento revocado el ${artifact.revokedAt}.`,
    };
  }
  if (artifact.legalTextVersion !== options.currentLegalTextVersion) {
    const graceDays = options.graceDays ?? 14;
    const graceEnd = Date.parse(artifact.grantedAt) + graceDays * DAY_MS;
    if (now.getTime() <= graceEnd) {
      return {
        granted: true,
        revoked: false,
        gracePeriod: true,
        rationale: `Texto legal cambió; en grace period ${graceDays}d — solicitar re-consentimiento.`,
      };
    }
    return {
      granted: false,
      revoked: false,
      rationale: 'Texto legal cambió fuera de grace period — re-consentimiento obligatorio.',
    };
  }
  return {
    granted: true,
    revoked: false,
    rationale: 'Consentimiento vigente.',
  };
}

// ────────────────────────────────────────────────────────────────────────
// PII separation (ADR 0012 — medical double-lock)
// ────────────────────────────────────────────────────────────────────────

export type PiiSensitivity = 'public' | 'internal' | 'sensitive' | 'medical';

/**
 * Decide el bucket de Storage / collection donde un registro DEBE vivir
 * según su sensibilidad. ADR 0012: datos médicos NUNCA en buckets de
 * acceso general.
 */
export function piiBucketFor(sensitivity: PiiSensitivity): {
  storagePathPrefix: string;
  firestoreCollectionPrefix: string;
  requiresMedicalRoleClaim: boolean;
} {
  switch (sensitivity) {
    case 'medical':
      return {
        storagePathPrefix: 'medical/',
        firestoreCollectionPrefix: 'tenants_medical/',
        requiresMedicalRoleClaim: true,
      };
    case 'sensitive':
      return {
        storagePathPrefix: 'sensitive/',
        firestoreCollectionPrefix: 'tenants_sensitive/',
        requiresMedicalRoleClaim: false,
      };
    case 'internal':
      return {
        storagePathPrefix: 'internal/',
        firestoreCollectionPrefix: 'tenants/',
        requiresMedicalRoleClaim: false,
      };
    case 'public':
    default:
      return {
        storagePathPrefix: 'public/',
        firestoreCollectionPrefix: 'public/',
        requiresMedicalRoleClaim: false,
      };
  }
}

/**
 * Mapeo canónico DataCategory → PiiSensitivity para que los adapters
 * Firestore enruten al bucket correcto sin re-derivarlo.
 */
export function sensitivityForCategory(c: DataCategory): PiiSensitivity {
  switch (c) {
    case 'medical_aptitude':
    case 'medical_diagnosis':
      return 'medical';
    case 'incident':
    case 'consent_artifact':
    case 'audit_log':
      return 'sensitive';
    case 'training_record':
    case 'epp_assignment':
    case 'attendance':
    case 'document_version':
    case 'communication_log':
      return 'internal';
    case 'sensor_telemetry':
    default:
      return 'internal';
  }
}
