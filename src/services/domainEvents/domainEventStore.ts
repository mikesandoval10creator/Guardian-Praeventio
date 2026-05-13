// Praeventio Guard — Sprint 45 §151-153: Eventos de dominio auditables
// + replay + snapshots mensuales.
//
// Cierra §151 (eventos auditables), §152 (replay), §153 (snapshots) de
// la 2da tanda usuario.
//
// 100% determinístico. Define un event store puro en memoria que el
// caller persiste a Firestore en otra capa. Eventos son INMUTABLES
// (append-only). El motor:
//   - Append + lectura por entidad
//   - Replay para reconstruir state desde t0
//   - Snapshot mensual para no replayar history completa cada vez
//   - Validación de schema básico (no nulls en campos requeridos)
//
// Tipos de eventos canónicos (los más comunes — extensible):
//   - incident.created / incident.severity_changed / incident.closed
//   - worker.hired / worker.deactivated / worker.role_changed
//   - corrective_action.created / .closed / .reopened
//   - permit.issued / .expired / .revoked
//   - exception.requested / .approved / .denied
//   - control.verified / .failed
//
// El store NO interpreta payloads — solo los archiva. Quien replaya
// decide qué campo significa qué.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface DomainEvent {
  /** ID único del evento. */
  id: string;
  /** ISO-8601 cuando ocurrió. */
  occurredAt: string;
  /** Tipo discriminado. */
  type: string;
  /** Entidad afectada (incident:abc, worker:w1, ...). */
  entityRef: string;
  /** Tenant — para multi-tenant isolation. */
  tenantId: string;
  /** UID que ejecutó la acción (sistema = 'system'). */
  actorUid: string;
  /** Payload de la transición — debe ser parseable. */
  payload: Record<string, unknown>;
  /** Versión del schema para evolución. */
  schemaVersion: number;
  /** Correlation ID para trazar workflows multi-step. */
  correlationId?: string;
}

export interface EventStoreSnapshot {
  /** Identidad del agregado snapshoteado. */
  entityRef: string;
  tenantId: string;
  /** ISO del fin del período cubierto por este snapshot. */
  asOf: string;
  /** State reconstruido al asOf (caller define shape). */
  state: Record<string, unknown>;
  /** ID del último evento aplicado al state. */
  lastEventId: string;
  /** Cantidad de eventos comprimidos. */
  eventsCompactedCount: number;
}

export class DomainEventValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'DomainEventValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export function validateEvent(e: DomainEvent): void {
  if (!e.id || typeof e.id !== 'string') {
    throw new DomainEventValidationError('missing_id', 'event.id required');
  }
  if (!e.occurredAt || Number.isNaN(Date.parse(e.occurredAt))) {
    throw new DomainEventValidationError('invalid_date', `bad occurredAt ${e.occurredAt}`);
  }
  if (!e.type || typeof e.type !== 'string') {
    throw new DomainEventValidationError('missing_type', 'event.type required');
  }
  if (!e.entityRef) {
    throw new DomainEventValidationError('missing_entity', 'entityRef required');
  }
  if (!e.tenantId) {
    throw new DomainEventValidationError('missing_tenant', 'tenantId required');
  }
  if (!e.actorUid) {
    throw new DomainEventValidationError('missing_actor', 'actorUid required');
  }
  if (e.schemaVersion < 1) {
    throw new DomainEventValidationError('bad_schema_version', `schemaVersion must be >=1, got ${e.schemaVersion}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Append-only store
// ────────────────────────────────────────────────────────────────────────

export class InMemoryEventStore {
  private events: DomainEvent[] = [];
  private snapshots = new Map<string, EventStoreSnapshot>(); // key = `${tenantId}|${entityRef}`

  append(event: DomainEvent): void {
    validateEvent(event);
    // Inmutabilidad: si el id ya existe, NO permitimos overwrite.
    if (this.events.some((e) => e.id === event.id)) {
      throw new DomainEventValidationError(
        'duplicate_id',
        `event ${event.id} ya está en el store (append-only)`,
      );
    }
    this.events.push(event);
  }

  /** Lista eventos de una entidad ordenados cronológicamente. */
  listByEntity(tenantId: string, entityRef: string): DomainEvent[] {
    return this.events
      .filter((e) => e.tenantId === tenantId && e.entityRef === entityRef)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }

  /** Lista eventos por correlationId (workflow multi-step). */
  listByCorrelation(tenantId: string, correlationId: string): DomainEvent[] {
    return this.events
      .filter((e) => e.tenantId === tenantId && e.correlationId === correlationId)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }

  /** Para tests / debugging — total events. */
  get size(): number {
    return this.events.length;
  }

  /** Snapshot store / retrieve. */
  saveSnapshot(snap: EventStoreSnapshot): void {
    const key = `${snap.tenantId}|${snap.entityRef}`;
    this.snapshots.set(key, snap);
  }

  loadSnapshot(tenantId: string, entityRef: string): EventStoreSnapshot | null {
    return this.snapshots.get(`${tenantId}|${entityRef}`) ?? null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Replay engine
// ────────────────────────────────────────────────────────────────────────

export type EventReducer<S> = (state: S, event: DomainEvent) => S;

/**
 * Reconstruye state de una entidad replayando eventos. Si hay snapshot
 * disponible, se usa como punto de partida y solo se replayan eventos
 * posteriores al `snapshot.asOf`.
 */
export function replay<S>(
  store: InMemoryEventStore,
  tenantId: string,
  entityRef: string,
  initialState: S,
  reducer: EventReducer<S>,
): S {
  const snap = store.loadSnapshot(tenantId, entityRef);
  let state: S = snap ? ((snap.state as unknown) as S) : initialState;
  const allEvents = store.listByEntity(tenantId, entityRef);
  const eventsToApply = snap
    ? allEvents.filter((e) => Date.parse(e.occurredAt) > Date.parse(snap.asOf))
    : allEvents;
  for (const e of eventsToApply) {
    state = reducer(state, e);
  }
  return state;
}

/**
 * Construye y persiste un snapshot mensual de una entidad.
 */
export function buildSnapshot<S>(
  store: InMemoryEventStore,
  tenantId: string,
  entityRef: string,
  asOf: string,
  initialState: S,
  reducer: EventReducer<S>,
): EventStoreSnapshot {
  const events = store
    .listByEntity(tenantId, entityRef)
    .filter((e) => Date.parse(e.occurredAt) <= Date.parse(asOf));
  let state: S = initialState;
  for (const e of events) {
    state = reducer(state, e);
  }
  const lastEvent = events[events.length - 1];
  return {
    entityRef,
    tenantId,
    asOf,
    state: state as unknown as Record<string, unknown>,
    lastEventId: lastEvent?.id ?? '',
    eventsCompactedCount: events.length,
  };
}
