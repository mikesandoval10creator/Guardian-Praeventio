// Praeventio Guard — Event Store core types.
//
// CQRS real (no diagrama): el Event Store es un append-only log de
// eventos de dominio. Cada evento es inmutable y reconstruye el
// estado de un aggregate via reducción.
//
// Diferencia con audit_log: el audit_log narra "qué pasó" para
// fiscalización; el Event Store es la FUENTE DE VERDAD del estado.
// Si pierdes el Event Store, pierdes la app; si pierdes el audit_log,
// solo pierdes contexto humano.
//
// Decisiones de diseño:
//   - `aggregateId` particiona — todos los eventos de un mismo
//     aggregate viven en la misma "partition" (en Firestore, una
//     subcolección).
//   - `sequenceNumber` por aggregate (no global) — permite optimistic
//     concurrency control. Si dos clientes intentan appendear con la
//     misma seq, uno gana, el otro re-lee + reintenta.
//   - `eventType` es un literal string (typed unions per aggregate)
//     que dirige el switch del reducer.
//   - `metadata.tenantId` siempre presente — multi-tenancy enforced
//     a nivel de query.
//   - `payload` es JSON serializable estricto. Los reducers leen solo
//     este campo + metadata.

/**
 * Evento de dominio inmutable. Una vez appendado al store, NUNCA se
 * modifica ni borra (write-once).
 */
export interface DomainEvent<TPayload = unknown> {
  /** UUID único del evento (idempotency key para el append). */
  eventId: string;
  /** ID del aggregate al que pertenece (e.g. incidentId). */
  aggregateId: string;
  /** Tipo del aggregate ('incident', 'permit', 'worker', etc). */
  aggregateType: string;
  /**
   * Tipo del evento como dot-namespaced string:
   *   'incident.created' | 'incident.severity_changed' | 'incident.closed'
   * Los reducers hacen switch sobre este campo.
   */
  eventType: string;
  /** Versión del aggregate después de este evento (1, 2, 3, ...). */
  sequenceNumber: number;
  /** Payload típico del evento — JSON serializable. */
  payload: TPayload;
  metadata: EventMetadata;
}

export interface EventMetadata {
  /** ISO timestamp del append. */
  occurredAt: string;
  /** UID del actor que disparó el comando. */
  causedByUid: string;
  /** Tenant que owns el aggregate. */
  tenantId: string;
  /** Project scope si aplica. */
  projectId?: string;
  /**
   * Causación: si el evento fue causado por OTRO evento (e.g. una
   * proyección que reaccionó a un evento previo), referenciamos su id.
   */
  causedByEventId?: string;
  /** Correlation id para tracear flows multi-aggregate. */
  correlationId?: string;
}

/**
 * Command que el caller envía al command handler. NO es el evento — es
 * la INTENCIÓN. El handler valida, decide qué evento(s) emitir, y los
 * appendea al store.
 */
export interface Command<TKind extends string = string, TPayload = unknown> {
  kind: TKind;
  aggregateId: string;
  payload: TPayload;
  /** Quien envía el command (uid). */
  issuedByUid: string;
  tenantId: string;
  projectId?: string;
  /** Si está set, el handler valida optimistic concurrency. */
  expectedVersion?: number;
  correlationId?: string;
}

/**
 * Errores que puede lanzar el Event Store al appendear.
 */
export class EventStoreError extends Error {
  constructor(
    public readonly code:
      | 'CONCURRENCY_CONFLICT'
      | 'DUPLICATE_EVENT_ID'
      | 'INVALID_SEQUENCE'
      | 'AGGREGATE_NOT_FOUND'
      | 'TENANT_MISMATCH',
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'EventStoreError';
  }
}

/**
 * Contrato del Event Store. Cualquier backend (in-memory, Firestore,
 * Postgres) implementa esta interface.
 */
export interface EventStore {
  /**
   * Appendea uno o más eventos para el mismo aggregate. Atómico:
   * si dos eventos van en el mismo call, ambos persisten o ninguno.
   *
   * Concurrency: si `expectedSeq` provisto, falla con
   * CONCURRENCY_CONFLICT si la última seq en el store NO coincide.
   * Esto previene "lost updates" en operaciones concurrentes.
   *
   * Idempotency: si dos llamadas appendean el mismo `eventId`, la
   * segunda es no-op (devuelve los eventos ya persistidos, no lanza).
   */
  append(
    events: DomainEvent[],
    options?: { expectedSeq?: number },
  ): Promise<DomainEvent[]>;

  /**
   * Lee TODOS los eventos de un aggregate en orden de seq ascendente.
   * Devuelve [] si no existe.
   */
  read(
    aggregateId: string,
    options?: { fromSeq?: number; toSeq?: number },
  ): Promise<DomainEvent[]>;

  /**
   * Lee eventos por aggregateType + tenant. Útil para proyecciones
   * que materializan read models para queries cross-aggregate.
   */
  readByType(
    aggregateType: string,
    tenantId: string,
    options?: { sinceIso?: string; limit?: number },
  ): Promise<DomainEvent[]>;

  /**
   * Versión actual del aggregate (último sequenceNumber) o 0 si no existe.
   */
  currentVersion(aggregateId: string): Promise<number>;

  /**
   * Métricas observables del store. El dashboard real las consume
   * en lugar de Math.random().
   */
  getMetrics(): Promise<EventStoreMetrics>;
}

export interface EventStoreMetrics {
  /** Total de eventos en el store (todos los aggregates). */
  totalEvents: number;
  /** Aggregates distintos. */
  totalAggregates: number;
  /** Total de appends acumulado (write throughput). */
  appendCount: number;
  /** Total de reads acumulado (read throughput). */
  readCount: number;
  /** Promedio ms de los últimos 100 reads (rolling). */
  avgReadLatencyMs: number;
  /** Promedio ms de los últimos 100 appends (rolling). */
  avgAppendLatencyMs: number;
  /** Tipos de evento únicos vistos (para descubrimiento). */
  eventTypesSeen: string[];
}
