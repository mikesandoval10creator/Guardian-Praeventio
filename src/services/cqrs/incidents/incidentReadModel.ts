// Praeventio Guard — Incident read model + projection.
//
// El read model es una proyección DERIVADA del Event Store. Vive aparte
// (otra colección, otro store), optimizada para queries. Si se pierde,
// se reconstruye completo desde el Event Store via `rebuild()`.
//
// Por qué un read model separado:
//   - Queries (listByProject, getById, byStatus) son N órdenes de
//     magnitud más frecuentes que escrituras. No queremos correr el
//     reducer en cada lectura.
//   - El read model puede tener índices custom (composite por
//     projectId+status+severity, etc.) sin tocar el Event Store.
//   - Si el shape del read model evoluciona, rebuildeamos sin tocar
//     un solo evento histórico.
//
// El proyector escucha eventos nuevos (push) o se invoca con un batch
// de eventos (pull). Ambos paths llevan a `applyEventToReadModel()`,
// que es PURE — no I/O, solo update del Map en memoria.
//
// Persistencia: el caller (típicamente un trigger Firestore o un
// reaper) llama `getReadModel()` y persiste a Firestore. Aquí
// mantenemos solo el read model in-memory.

import type { EventStore } from '../../eventStore/types.js';
import {
  applyIncidentEvent,
  type IncidentEvent,
  type IncidentState,
} from './incidentEvents.js';

// ────────────────────────────────────────────────────────────────────────
// Read model — Map de aggregateId → estado actual
// ────────────────────────────────────────────────────────────────────────

export interface IncidentReadModelSnapshot {
  /** Map id → state. */
  byId: ReadonlyMap<string, IncidentState>;
  /** Última seq global aplicada (para detectar gaps en lag). */
  lastAppliedOccurredAtIso: string | null;
  /** Total de eventos aplicados a esta proyección. */
  eventsApplied: number;
}

export class IncidentReadModel {
  private byId = new Map<string, IncidentState>();
  private lastAppliedOccurredAtIso: string | null = null;
  private eventsApplied = 0;

  /**
   * Aplica UN evento al read model. Idempotent: si el evento ya fue
   * aplicado (lo detectamos comparando sequenceNumber vs state.version),
   * es no-op.
   *
   * No-throw: si el reducer lanza (e.g. evento inválido por bug),
   * captura + log a console + skip. La invariante es "el read model
   * NUNCA bloquea por un evento corrupto" — se replay después.
   */
  applyEvent(event: IncidentEvent): void {
    try {
      const current = this.byId.get(event.aggregateId) ?? null;
      // Idempotency: si la seq del evento es <= la version del state,
      // ya fue aplicado.
      if (current && event.sequenceNumber <= current.version) {
        return;
      }
      const next = applyIncidentEvent(current, event);
      this.byId.set(event.aggregateId, next);
      this.lastAppliedOccurredAtIso = event.metadata.occurredAt;
      this.eventsApplied += 1;
    } catch (err) {
       
      console.warn(
        `[IncidentReadModel] applyEvent skip ${event.eventId} (${event.eventType}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  applyBatch(events: readonly IncidentEvent[]): void {
    // Ordenar por (aggregateId, sequenceNumber) para minimizar resets
    // del state entre aggregates.
    const sorted = [...events].sort((a, b) => {
      if (a.aggregateId !== b.aggregateId) {
        return a.aggregateId < b.aggregateId ? -1 : 1;
      }
      return a.sequenceNumber - b.sequenceNumber;
    });
    for (const e of sorted) this.applyEvent(e);
  }

  /**
   * Rebuild completo desde el Event Store. Borra el estado actual y
   * relee TODOS los eventos del tipo. Caro pero seguro — útil si el
   * read model se corrompe o el shape cambia.
   */
  async rebuild(
    store: EventStore,
    tenantId: string,
  ): Promise<void> {
    this.byId.clear();
    this.lastAppliedOccurredAtIso = null;
    this.eventsApplied = 0;
    const events = (await store.readByType('incident', tenantId)) as IncidentEvent[];
    this.applyBatch(events);
  }

  // ────────────────────────────────────────────────────────────────────
  // Query API (consultas read-only)
  // ────────────────────────────────────────────────────────────────────

  getById(id: string): IncidentState | null {
    return this.byId.get(id) ?? null;
  }

  /** Todos los incidentes (ordenados por occurredAt desc por default). */
  listAll(options: { sortDir?: 'asc' | 'desc' } = {}): IncidentState[] {
    const arr = [...this.byId.values()];
    arr.sort((a, b) => {
      const cmp =
        a.occurredAtIso < b.occurredAtIso
          ? -1
          : a.occurredAtIso > b.occurredAtIso
            ? 1
            : 0;
      return options.sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }

  listByProject(projectId: string): IncidentState[] {
    return this.listAll().filter((i) => i.projectId === projectId);
  }

  listByStatus(status: IncidentState['status']): IncidentState[] {
    return this.listAll().filter((i) => i.status === status);
  }

  listBySeverity(severity: IncidentState['severity']): IncidentState[] {
    return this.listAll().filter((i) => i.severity === severity);
  }

  listOpenByProject(projectId: string): IncidentState[] {
    return this.listAll().filter(
      (i) => i.projectId === projectId && i.status !== 'closed',
    );
  }

  /**
   * Counts agregados que el dashboard consume. Reemplaza Math.random()
   * con números REALES.
   */
  countsByStatus(): Record<IncidentState['status'], number> {
    const acc: Record<IncidentState['status'], number> = {
      open: 0,
      investigating: 0,
      closed: 0,
    };
    for (const inc of this.byId.values()) {
      acc[inc.status] += 1;
    }
    return acc;
  }

  countsBySeverity(): Record<IncidentState['severity'], number> {
    const acc: Record<IncidentState['severity'], number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
      sif: 0,
    };
    for (const inc of this.byId.values()) {
      acc[inc.severity] += 1;
    }
    return acc;
  }

  /**
   * Snapshot inmutable del read model. Útil para hidratar la UI sin
   * acoplar al objeto interno.
   */
  snapshot(): IncidentReadModelSnapshot {
    return {
      byId: new Map(this.byId),
      lastAppliedOccurredAtIso: this.lastAppliedOccurredAtIso,
      eventsApplied: this.eventsApplied,
    };
  }

  /**
   * Métricas del read model — útil para el dashboard CQRS para
   * detectar "lag" entre Event Store y read model.
   */
  getMetrics(): {
    aggregateCount: number;
    eventsApplied: number;
    lastAppliedOccurredAtIso: string | null;
  } {
    return {
      aggregateCount: this.byId.size,
      eventsApplied: this.eventsApplied,
      lastAppliedOccurredAtIso: this.lastAppliedOccurredAtIso,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Query handlers — lectura SOLO desde read model (CQRS strict)
// ────────────────────────────────────────────────────────────────────────

/**
 * El read model es la ÚNICA fuente para queries. NUNCA leemos eventos
 * directamente del store para responder una query — eso sería event
 * sourcing on-read, mata performance.
 *
 * Estos handlers son thin wrappers para que el caller (endpoint,
 * componente React) tenga un import limpio "ask the model".
 */
export interface IncidentQueries {
  getById(id: string): IncidentState | null;
  listByProject(projectId: string): IncidentState[];
  listOpenByProject(projectId: string): IncidentState[];
  listByStatus(status: IncidentState['status']): IncidentState[];
  countsByStatus(): Record<IncidentState['status'], number>;
  countsBySeverity(): Record<IncidentState['severity'], number>;
}

export function makeIncidentQueries(model: IncidentReadModel): IncidentQueries {
  return {
    getById: (id) => model.getById(id),
    listByProject: (pid) => model.listByProject(pid),
    listOpenByProject: (pid) => model.listOpenByProject(pid),
    listByStatus: (s) => model.listByStatus(s),
    countsByStatus: () => model.countsByStatus(),
    countsBySeverity: () => model.countsBySeverity(),
  };
}
