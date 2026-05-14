// Praeventio Guard — In-memory Event Store.
//
// Implementación REAL del Event Store usando Map en memoria. Es el
// store que usa el dev mode + tests, y la base sobre la que se
// construye el Firestore adapter (que delega lectura/escritura pero
// reusa la lógica de seq + idempotency aquí mockeada).
//
// Por qué empezar in-memory:
//   - Tests determinísticos sin Firestore emulator
//   - Dev mode arranca instantáneo
//   - Permite el patrón "snapshot in-memory + persist a Firestore"
//     sin un round-trip por write
//
// Limitaciones:
//   - Pierde estado en page reload (caller hidrata desde Firestore
//     al boot via `replay`)
//   - Multi-tab no sincronizado (caller maneja eso con cross-tab sync
//     events de Firestore o broadcast)

import {
  EventStore,
  EventStoreError,
  EventStoreMetrics,
  type DomainEvent,
} from './types.js';

interface RollingLatency {
  samples: number[];
  maxSamples: number;
}

function pushLatency(r: RollingLatency, ms: number): void {
  r.samples.push(ms);
  if (r.samples.length > r.maxSamples) r.samples.shift();
}

function avgLatency(r: RollingLatency): number {
  if (r.samples.length === 0) return 0;
  const sum = r.samples.reduce((a, b) => a + b, 0);
  return Math.round(sum / r.samples.length);
}

/**
 * Implementación in-memory del Event Store. Map<aggregateId, ordered events[]>.
 * Concurrent append usa el sequenceNumber del último evento como
 * `expectedSeq` check.
 */
export class InMemoryEventStore implements EventStore {
  /** Map aggregateId → ordered events (seq asc). */
  private readonly streams = new Map<string, DomainEvent[]>();
  /** Set de eventIds ya vistos — para detectar idempotency replays. */
  private readonly seenEventIds = new Set<string>();
  /** Set de tipos de evento únicos vistos. */
  private readonly typesSeen = new Set<string>();

  /** Counters observables. */
  private appendCount = 0;
  private readCount = 0;
  private readonly appendLatency: RollingLatency = { samples: [], maxSamples: 100 };
  private readonly readLatency: RollingLatency = { samples: [], maxSamples: 100 };

  /** Clock injectable for tests. */
  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async append(
    events: DomainEvent[],
    options: { expectedSeq?: number } = {},
  ): Promise<DomainEvent[]> {
    if (events.length === 0) return [];

    const startedAt = this.nowMs();

    // Validar mismo aggregateId.
    const aggregateId = events[0]!.aggregateId;
    if (!events.every((e) => e.aggregateId === aggregateId)) {
      throw new EventStoreError(
        'INVALID_SEQUENCE',
        'append batch debe ser para un solo aggregateId',
      );
    }

    // Validar tenant consistency.
    const tenantId = events[0]!.metadata.tenantId;
    if (!events.every((e) => e.metadata.tenantId === tenantId)) {
      throw new EventStoreError(
        'TENANT_MISMATCH',
        'append batch debe ser para un solo tenant',
      );
    }

    // Validar sequenceNumbers consecutivos dentro del batch.
    for (let i = 1; i < events.length; i++) {
      if (events[i]!.sequenceNumber !== events[i - 1]!.sequenceNumber + 1) {
        throw new EventStoreError(
          'INVALID_SEQUENCE',
          `sequenceNumbers no consecutivos: ${events[i - 1]!.sequenceNumber} → ${events[i]!.sequenceNumber}`,
        );
      }
    }

    const stream = this.streams.get(aggregateId) ?? [];
    const currentSeq = stream.length === 0 ? 0 : stream[stream.length - 1]!.sequenceNumber;
    const firstNewSeq = events[0]!.sequenceNumber;

    // Idempotency check: si el primer eventId ya está, devolvemos los
    // existentes (no es un error — el caller reintentó).
    if (this.seenEventIds.has(events[0]!.eventId)) {
      // Devolver los eventos previamente persistidos con esos ids.
      const fromSeq = firstNewSeq;
      const toSeq = events[events.length - 1]!.sequenceNumber;
      return stream.filter(
        (e) => e.sequenceNumber >= fromSeq && e.sequenceNumber <= toSeq,
      );
    }

    // Optimistic concurrency check.
    if (options.expectedSeq !== undefined && options.expectedSeq !== currentSeq) {
      throw new EventStoreError(
        'CONCURRENCY_CONFLICT',
        `expectedSeq=${options.expectedSeq} pero el store está en seq=${currentSeq}`,
      );
    }

    // Validar que el primer evento del batch tenga seq = currentSeq + 1.
    if (firstNewSeq !== currentSeq + 1) {
      throw new EventStoreError(
        'INVALID_SEQUENCE',
        `primer evento del batch tiene seq=${firstNewSeq}, expected ${currentSeq + 1}`,
      );
    }

    // OK — append.
    for (const e of events) {
      stream.push(e);
      this.seenEventIds.add(e.eventId);
      this.typesSeen.add(e.eventType);
    }
    this.streams.set(aggregateId, stream);

    this.appendCount += events.length;
    pushLatency(this.appendLatency, this.nowMs() - startedAt);

    return events;
  }

  async read(
    aggregateId: string,
    options: { fromSeq?: number; toSeq?: number } = {},
  ): Promise<DomainEvent[]> {
    const startedAt = this.nowMs();
    const stream = this.streams.get(aggregateId) ?? [];
    const from = options.fromSeq ?? 1;
    const to = options.toSeq ?? Number.POSITIVE_INFINITY;
    const result = stream.filter(
      (e) => e.sequenceNumber >= from && e.sequenceNumber <= to,
    );
    this.readCount += result.length;
    pushLatency(this.readLatency, this.nowMs() - startedAt);
    return result;
  }

  async readByType(
    aggregateType: string,
    tenantId: string,
    options: { sinceIso?: string; limit?: number } = {},
  ): Promise<DomainEvent[]> {
    const startedAt = this.nowMs();
    const since = options.sinceIso ?? '0000-01-01T00:00:00.000Z';
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    const out: DomainEvent[] = [];
    for (const stream of this.streams.values()) {
      for (const e of stream) {
        if (
          e.aggregateType === aggregateType &&
          e.metadata.tenantId === tenantId &&
          e.metadata.occurredAt >= since
        ) {
          out.push(e);
          if (out.length >= limit) break;
        }
      }
      if (out.length >= limit) break;
    }
    // Sort by occurredAt asc (orden global cross-aggregate).
    out.sort((a, b) =>
      a.metadata.occurredAt < b.metadata.occurredAt
        ? -1
        : a.metadata.occurredAt > b.metadata.occurredAt
          ? 1
          : 0,
    );
    this.readCount += out.length;
    pushLatency(this.readLatency, this.nowMs() - startedAt);
    return out;
  }

  async currentVersion(aggregateId: string): Promise<number> {
    const stream = this.streams.get(aggregateId);
    if (!stream || stream.length === 0) return 0;
    return stream[stream.length - 1]!.sequenceNumber;
  }

  async getMetrics(): Promise<EventStoreMetrics> {
    let total = 0;
    for (const s of this.streams.values()) total += s.length;
    return {
      totalEvents: total,
      totalAggregates: this.streams.size,
      appendCount: this.appendCount,
      readCount: this.readCount,
      avgAppendLatencyMs: avgLatency(this.appendLatency),
      avgReadLatencyMs: avgLatency(this.readLatency),
      eventTypesSeen: [...this.typesSeen].sort(),
    };
  }

  /**
   * Helper para tests: borra TODO el store. NO disponible en
   * producción (el Event Store es append-only por contrato).
   */
  __resetForTests(): void {
    this.streams.clear();
    this.seenEventIds.clear();
    this.typesSeen.clear();
    this.appendCount = 0;
    this.readCount = 0;
    this.appendLatency.samples.length = 0;
    this.readLatency.samples.length = 0;
  }
}
