// Praeventio Guard — Sprint 39 Fase I.1: Paralización + Reanudación Controlada.
//
// Cierra: Documento usuario "Recomendaciones nuevas §13, §14"
//
// Cuando se detecta una condición que obliga a detener trabajos (incidente
// grave, hallazgo crítico, condición climática extrema, falla de equipo
// crítico, observación fiscalizador), el sistema gestiona el ciclo:
//
//   stoppage → reanudación controlada → cierre
//
// La paralización es un acto JURÍDICO y debe quedar trazada. La
// reanudación NO es automática: exige verificación de condiciones.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type StoppageCategory =
  | 'incidente_grave'
  | 'hallazgo_critico'
  | 'condicion_climatica'
  | 'falla_equipo_critico'
  | 'observacion_fiscalizador'
  | 'falta_supervision'
  | 'detencion_voluntaria'; // stop-work authority del trabajador

export type StoppageScope = 'project' | 'zone' | 'task' | 'equipment';

export type StoppageStatus =
  | 'active'
  | 'pending_resumption'
  | 'resumed'
  | 'cancelled';

export interface Stoppage {
  id: string;
  projectId: string;
  category: StoppageCategory;
  scope: StoppageScope;
  /** ID del objeto detenido (zone/task/equipment); para 'project' coincide con projectId. */
  scopeTargetId: string;
  reason: string;
  /** UID de quien declaró la paralización. */
  declaredByUid: string;
  declaredByRole: string;
  declaredAt: string;
  status: StoppageStatus;
  /** Pre-condiciones que se deben cumplir para reanudar. */
  resumptionPreconditions: ResumptionPrecondition[];
  /** Reanudación cuando se cumplen. */
  resumedAt?: string;
  resumedByUid?: string;
  /** Cancelación = paralización mal declarada o duplicada. */
  cancelledAt?: string;
  cancelledByUid?: string;
  cancelledReason?: string;
  /** Veredicto post-cierre (justificada/no_justificada). Inmutable una vez emitido. */
  resolution?: StoppageResolution;
}

/** Veredicto a-posteriori sobre la legitimidad de la paralización (arista B4). */
export type StoppageVerdict = 'justificada' | 'no_justificada';

/**
 * Resolución (veredicto) emitida por un rol aprobador DESPUÉS del cierre del
 * ciclo (resumed o cancelled). Cuando `verdict === 'justificada'` el sistema
 * premia al declarante (observación positiva + XP) — ver
 * `src/server/routes/stoppage.ts` POST /:projectId/stoppage/resolve.
 */
export interface StoppageResolution {
  verdict: StoppageVerdict;
  resolvedByUid: string;
  resolvedByRole: string;
  resolvedAt: string;
  comment?: string;
}

export interface ResumptionPrecondition {
  id: string;
  label: string;
  /** Si ya se verificó. */
  fulfilled: boolean;
  fulfilledByUid?: string;
  fulfilledAt?: string;
  /** Evidencia URL (foto, doc). */
  evidenceUrl?: string;
}

export class StoppageValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'StoppageValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

const APPROVER_ROLES = ['supervisor', 'prevencionista', 'gerente', 'admin'];
const MIN_REASON_LENGTH = 15;

export interface DeclareStoppageInput {
  id: string;
  projectId: string;
  category: StoppageCategory;
  scope: StoppageScope;
  scopeTargetId: string;
  reason: string;
  declaredByUid: string;
  declaredByRole: string;
  resumptionPreconditions: Array<{ id: string; label: string }>;
  now?: Date;
}

export function declareStoppage(input: DeclareStoppageInput): Stoppage {
  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new StoppageValidationError(
      'REASON_TOO_SHORT',
      `reason must be at least ${MIN_REASON_LENGTH} chars`,
    );
  }
  // detencion_voluntaria es la única que permite cualquier role
  // (stop-work authority del trabajador). El resto exige role superior.
  if (
    input.category !== 'detencion_voluntaria' &&
    !APPROVER_ROLES.includes(input.declaredByRole)
  ) {
    throw new StoppageValidationError(
      'ROLE_NOT_ALLOWED',
      `role '${input.declaredByRole}' cannot declare stoppage of category '${input.category}'`,
    );
  }
  if (input.resumptionPreconditions.length === 0) {
    throw new StoppageValidationError(
      'NO_PRECONDITIONS',
      'must declare at least one resumption precondition',
    );
  }

  const now = input.now ?? new Date();
  return {
    id: input.id,
    projectId: input.projectId,
    category: input.category,
    scope: input.scope,
    scopeTargetId: input.scopeTargetId,
    reason: input.reason.trim(),
    declaredByUid: input.declaredByUid,
    declaredByRole: input.declaredByRole,
    declaredAt: now.toISOString(),
    status: 'active',
    resumptionPreconditions: input.resumptionPreconditions.map((p) => ({
      ...p,
      fulfilled: false,
    })),
  };
}

export function markPreconditionFulfilled(
  stoppage: Stoppage,
  preconditionId: string,
  verifierUid: string,
  evidenceUrl?: string,
  now: Date = new Date(),
): Stoppage {
  if (stoppage.status !== 'active' && stoppage.status !== 'pending_resumption') {
    throw new StoppageValidationError(
      'NOT_OPEN',
      `cannot modify preconditions of stoppage in status '${stoppage.status}'`,
    );
  }
  const updated = stoppage.resumptionPreconditions.map((p) =>
    p.id === preconditionId
      ? {
          ...p,
          fulfilled: true,
          fulfilledByUid: verifierUid,
          fulfilledAt: now.toISOString(),
          evidenceUrl,
        }
      : p,
  );
  const allFulfilled = updated.every((p) => p.fulfilled);
  return {
    ...stoppage,
    resumptionPreconditions: updated,
    status: allFulfilled ? 'pending_resumption' : 'active',
  };
}

export function resume(
  stoppage: Stoppage,
  resumedByUid: string,
  resumedByRole: string,
  now: Date = new Date(),
): Stoppage {
  if (stoppage.status !== 'pending_resumption') {
    throw new StoppageValidationError(
      'NOT_PENDING_RESUMPTION',
      `cannot resume from status '${stoppage.status}' — todas las preconditions deben estar fulfilled`,
    );
  }
  if (!APPROVER_ROLES.includes(resumedByRole)) {
    throw new StoppageValidationError(
      'ROLE_NOT_ALLOWED',
      `role '${resumedByRole}' cannot approve resumption`,
    );
  }
  return {
    ...stoppage,
    status: 'resumed',
    resumedAt: now.toISOString(),
    resumedByUid,
  };
}

export function cancelStoppage(
  stoppage: Stoppage,
  cancelledByUid: string,
  reason: string,
  now: Date = new Date(),
): Stoppage {
  if (stoppage.status === 'resumed' || stoppage.status === 'cancelled') {
    throw new StoppageValidationError(
      'INVALID_TRANSITION',
      `cannot cancel from status '${stoppage.status}'`,
    );
  }
  if (reason.trim().length < 15) {
    throw new StoppageValidationError('REASON_TOO_SHORT', 'reason ≥15 chars');
  }
  return {
    ...stoppage,
    status: 'cancelled',
    cancelledAt: now.toISOString(),
    cancelledByUid,
    cancelledReason: reason.trim(),
  };
}

/** True iff `role` can approve resumption / emit verdicts. */
export function isApproverRole(role: string): boolean {
  return APPROVER_ROLES.includes(role);
}

/**
 * Emits the a-posteriori verdict over a CLOSED stoppage (resumed or
 * cancelled). The verdict is the supervisor-level review of whether stopping
 * work was legitimate; `justificada` is the hook that triggers the structural
 * reward to the declarer (positive observation + XP — arista B4).
 *
 * Pure function: idempotency is enforced here (ALREADY_RESOLVED) and at the
 * persistence layer (the route reads + writes inside a transaction).
 */
export function resolveStoppage(
  stoppage: Stoppage,
  verdict: StoppageVerdict,
  resolvedByUid: string,
  resolvedByRole: string,
  comment?: string,
  now: Date = new Date(),
): Stoppage {
  if (stoppage.resolution) {
    throw new StoppageValidationError(
      'ALREADY_RESOLVED',
      `stoppage '${stoppage.id}' already has verdict '${stoppage.resolution.verdict}'`,
    );
  }
  if (stoppage.status !== 'resumed' && stoppage.status !== 'cancelled') {
    throw new StoppageValidationError(
      'NOT_CLOSED',
      `cannot emit verdict on stoppage in status '${stoppage.status}' — lifecycle must be closed (resumed|cancelled)`,
    );
  }
  if (!isApproverRole(resolvedByRole)) {
    throw new StoppageValidationError(
      'ROLE_NOT_ALLOWED',
      `role '${resolvedByRole}' cannot emit a stoppage verdict`,
    );
  }
  const trimmedComment = comment?.trim();
  return {
    ...stoppage,
    resolution: {
      verdict,
      resolvedByUid,
      resolvedByRole,
      resolvedAt: now.toISOString(),
      ...(trimmedComment ? { comment: trimmedComment } : {}),
    },
  };
}

export interface StoppageSummary {
  total: number;
  active: number;
  pendingResumption: number;
  resumed: number;
  cancelled: number;
  longestActiveHours: number;
}

export function summarize(
  stoppages: Stoppage[],
  now: Date = new Date(),
): StoppageSummary {
  let active = 0;
  let pending = 0;
  let resumed = 0;
  let cancelled = 0;
  let longest = 0;
  for (const s of stoppages) {
    switch (s.status) {
      case 'active':
        active += 1;
        break;
      case 'pending_resumption':
        pending += 1;
        break;
      case 'resumed':
        resumed += 1;
        break;
      case 'cancelled':
        cancelled += 1;
        break;
    }
    if (s.status === 'active' || s.status === 'pending_resumption') {
      const h = (now.getTime() - Date.parse(s.declaredAt)) / 3_600_000;
      if (h > longest) longest = h;
    }
  }
  return {
    total: stoppages.length,
    active,
    pendingResumption: pending,
    resumed,
    cancelled,
    longestActiveHours: Math.round(longest * 10) / 10,
  };
}
