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
  };
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
  return {
    ...change,
    revertedAt: now.toISOString(),
    revertedReason: reason.trim(),
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
