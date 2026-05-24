// Praeventio Guard — Sprint 39 Fase J.6: Control de Cambios Operacionales.
//
// Cierra: Documento usuario "Recomendaciones nuevas §3, §4"
//
// Muchos accidentes ocurren por cambios mal comunicados. Esta es una
// pieza CRÍTICA de gestión preventiva (MOC — Management of Change).
//
// Registra cambios significativos:
//   - Supervisor
//   - Procedimiento
//   - Equipo
//   - Turno
//   - Zona de trabajo
//   - EPP obligatorio
//   - Norma aplicable
//
// Cada cambio dispara:
//   - Notificación a trabajadores afectados
//   - Confirmación de lectura obligatoria (via readReceiptService)
//   - Audit log
//
// Plan 2026-05-24 §MOC — ISO 45001 §8.1.3 (Management of Change)
// ────────────────────────────────────────────────────────────────────────
// La versión inicial creaba changes inmediatamente "live" sin gate de
// aprobación. ISO 45001 §8.1.3 exige revisión pre-implementación por
// stakeholders con autoridad relevante (HSE + supervisor de línea +
// gerencia cuando el impacto lo amerita).
//
// Máquina de estados implementada acá:
//
//   declareChange()
//        ↓
//   ┌─ draft ──submitForReview()──→ pending_review ─┬─ recordApproval(reject) ─→ rejected (terminal)
//   │                                               │
//   │                                               └─ recordApproval(approve)+
//   │                                                  quorum  →  approved
//   │                                                                ↓
//   │                                              activateChange() (effectiveFrom ≤ now)
//   │                                                                ↓
//   │                                                            in_effect
//   │                                                              ↓        ↓
//   │                                            verifyEffectiveness()      │
//   │                                                              ↓        │
//   │                                                           verified    │
//   │                                                                       │
//   └───────────────── revertChange() (desde cualquier estado activo) ──── reverted (terminal)
//
// Backwards-compat: cambios pre-MOC sin field `status` se tratan como
// `in_effect` (los tests legacy + datos en producción siguen funcionando).

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ChangeKind =
  | 'supervisor'
  | 'procedure'
  | 'equipment'
  | 'shift'
  | 'work_zone'
  | 'mandatory_epp'
  | 'applicable_norm'
  | 'critical_control'
  | 'other';

export type ChangeImpact = 'low' | 'medium' | 'high';

/**
 * Plan 2026-05-24 §MOC — Status de la máquina de estados ISO 45001 §8.1.3.
 *
 *  - draft           — creado, aún no enviado a revisión
 *  - pending_review  — esperando aprobaciones (HSE + supervisor según impact)
 *  - approved        — quórum alcanzado, esperando effectiveFrom para activar
 *  - rejected        — terminal: alguna aprobación marcó reject
 *  - in_effect       — activo, los trabajadores deben acks
 *  - verified        — auditoría post-impl confirmó efectividad
 *  - reverted        — terminal: se revertió por bug / regresión
 *
 * Pre-MOC (legacy): documentos sin `status` se tratan como `in_effect`.
 */
export type ChangeStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'in_effect'
  | 'verified'
  | 'reverted';

/**
 * Roles autorizados a otorgar approvals. La quórum logic
 * (`meetsApprovalQuorum`) distingue entre HSE (prevencionista) y
 * supervisor/gerente.
 */
export type ApproverRole = 'prevencionista' | 'supervisor' | 'gerente' | 'admin';

export interface ChangeApproval {
  approverUid: string;
  approverRole: ApproverRole;
  decision: 'approved' | 'rejected';
  decidedAt: string;
  comment: string;
}

export interface ChangeVerification {
  verifierUid: string;
  verifiedAt: string;
  /** ¿El cambio logró su objetivo? false = requiere acción correctiva. */
  effective: boolean;
  observations: string;
}

export interface OperationalChange {
  id: string;
  projectId: string;
  kind: ChangeKind;
  /** Descripción de QUÉ cambia (no del por qué). */
  whatChanged: string;
  /** Valor antes. */
  previousValue: string;
  /** Valor después. */
  newValue: string;
  /** Justificación: por qué fue necesario. */
  rationale: string;
  /** Impacto estimado en operación. */
  impact: ChangeImpact;
  /** UIDs de trabajadores afectados — deben confirmar lectura. */
  affectedWorkerUids: string[];
  /** UID de quien declaró el cambio. */
  declaredByUid: string;
  declaredByRole: string;
  /** Cuándo comenzó a aplicar. */
  effectiveFrom: string;
  declaredAt: string;
  /** Documento, procedimiento o referencia donde se ve el detalle. */
  referenceDocumentId?: string;
  /** Confirmaciones de lectura recibidas. */
  acknowledgments: Array<{ workerUid: string; ackedAt: string }>;
  /** Si el cambio fue revertido. */
  revertedAt?: string;
  revertedReason?: string;
  // ─── Plan 2026-05-24 §MOC — ISO 45001 §8.1.3 ──────────────────────────
  /** Estado actual. Default 'draft' en cambios nuevos. */
  status?: ChangeStatus;
  /** Cuándo el draft fue enviado a revisión. */
  submittedForReviewAt?: string;
  /** Decisiones de los approvers durante pending_review. */
  approvals?: ChangeApproval[];
  /** Timestamp de la transición approved → in_effect. */
  activatedAt?: string;
  /** Verificación post-implementación (PDCA Check). */
  verification?: ChangeVerification;
}

export class ChangeValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'ChangeValidationError';
  }
}

const APPROVER_ROLES = ['supervisor', 'prevencionista', 'gerente', 'admin'];
const MIN_RATIONALE_LENGTH = 20;

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

export interface DeclareChangeInput {
  id?: string;
  projectId: string;
  kind: ChangeKind;
  whatChanged: string;
  previousValue: string;
  newValue: string;
  rationale: string;
  impact: ChangeImpact;
  affectedWorkerUids: string[];
  declaredByUid: string;
  declaredByRole: string;
  effectiveFrom: string;
  referenceDocumentId?: string;
  now?: Date;
}

export function declareChange(input: DeclareChangeInput): OperationalChange {
  if (!APPROVER_ROLES.includes(input.declaredByRole)) {
    throw new ChangeValidationError(
      'ROLE_NOT_ALLOWED',
      `role '${input.declaredByRole}' cannot declare operational changes`,
    );
  }
  if (input.rationale.trim().length < MIN_RATIONALE_LENGTH) {
    throw new ChangeValidationError(
      'RATIONALE_TOO_SHORT',
      `rationale must be at least ${MIN_RATIONALE_LENGTH} chars`,
    );
  }
  if (input.previousValue === input.newValue) {
    throw new ChangeValidationError(
      'NO_DIFFERENCE',
      'previousValue must differ from newValue',
    );
  }
  if (input.affectedWorkerUids.length === 0 && input.impact !== 'low') {
    throw new ChangeValidationError(
      'AFFECTED_REQUIRED',
      `changes with impact='${input.impact}' must identify affected workers`,
    );
  }

  const now = input.now ?? new Date();
  const id =
    input.id ??
    bytesToHex(
      sha256(
        new TextEncoder().encode(
          `${input.projectId}\x00${input.kind}\x00${input.newValue}\x00${now.toISOString()}`,
        ),
      ),
    ).slice(0, 32);
  return {
    id,
    projectId: input.projectId,
    kind: input.kind,
    whatChanged: input.whatChanged.trim(),
    previousValue: input.previousValue,
    newValue: input.newValue,
    rationale: input.rationale.trim(),
    impact: input.impact,
    affectedWorkerUids: [...new Set(input.affectedWorkerUids)],
    declaredByUid: input.declaredByUid,
    declaredByRole: input.declaredByRole,
    effectiveFrom: input.effectiveFrom,
    declaredAt: now.toISOString(),
    referenceDocumentId: input.referenceDocumentId,
    acknowledgments: [],
    // Plan 2026-05-24 §MOC — start in draft. Caller must call
    // submitForReview + recordApproval + activateChange to take it live.
    status: 'draft',
    approvals: [],
  };
}

// ────────────────────────────────────────────────────────────────────────
// Plan 2026-05-24 §MOC — Workflow ISO 45001 §8.1.3
// ────────────────────────────────────────────────────────────────────────

const APPROVER_ROLE_SET: ReadonlySet<ApproverRole> = new Set([
  'prevencionista',
  'supervisor',
  'gerente',
  'admin',
]);

const MIN_APPROVAL_COMMENT_LENGTH = 15;
const MIN_VERIFICATION_OBSERVATIONS_LENGTH = 30;

/**
 * `draft → pending_review`. Solo el creador o un HSE pueden someter
 * (en práctica el servicio no chequea identidad — eso es responsabilidad
 * del caller / Firestore security rules). Acá solo enforcemos la
 * transición de status.
 */
export function submitForReview(
  change: OperationalChange,
  submitterUid: string,
  now: Date = new Date(),
): OperationalChange {
  if ((change.status ?? 'in_effect') !== 'draft') {
    throw new ChangeValidationError(
      'NOT_DRAFT',
      `can only submit draft changes, got status='${change.status}'`,
    );
  }
  if (!submitterUid || submitterUid.trim().length === 0) {
    throw new ChangeValidationError('MISSING_SUBMITTER', 'submitterUid required');
  }
  return {
    ...change,
    status: 'pending_review',
    submittedForReviewAt: now.toISOString(),
  };
}

export interface RecordApprovalInput {
  approverUid: string;
  approverRole: ApproverRole;
  decision: 'approved' | 'rejected';
  comment: string;
  now?: Date;
}

/**
 * Agrega una decisión al array `approvals`. Status output:
 *   - rejected   si decision='rejected' (terminal)
 *   - approved   si decision='approved' Y se alcanza quórum
 *   - pending_review  si aún falta aprobador del otro rol
 *
 * Las reglas de quórum (`meetsApprovalQuorum`) son:
 *   - impact='low'    → 1 HSE basta
 *   - impact='medium' → 1 HSE + 1 supervisor o gerente
 *   - impact='high'   → 1 HSE + 1 supervisor o gerente
 */
export function recordApproval(
  change: OperationalChange,
  input: RecordApprovalInput,
): OperationalChange {
  if ((change.status ?? 'in_effect') !== 'pending_review') {
    throw new ChangeValidationError(
      'NOT_PENDING_REVIEW',
      `can only approve changes in pending_review, got status='${change.status}'`,
    );
  }
  if (!APPROVER_ROLE_SET.has(input.approverRole)) {
    throw new ChangeValidationError(
      'ROLE_NOT_APPROVER',
      `role '${input.approverRole}' cannot approve operational changes`,
    );
  }
  if (input.comment.trim().length < MIN_APPROVAL_COMMENT_LENGTH) {
    throw new ChangeValidationError(
      'COMMENT_TOO_SHORT',
      `approval comment must be at least ${MIN_APPROVAL_COMMENT_LENGTH} chars`,
    );
  }
  const existing = change.approvals ?? [];
  if (existing.some((a) => a.approverUid === input.approverUid)) {
    throw new ChangeValidationError(
      'DUPLICATE_APPROVER',
      `approver '${input.approverUid}' already decided on this change`,
    );
  }

  const now = input.now ?? new Date();
  const approval: ChangeApproval = {
    approverUid: input.approverUid,
    approverRole: input.approverRole,
    decision: input.decision,
    decidedAt: now.toISOString(),
    comment: input.comment.trim(),
  };
  const newApprovals = [...existing, approval];

  let newStatus: ChangeStatus = 'pending_review';
  if (input.decision === 'rejected') {
    newStatus = 'rejected';
  } else if (meetsApprovalQuorum({ ...change, approvals: newApprovals })) {
    newStatus = 'approved';
  }

  return {
    ...change,
    approvals: newApprovals,
    status: newStatus,
  };
}

/**
 * Determina si el cambio alcanza el quórum de aprobaciones requerido
 * según `impact`. Solo cuenta `decision='approved'`; los rejects no
 * suman (y de hecho ponen el change en estado terminal `rejected`).
 *
 * Quorum por impact:
 *   - low    → ≥1 prevencionista (HSE)
 *   - medium → ≥1 prevencionista + ≥1 (supervisor | gerente | admin)
 *   - high   → ≥1 prevencionista + ≥1 (supervisor | gerente | admin)
 */
export function meetsApprovalQuorum(change: OperationalChange): boolean {
  const approvals = (change.approvals ?? []).filter((a) => a.decision === 'approved');
  const hasHSE = approvals.some((a) => a.approverRole === 'prevencionista');
  if (!hasHSE) return false;
  if (change.impact === 'low') return true;
  // medium + high: requieren además un sup/ger/admin.
  return approvals.some((a) =>
    a.approverRole === 'supervisor' ||
    a.approverRole === 'gerente' ||
    a.approverRole === 'admin',
  );
}

/**
 * `approved → in_effect`. Solo se puede activar cuando `effectiveFrom`
 * ya pasó — esto previene que un cambio aprobado entre en vigor antes
 * de la fecha planificada (la cual el equipo usó para coordinar
 * capacitaciones, ETAs de equipos, etc.).
 */
export function activateChange(
  change: OperationalChange,
  activatorUid: string,
  now: Date = new Date(),
): OperationalChange {
  if ((change.status ?? 'in_effect') !== 'approved') {
    throw new ChangeValidationError(
      'NOT_APPROVED',
      `can only activate approved changes, got status='${change.status}'`,
    );
  }
  if (!activatorUid || activatorUid.trim().length === 0) {
    throw new ChangeValidationError('MISSING_ACTIVATOR', 'activatorUid required');
  }
  const effective = new Date(change.effectiveFrom);
  if (now < effective) {
    throw new ChangeValidationError(
      'EFFECTIVE_FROM_FUTURE',
      `cannot activate before effectiveFrom (${change.effectiveFrom})`,
    );
  }
  return {
    ...change,
    status: 'in_effect',
    activatedAt: now.toISOString(),
  };
}

export interface VerifyEffectivenessInput {
  verifierUid: string;
  effective: boolean;
  observations: string;
  now?: Date;
}

/**
 * `in_effect → verified` (solo si effective=true).
 * Si effective=false, el change MANTIENE status='in_effect' pero registra
 * la observación — el flag `corrective_action_required` queda implícito
 * en `verification.effective=false` para el dashboard.
 *
 * Cierra el ciclo PDCA del MOC: Plan → Do → Check (acá) → Act (acción
 * correctiva fuera de este servicio).
 */
export function verifyEffectiveness(
  change: OperationalChange,
  input: VerifyEffectivenessInput,
): OperationalChange {
  if ((change.status ?? 'in_effect') !== 'in_effect') {
    throw new ChangeValidationError(
      'NOT_IN_EFFECT',
      `can only verify in_effect changes, got status='${change.status}'`,
    );
  }
  if (input.observations.trim().length < MIN_VERIFICATION_OBSERVATIONS_LENGTH) {
    throw new ChangeValidationError(
      'OBSERVATIONS_TOO_SHORT',
      `observations must be at least ${MIN_VERIFICATION_OBSERVATIONS_LENGTH} chars`,
    );
  }
  const now = input.now ?? new Date();
  const verification: ChangeVerification = {
    verifierUid: input.verifierUid,
    verifiedAt: now.toISOString(),
    effective: input.effective,
    observations: input.observations.trim(),
  };
  return {
    ...change,
    verification,
    status: input.effective ? 'verified' : 'in_effect',
  };
}

/**
 * Estados "live" donde el cambio ya está afectando operaciones:
 * - 'in_effect' y 'verified'.
 * - Legacy data (sin `status`) se trata como in_effect (backwards-compat).
 *
 * Los workers solo deben ack changes en live state — un draft o un
 * pending_review NO requiere ack todavía.
 */
export function isInLiveState(change: OperationalChange): boolean {
  const s = change.status ?? 'in_effect';
  return s === 'in_effect' || s === 'verified';
}

export function acknowledgeChange(
  change: OperationalChange,
  workerUid: string,
  ackedAt: string = new Date().toISOString(),
): OperationalChange {
  if (change.revertedAt) {
    throw new ChangeValidationError(
      'CHANGE_REVERTED',
      'cannot acknowledge a reverted change',
    );
  }
  if (!change.affectedWorkerUids.includes(workerUid)) {
    throw new ChangeValidationError(
      'NOT_IN_AUDIENCE',
      `worker ${workerUid} is not in affectedWorkerUids`,
    );
  }
  if (change.acknowledgments.some((a) => a.workerUid === workerUid)) return change;
  return {
    ...change,
    acknowledgments: [...change.acknowledgments, { workerUid, ackedAt }],
  };
}

export function revertChange(
  change: OperationalChange,
  reason: string,
  now: Date = new Date(),
): OperationalChange {
  if (change.revertedAt) {
    throw new ChangeValidationError(
      'ALREADY_REVERTED',
      `change ${change.id} already reverted at ${change.revertedAt}`,
    );
  }
  if (reason.trim().length < 15) {
    throw new ChangeValidationError('REASON_TOO_SHORT', 'reason ≥15 chars');
  }
  // Plan 2026-05-24 §MOC — además de marcar timestamps, flipea status
  // a 'reverted' (terminal). Pre-MOC el status no existía; el ack-gate
  // estaba solo en `revertedAt`. Ahora ambos se mantienen para
  // backwards-compat con datos legacy.
  return {
    ...change,
    revertedAt: now.toISOString(),
    revertedReason: reason.trim(),
    status: 'reverted',
  };
}

export interface ChangeAcknowledgementSummary {
  changeId: string;
  totalAffected: number;
  acknowledged: number;
  pending: number;
  coveragePercent: number;
  pendingWorkerUids: string[];
}

export function summarizeAcknowledgments(
  change: OperationalChange,
): ChangeAcknowledgementSummary {
  const ackedSet = new Set(change.acknowledgments.map((a) => a.workerUid));
  const pending = change.affectedWorkerUids.filter((u) => !ackedSet.has(u));
  const totalAffected = change.affectedWorkerUids.length;
  return {
    changeId: change.id,
    totalAffected,
    acknowledged: change.acknowledgments.length,
    pending: pending.length,
    coveragePercent:
      totalAffected === 0 ? 100 : Math.round((change.acknowledgments.length / totalAffected) * 100),
    pendingWorkerUids: pending,
  };
}
