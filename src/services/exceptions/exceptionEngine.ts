// Praeventio Guard — Sprint 39 Fase G.2: Motor de excepciones.
//
// Cierra: Documento usuario "Recomendaciones nuevas §10"
//         Plan integral Top 15 #12
//
// La realidad de terreno no siempre permite cumplimiento perfecto. Mejor
// REGISTRAR excepciones controladas que silenciosamente IGNORAR la regla:
//
//   - Trabajador sin training vigente: autorizado 24h con supervisor directo
//   - EPP vencido: autorización para usar repuesto temporal por 72h
//   - Permiso pendiente firma: prevencionista presente en terreno
//
// Cada excepción:
//   - tiene plazo máximo (validUntil)
//   - requiere aprobador autenticado (supervisor o role superior)
//   - registra la mitigación alternativa
//   - permite revocación temprana
//   - se cierra automática al expirar
//
// API puro: el caller persiste.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ExceptionDomain =
  | 'training_gap'
  | 'epp_expired'
  | 'permit_pending'
  | 'document_expired'
  | 'medical_fitness_pending'
  | 'equipment_inspection'
  | 'staffing_gap'
  | 'other';

export type ExceptionStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'fulfilled';

export interface ExceptionRecord {
  id: string;
  domain: ExceptionDomain;
  /** Quién/qué tiene la excepción aplicada. */
  subjectRef: { kind: 'WORKER' | 'EPP' | 'TASK' | 'EQUIPMENT' | 'DOCUMENT'; id: string };
  /** Razón humana — debe ser específica, no "porque sí". */
  reason: string;
  /** Mitigación alternativa que reemplaza el control normal. */
  alternativeMitigation: string;
  /** UID del aprobador (debe tener role 'supervisor' o superior — validar fuera). */
  approvedByUid: string;
  approvedByRole: string;
  approvedAt: string;
  /** ISO-8601 — el sistema fuerza el cierre cuando se cruza. */
  validUntil: string;
  /** Estado actual derivado de validUntil + revocación. */
  status: ExceptionStatus;
  /** Evidencia opcional adjunta (foto, doc). */
  evidenceUrls?: string[];
  /** Notas operacionales para el handover. */
  notes?: string;
  /** Cuando un audit posterior confirma que la mitigación funcionó. */
  fulfilledAt?: string;
  /** Cuando un supervisor revoca antes de validUntil. */
  revokedAt?: string;
  revokedByUid?: string;
  revokedReason?: string;
}

export interface CreateExceptionInput {
  id: string;
  domain: ExceptionDomain;
  subjectRef: ExceptionRecord['subjectRef'];
  reason: string;
  alternativeMitigation: string;
  approvedByUid: string;
  approvedByRole: string;
  /** Duración en horas. Hard cap 168h (1 semana). */
  durationHours: number;
  evidenceUrls?: string[];
  notes?: string;
  /** Override timestamp para tests. */
  now?: Date;
}

export class ExceptionValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'ExceptionValidationError';
  }
}

const MAX_DURATION_HOURS = 168; // 1 semana
const MIN_REASON_LENGTH = 20;
const MIN_MITIGATION_LENGTH = 20;

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

export function createException(input: CreateExceptionInput): ExceptionRecord {
  // Validation guardrails. La excepción debe estar suficientemente
  // documentada para que un auditor pueda evaluarla después.
  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new ExceptionValidationError(
      'REASON_TOO_SHORT',
      `reason must be at least ${MIN_REASON_LENGTH} chars (got ${input.reason.trim().length})`,
    );
  }
  if (input.alternativeMitigation.trim().length < MIN_MITIGATION_LENGTH) {
    throw new ExceptionValidationError(
      'MITIGATION_TOO_SHORT',
      `alternativeMitigation must be at least ${MIN_MITIGATION_LENGTH} chars`,
    );
  }
  if (input.durationHours <= 0 || input.durationHours > MAX_DURATION_HOURS) {
    throw new ExceptionValidationError(
      'DURATION_OUT_OF_RANGE',
      `durationHours must be between 1 and ${MAX_DURATION_HOURS}`,
    );
  }
  // Approver must have a recognised role.
  const recognisedRoles = ['supervisor', 'prevencionista', 'gerente', 'admin'];
  if (!recognisedRoles.includes(input.approvedByRole)) {
    throw new ExceptionValidationError(
      'ROLE_NOT_ALLOWED',
      `approvedByRole must be one of: ${recognisedRoles.join(', ')}`,
    );
  }

  const now = input.now ?? new Date();
  const approvedAt = now.toISOString();
  const validUntil = new Date(now.getTime() + input.durationHours * 3_600_000).toISOString();

  return {
    id: input.id,
    domain: input.domain,
    subjectRef: input.subjectRef,
    reason: input.reason.trim(),
    alternativeMitigation: input.alternativeMitigation.trim(),
    approvedByUid: input.approvedByUid,
    approvedByRole: input.approvedByRole,
    approvedAt,
    validUntil,
    status: 'active',
    evidenceUrls: input.evidenceUrls,
    notes: input.notes,
  };
}

export function deriveStatus(
  record: Pick<ExceptionRecord, 'status' | 'validUntil' | 'revokedAt' | 'fulfilledAt'>,
  now: Date = new Date(),
): ExceptionStatus {
  if (record.status === 'revoked' || record.revokedAt) return 'revoked';
  if (record.status === 'fulfilled' || record.fulfilledAt) return 'fulfilled';
  if (Date.parse(record.validUntil) < now.getTime()) return 'expired';
  return 'active';
}

export function revokeException(
  record: ExceptionRecord,
  revokedByUid: string,
  revokedReason: string,
  now: Date = new Date(),
): ExceptionRecord {
  if (record.status !== 'active') {
    throw new ExceptionValidationError(
      'NOT_ACTIVE',
      `cannot revoke exception in status '${record.status}'`,
    );
  }
  return {
    ...record,
    status: 'revoked',
    revokedAt: now.toISOString(),
    revokedByUid,
    revokedReason,
  };
}

export function markFulfilled(
  record: ExceptionRecord,
  now: Date = new Date(),
): ExceptionRecord {
  if (record.status !== 'active') {
    throw new ExceptionValidationError(
      'NOT_ACTIVE',
      `cannot mark fulfilled in status '${record.status}'`,
    );
  }
  return {
    ...record,
    status: 'fulfilled',
    fulfilledAt: now.toISOString(),
  };
}

/**
 * Recorre una lista y devuelve solo las excepciones que están "vivas"
 * (status='active' y no expiradas). Útil para queries del semáforo F.2.
 */
export function filterActiveAt(
  records: ExceptionRecord[],
  now: Date = new Date(),
): ExceptionRecord[] {
  return records.filter((r) => deriveStatus(r, now) === 'active');
}

export interface ExceptionAuditSummary {
  totalActive: number;
  totalExpired: number;
  totalRevoked: number;
  totalFulfilled: number;
  byDomain: Record<ExceptionDomain, number>;
}

export function summarize(
  records: ExceptionRecord[],
  now: Date = new Date(),
): ExceptionAuditSummary {
  const byDomain: Partial<Record<ExceptionDomain, number>> = {};
  let totalActive = 0;
  let totalExpired = 0;
  let totalRevoked = 0;
  let totalFulfilled = 0;
  for (const r of records) {
    const status = deriveStatus(r, now);
    byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
    if (status === 'active') totalActive += 1;
    else if (status === 'expired') totalExpired += 1;
    else if (status === 'revoked') totalRevoked += 1;
    else if (status === 'fulfilled') totalFulfilled += 1;
  }
  return {
    totalActive,
    totalExpired,
    totalRevoked,
    totalFulfilled,
    byDomain: byDomain as Record<ExceptionDomain, number>,
  };
}
