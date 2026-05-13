// Praeventio Guard — Sprint 43 Fase F.3: Paquete de Evidencia por Incidente.
//
// Cierra Plan F.3 "Paquete de Evidencia por Incidente (expediente
// automático)". Trigger conceptual: al crear/cerrar un NodeType.INCIDENT,
// el orchestrator recopila TODO lo relacionado al incidente para armar
// un expediente único que un fiscalizador / abogado / SUSESO pueda
// revisar de un vistazo.
//
// 100% determinístico, sin I/O. El caller hace las queries Firestore
// (o las inyecta como fixtures en tests) y este servicio:
//   1. Valida que el incidente tenga los datos mínimos requeridos.
//   2. Resuelve linkages: trabajadores afectados, EPP que debían usar,
//      training previo, controles que existían, normativa aplicable,
//      condiciones climáticas, audit_log del momento.
//   3. Calcula score de completitud (qué falta).
//   4. Produce manifest serializable que el caller persiste o exporta
//      a PDF (futura fase).
//
// Reusa modelos existentes:
//   - photoEvidenceEngine.EvidenceArtifact (fotos / videos)
//   - evidenceChain.CustodyEvent (custody chain)
//   - rootCauseClassifier.RootCauseResult (causa raíz si ya analizado)
//
// NO depende de Firestore ni Storage — el caller los inyecta como
// input.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical' | 'sif';

export interface IncidentCore {
  id: string;
  projectId: string;
  occurredAt: string;
  severity: IncidentSeverity;
  /** Resumen redactado (sin PII de víctimas). */
  summary: string;
  /** Coords opcionales del incidente. */
  location?: { lat: number; lng: number };
  reportedByUid: string;
  reportedAt: string;
}

export interface AffectedWorker {
  uid: string;
  /** Rol en el momento del incidente (operador, supervisor, contratista, visitante). */
  role: string;
  /** Categoría de la consecuencia. */
  outcome: 'unhurt' | 'first_aid' | 'medical_attention' | 'lost_time' | 'fatality';
  /** Si la víctima requirió SUSESO DIAT/DIEP. */
  requiresDiat?: boolean;
}

export interface EvidenceItem {
  /** SHA-256 hex (content-addressed). */
  hash: string;
  kind: 'photo' | 'video' | 'document_pdf' | 'audio' | 'declaration' | 'measurement_data';
  mimeType: string;
  byteSize: number;
  capturedAt: string;
  capturedByUid: string;
  storageUrl?: string;
  notes?: string;
}

export interface AppliedControl {
  /** ID del control crítico en la biblioteca. */
  controlId: string;
  /** Si el control estaba ACTIVO al momento del incidente. */
  wasActive: boolean;
  /** Última verificación previa al incidente. */
  lastVerifiedAt?: string;
  /** Si falló, modo de falla. */
  failureMode?: 'no_disponible' | 'no_usado' | 'no_adecuado' | 'no_mantenido' | 'no_entendido' | 'no_supervisado';
}

export interface RequiredEppPresence {
  eppId: string;
  /** Si el trabajador afectado lo tenía vigente. */
  hadValid: boolean;
  expirationDate?: string;
}

export interface TrainingPresence {
  trainingId: string;
  /** Si el trabajador afectado había hecho el training. */
  hadCompleted: boolean;
  completedAt?: string;
  /** Vigencia del training (algunos vencen). */
  expiresAt?: string;
}

export interface NormativeReference {
  /** Código corto (DS 594, Ley 16.744, ISO 45001 cl 8.2, etc.). */
  code: string;
  /** Artículo / cláusula específica. */
  clause?: string;
  /** Resumen aplicable. */
  summary: string;
}

export interface EnvironmentalContext {
  /** Clima al momento (de Open-Meteo o lectura manual). */
  weather?: {
    temperatureC?: number;
    windKph?: number;
    precipitationMm?: number;
    visibility?: 'good' | 'reduced' | 'poor';
  };
  /** Lectura de sensor relevante (gas, ruido, polvo, etc.). */
  sensorReadings?: Array<{ kind: string; value: number; unit: string }>;
}

export interface RootCauseSummary {
  /** Si ya hubo análisis de causa raíz formal. */
  analyzed: boolean;
  primaryCauseKind?: string;
  contributingFactors?: string[];
  /** Si quedó pendiente, owner + due date. */
  pendingOwnerUid?: string;
  pendingDueDate?: string;
}

export interface AuditLogEntry {
  at: string;
  actorUid: string;
  actorRole: string;
  action: string;
  /** Snapshot del estado del nodo si aplica. */
  context?: Record<string, unknown>;
}

/**
 * Input al orchestrator: caller lo construye consultando sus collections.
 */
export interface BuildIncidentBundleInput {
  incident: IncidentCore;
  affectedWorkers: AffectedWorker[];
  evidence: EvidenceItem[];
  appliedControls: AppliedControl[];
  requiredEpp: RequiredEppPresence[];
  requiredTrainings: TrainingPresence[];
  normativeRefs: NormativeReference[];
  environmental?: EnvironmentalContext;
  rootCause?: RootCauseSummary;
  auditLog: AuditLogEntry[];
}

export interface CompletenessGap {
  /** Qué falta. */
  kind:
    | 'no_evidence'
    | 'no_affected_workers_declared'
    | 'no_root_cause_assigned'
    | 'no_normative_refs'
    | 'control_failure_unspecified'
    | 'missing_epp_vigency'
    | 'missing_training_vigency'
    | 'missing_audit_log';
  detail: string;
  /** Peso del gap para el score (0..100). */
  weight: number;
}

export interface IncidentBundleManifest {
  /** ID estable del bundle (mismo que incident.id). */
  bundleId: string;
  generatedAt: string;
  incident: IncidentCore;
  affectedWorkers: AffectedWorker[];
  evidence: EvidenceItem[];
  appliedControls: AppliedControl[];
  requiredEpp: RequiredEppPresence[];
  requiredTrainings: TrainingPresence[];
  normativeRefs: NormativeReference[];
  environmental?: EnvironmentalContext;
  rootCause?: RootCauseSummary;
  auditLog: AuditLogEntry[];
  /** 0..100. 100 = expediente completo y defendible. */
  completenessScore: number;
  /** Gaps que deben cerrarse antes de presentar el expediente. */
  gaps: CompletenessGap[];
  /** Recomendaciones priorizadas para cerrar gaps. */
  recommendations: string[];
}

export class IncidentBundleValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'IncidentBundleValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

function assertIncidentCore(incident: IncidentCore): void {
  if (!incident.id) throw new IncidentBundleValidationError('missing_id', 'incident.id required');
  if (!incident.projectId) {
    throw new IncidentBundleValidationError('missing_project', 'incident.projectId required');
  }
  if (!incident.occurredAt) {
    throw new IncidentBundleValidationError('missing_date', 'incident.occurredAt required');
  }
  const t = Date.parse(incident.occurredAt);
  if (Number.isNaN(t)) {
    throw new IncidentBundleValidationError('invalid_date', `bad occurredAt: ${incident.occurredAt}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Completeness scoring
// ────────────────────────────────────────────────────────────────────────

/**
 * Pesos sobre 100. La suma es 100 cuando el expediente está perfecto.
 * Estos pesos se restan del score cada vez que se detecta el gap.
 */
const GAP_WEIGHTS: Record<CompletenessGap['kind'], number> = {
  no_evidence: 20,
  no_affected_workers_declared: 15,
  no_root_cause_assigned: 15,
  no_normative_refs: 10,
  control_failure_unspecified: 15,
  missing_epp_vigency: 10,
  missing_training_vigency: 10,
  missing_audit_log: 5,
};

function detectGaps(input: BuildIncidentBundleInput): CompletenessGap[] {
  const gaps: CompletenessGap[] = [];

  if (input.evidence.length === 0) {
    gaps.push({
      kind: 'no_evidence',
      detail: 'No hay fotos, videos, documentos ni declaraciones cargadas.',
      weight: GAP_WEIGHTS.no_evidence,
    });
  }

  if (input.affectedWorkers.length === 0) {
    gaps.push({
      kind: 'no_affected_workers_declared',
      detail: 'No se declaró ningún trabajador afectado (ni siquiera "unhurt" como testigo).',
      weight: GAP_WEIGHTS.no_affected_workers_declared,
    });
  }

  const severityNeedsRootCause: IncidentSeverity[] = ['high', 'critical', 'sif'];
  if (severityNeedsRootCause.includes(input.incident.severity)) {
    if (!input.rootCause || !input.rootCause.analyzed) {
      gaps.push({
        kind: 'no_root_cause_assigned',
        detail: 'Severidad alta/crítica/SIF requiere análisis de causa raíz.',
        weight: GAP_WEIGHTS.no_root_cause_assigned,
      });
    }
  }

  if (input.normativeRefs.length === 0) {
    gaps.push({
      kind: 'no_normative_refs',
      detail: 'No se vinculó normativa aplicable (DS, Ley, ISO).',
      weight: GAP_WEIGHTS.no_normative_refs,
    });
  }

  for (const c of input.appliedControls) {
    if (!c.wasActive && !c.failureMode) {
      gaps.push({
        kind: 'control_failure_unspecified',
        detail: `Control ${c.controlId} estaba inactivo pero no se especificó el modo de falla.`,
        weight: GAP_WEIGHTS.control_failure_unspecified,
      });
      break; // un gap por bundle, no inflar el score
    }
  }

  const eppNoVigency = input.requiredEpp.filter(
    (e) => e.hadValid && !e.expirationDate,
  );
  if (eppNoVigency.length > 0) {
    gaps.push({
      kind: 'missing_epp_vigency',
      detail: `${eppNoVigency.length} EPP marcados como vigentes sin fecha de vencimiento.`,
      weight: GAP_WEIGHTS.missing_epp_vigency,
    });
  }

  const trainingNoVigency = input.requiredTrainings.filter(
    (t) => t.hadCompleted && !t.completedAt,
  );
  if (trainingNoVigency.length > 0) {
    gaps.push({
      kind: 'missing_training_vigency',
      detail: `${trainingNoVigency.length} trainings marcados como completados sin fecha.`,
      weight: GAP_WEIGHTS.missing_training_vigency,
    });
  }

  if (input.auditLog.length === 0) {
    gaps.push({
      kind: 'missing_audit_log',
      detail: 'audit_log vacío — no se puede reconstruir cronología.',
      weight: GAP_WEIGHTS.missing_audit_log,
    });
  }

  return gaps;
}

function buildRecommendations(gaps: CompletenessGap[]): string[] {
  return [...gaps]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((g) => {
      switch (g.kind) {
        case 'no_evidence':
          return 'Cargar al menos 1 foto del lugar y 1 declaración del testigo principal.';
        case 'no_affected_workers_declared':
          return 'Declarar formalmente al trabajador (incluso si quedó ileso) para trazabilidad SUSESO.';
        case 'no_root_cause_assigned':
          return 'Asignar dueño y fecha límite al análisis de causa raíz (CCC/RCA).';
        case 'no_normative_refs':
          return 'Vincular DS/Ley/ISO aplicable al tipo de evento (consultar abogado codificado).';
        case 'control_failure_unspecified':
          return 'Especificar modo de falla del control (no_disponible / no_usado / no_mantenido / etc.).';
        case 'missing_epp_vigency':
          return 'Completar fechas de vencimiento del EPP usado (auditor las pedirá).';
        case 'missing_training_vigency':
          return 'Completar fecha de capacitación del trabajador (vigencia de cursos).';
        case 'missing_audit_log':
          return 'Asegurar que las acciones del flujo queden en audit_log (responsable: ingeniería).';
        default:
          return g.detail;
      }
    });
}

// ────────────────────────────────────────────────────────────────────────
// Build
// ────────────────────────────────────────────────────────────────────────

export interface BuildIncidentBundleOptions {
  now?: Date;
}

export function buildIncidentBundle(
  input: BuildIncidentBundleInput,
  options: BuildIncidentBundleOptions = {},
): IncidentBundleManifest {
  assertIncidentCore(input.incident);

  const gaps = detectGaps(input);
  const totalPenalty = gaps.reduce((s, g) => s + g.weight, 0);
  const completenessScore = Math.max(0, 100 - totalPenalty);

  return {
    bundleId: input.incident.id,
    generatedAt: (options.now ?? new Date()).toISOString(),
    incident: input.incident,
    affectedWorkers: input.affectedWorkers,
    evidence: input.evidence,
    appliedControls: input.appliedControls,
    requiredEpp: input.requiredEpp,
    requiredTrainings: input.requiredTrainings,
    normativeRefs: input.normativeRefs,
    environmental: input.environmental,
    rootCause: input.rootCause,
    auditLog: input.auditLog,
    completenessScore,
    gaps,
    recommendations: buildRecommendations(gaps),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Serialization helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Para export rápido a JSON (no PII redaction — el caller debe sanitizar
 * antes si va fuera del tenant).
 */
export function manifestToJson(manifest: IncidentBundleManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Resumen one-liner para mostrar en lista de bundles.
 */
export function summarizeBundle(manifest: IncidentBundleManifest): string {
  const sev = manifest.incident.severity.toUpperCase();
  const score = manifest.completenessScore;
  const evidenceN = manifest.evidence.length;
  const gapsN = manifest.gaps.length;
  return `[${sev}] ${manifest.incident.summary.slice(0, 60)} · score ${score}/100 · ${evidenceN} evidencias · ${gapsN} gaps`;
}
