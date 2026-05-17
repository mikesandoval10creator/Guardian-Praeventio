// Praeventio Guard — Sprint K §23-24: Control de Visitas + Inducción Express QR.
//
// Pure event-sourcing layer for visitor registration. Distinct from
// `src/services/visitors/visitorAccessService.ts` which models *site access
// control* (zones, EPP, induction checklist, host accompaniment). This
// module owns the lighter "registry" surface that the §23-24 wire needs:
//
//   • `registerVisitor(payload)`     → emits `visitor_registered`
//   • `acknowledgeInduction(...)`     → emits `visitor_induction_acknowledged`
//   • `checkOutVisitor(...)`          → emits `visitor_checked_out`
//
// Deterministic, side-effect-free. Persistence lives in
// `src/server/routes/visitors.ts` which mounts these primitives on top of
// Firestore at `tenants/{tid}/projects/{pid}/visitors/{id}`.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/**
 * Visitor record persisted in Firestore.
 *
 * Path: `tenants/{tenantId}/projects/{projectId}/visitors/{id}`
 *
 * `checkOutAt` is undefined while the visitor is still on-site. The page
 * filter for "active" visits is `checkOutAt == null`.
 */
export interface Visitor {
  id: string;
  fullName: string;
  rut: string;
  company: string;
  /** Internal worker uid responsible for accompanying the visitor. */
  hostUid: string;
  /** Free-text reason for the visit ("auditoría", "entrega", "fiscalización"…). */
  reason: string;
  /**
   * Induction version pinned at acknowledgement time. Empty string before
   * the visitor acknowledges the express induction.
   */
  inductionVersionId: string;
  /** ISO-8601 timestamp of induction acknowledgement; undefined if pending. */
  inductedAt?: string;
  /** ISO-8601 check-in timestamp (assigned at registration). */
  checkInAt: string;
  /** ISO-8601 check-out timestamp (assigned at checkout). */
  checkOutAt?: string;
  /** Multi-tenant scope. */
  projectId: string;
  tenantId: string;
}

/** Payload accepted by `registerVisitor`. */
export interface RegisterVisitorPayload {
  id: string;
  fullName: string;
  rut: string;
  company: string;
  hostUid: string;
  reason: string;
  /** ISO-8601 check-in timestamp. Defaults to now if omitted by the caller. */
  checkInAt?: string;
  /** Optional pre-known induction version (rare; usually empty until ack). */
  inductionVersionId?: string;
  projectId: string;
  tenantId: string;
}

// ────────────────────────────────────────────────────────────────────────
// Domain events (event-sourcing surface)
// ────────────────────────────────────────────────────────────────────────

export interface VisitorRegisteredEvent {
  type: 'visitor_registered';
  visitor: Visitor;
}

export interface VisitorInductionAcknowledgedEvent {
  type: 'visitor_induction_acknowledged';
  visitorId: string;
  inductionVersionId: string;
  inductedAt: string;
}

export interface VisitorCheckedOutEvent {
  type: 'visitor_checked_out';
  visitorId: string;
  checkOutAt: string;
}

export type VisitorEvent =
  | VisitorRegisteredEvent
  | VisitorInductionAcknowledgedEvent
  | VisitorCheckedOutEvent;

// ────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────

export class VisitorRegistryError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'VisitorRegistryError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

/**
 * Chilean RUT canonical shape — digits + check digit, optionally with dots
 * and a dash. Examples accepted: `12.345.678-9`, `12345678-K`, `1.111.111-1`.
 * Minimum body 7 digits to refuse trivially-short strings like "123" while
 * still accepting RUTs of natural Chilean citizens.
 *
 * We only validate the *shape* here; cryptographic mod-11 verification is
 * out of scope (the worker registry already runs that check before a host
 * is invited, and visitors come from third parties whose RUT may have
 * legacy formatting).
 */
const RUT_SHAPE = /^[0-9]{1,2}(\.?[0-9]{3}){2}-?[0-9Kk]$/;

function normalizeRut(rut: string): string {
  return rut.trim().toUpperCase();
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VisitorRegistryError('INVALID_FIELD', `Field "${field}" is required`);
  }
}

function assertValidPayload(payload: RegisterVisitorPayload): void {
  assertNonEmpty(payload.id, 'id');
  assertNonEmpty(payload.fullName, 'fullName');
  assertNonEmpty(payload.rut, 'rut');
  assertNonEmpty(payload.company, 'company');
  assertNonEmpty(payload.hostUid, 'hostUid');
  assertNonEmpty(payload.reason, 'reason');
  assertNonEmpty(payload.projectId, 'projectId');
  assertNonEmpty(payload.tenantId, 'tenantId');
  if (payload.fullName.trim().length < 3) {
    throw new VisitorRegistryError('INVALID_FIELD', 'fullName must be at least 3 characters');
  }
  if (!RUT_SHAPE.test(normalizeRut(payload.rut))) {
    throw new VisitorRegistryError('INVALID_RUT', `RUT "${payload.rut}" is malformed`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Pure registration. Returns the canonical `Visitor` record alongside the
 * domain event the caller should append. No I/O — the route handler is
 * responsible for persisting `event.visitor` to Firestore.
 */
export function registerVisitor(
  payload: RegisterVisitorPayload,
  nowIso: string = new Date().toISOString(),
): VisitorRegisteredEvent {
  assertValidPayload(payload);
  const visitor: Visitor = {
    id: payload.id,
    fullName: payload.fullName.trim(),
    rut: normalizeRut(payload.rut),
    company: payload.company.trim(),
    hostUid: payload.hostUid,
    reason: payload.reason.trim(),
    inductionVersionId: payload.inductionVersionId ?? '',
    checkInAt: payload.checkInAt ?? nowIso,
    projectId: payload.projectId,
    tenantId: payload.tenantId,
  };
  return { type: 'visitor_registered', visitor };
}

/**
 * Pure induction acknowledgement. The route handler maps this event onto
 * a Firestore `update({ inductionVersionId, inductedAt })` write.
 */
export function acknowledgeInduction(
  visitorId: string,
  inductionVersionId: string,
  nowIso: string = new Date().toISOString(),
): VisitorInductionAcknowledgedEvent {
  assertNonEmpty(visitorId, 'visitorId');
  assertNonEmpty(inductionVersionId, 'inductionVersionId');
  return {
    type: 'visitor_induction_acknowledged',
    visitorId,
    inductionVersionId,
    inductedAt: nowIso,
  };
}

/**
 * Pure check-out. The route handler maps this event onto a Firestore
 * `update({ checkOutAt })` write.
 */
export function checkOutVisitor(
  visitorId: string,
  nowIso: string = new Date().toISOString(),
): VisitorCheckedOutEvent {
  assertNonEmpty(visitorId, 'visitorId');
  return { type: 'visitor_checked_out', visitorId, checkOutAt: nowIso };
}

/**
 * Apply the events to a base visitor record. Useful for the route handler
 * read-modify-write path and for tests that want to verify reducer
 * idempotency without booting Firestore.
 */
export function applyEvent(
  visitor: Visitor | null,
  event: VisitorEvent,
): Visitor {
  switch (event.type) {
    case 'visitor_registered':
      return event.visitor;
    case 'visitor_induction_acknowledged': {
      if (!visitor) {
        throw new VisitorRegistryError(
          'NOT_FOUND',
          `Cannot acknowledge induction for unknown visitor "${event.visitorId}"`,
        );
      }
      return {
        ...visitor,
        inductionVersionId: event.inductionVersionId,
        inductedAt: event.inductedAt,
      };
    }
    case 'visitor_checked_out': {
      if (!visitor) {
        throw new VisitorRegistryError(
          'NOT_FOUND',
          `Cannot check out unknown visitor "${event.visitorId}"`,
        );
      }
      return { ...visitor, checkOutAt: event.checkOutAt };
    }
  }
}

/**
 * Filter helper used by the route's GET handler and the page's list view.
 * "Active" means the visitor has checked in but not yet checked out.
 */
export function isActive(visitor: Visitor): boolean {
  return !visitor.checkOutAt;
}
