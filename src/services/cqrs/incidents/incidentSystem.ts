// Praeventio Guard — Incident CQRS system singleton.
//
// Bundle uno-stop del Event Store + read model + command/query handlers
// para que el caller (pages, hooks, endpoints) tenga un import limpio:
//
//   import { incidentSystem } from '.../incidentSystem';
//   await incidentSystem.commands.createIncident(cmd);
//   const incs = incidentSystem.queries.listByProject(pid);
//   const metrics = await incidentSystem.getDashboardMetrics();
//
// Comportamiento:
//   - Un Event Store + read model singleton por proceso/cliente
//   - Los handlers de command auto-aplican al read model tras el append
//     (CQRS sincrónico in-process — el flujo desde Event Store al read
//     model es inmediato, no hay lag observable)
//   - getDashboardMetrics() combina métricas del store + read model
//     para alimentar el `<CQRSArchitecture />` page con números REALES.

import { InMemoryEventStore } from '../../eventStore/inMemoryEventStore.js';
import type { EventStore } from '../../eventStore/types.js';
import { IncidentReadModel, makeIncidentQueries, type IncidentQueries } from './incidentReadModel.js';
import {
  handleCreateIncident,
  handleChangeSeverity,
  handleAssignInvestigator,
  handleAddEvidence,
  handleAddWorker,
  handleCloseIncident,
  handleReopenIncident,
  type CreateIncidentCommand,
  type ChangeIncidentSeverityCommand,
  type AssignInvestigatorCommand,
  type AddIncidentEvidenceCommand,
  type AddIncidentWorkerCommand,
  type CloseIncidentCommand,
  type ReopenIncidentCommand,
} from './incidentCommands.js';
import type { IncidentEvent } from './incidentEvents.js';

export interface IncidentSystemCommands {
  createIncident(cmd: CreateIncidentCommand): Promise<IncidentEvent[]>;
  changeSeverity(cmd: ChangeIncidentSeverityCommand): Promise<IncidentEvent[]>;
  assignInvestigator(cmd: AssignInvestigatorCommand): Promise<IncidentEvent[]>;
  addEvidence(cmd: AddIncidentEvidenceCommand): Promise<IncidentEvent[]>;
  addWorker(cmd: AddIncidentWorkerCommand): Promise<IncidentEvent[]>;
  closeIncident(cmd: CloseIncidentCommand): Promise<IncidentEvent[]>;
  reopenIncident(cmd: ReopenIncidentCommand): Promise<IncidentEvent[]>;
}

export interface CqrsDashboardMetrics {
  // Event Store side
  totalEvents: number;
  totalAggregates: number;
  appendCount: number;
  readCount: number;
  avgAppendLatencyMs: number;
  avgReadLatencyMs: number;
  eventTypesSeen: string[];
  // Read model side
  readModelAggregateCount: number;
  readModelEventsApplied: number;
  readModelLastAppliedIso: string | null;
  /**
   * Lag observable: cuántos eventos hay en el store que NO están en el
   * read model. Para in-memory CQRS sincrónico debe ser 0. Si > 0,
   * indica que el rebuild está pendiente.
   */
  projectionLag: number;
}

export interface IncidentSystem {
  store: EventStore;
  model: IncidentReadModel;
  commands: IncidentSystemCommands;
  queries: IncidentQueries;
  /** Métricas en vivo para el dashboard CQRS. */
  getDashboardMetrics: () => Promise<CqrsDashboardMetrics>;
  /** Rebuild full del read model desde el store (acción admin). */
  rebuild: (tenantId: string) => Promise<void>;
}

/**
 * Construye un IncidentSystem nuevo. En producción se llama UNA vez
 * desde un module-level singleton (o desde un provider React). En tests,
 * cada test construye su propio system para aislamiento total.
 */
export function buildIncidentSystem(
  store: EventStore = new InMemoryEventStore(),
): IncidentSystem {
  const model = new IncidentReadModel();
  const queries = makeIncidentQueries(model);

  const wrap =
    <C, E>(handler: (ctx: { store: EventStore }, c: C) => Promise<E[]>) =>
    async (cmd: C): Promise<E[]> => {
      const events = await handler({ store }, cmd);
      // Auto-aplicar al read model (CQRS in-process sincrónico).
      model.applyBatch(events as unknown as IncidentEvent[]);
      return events;
    };

  const commands: IncidentSystemCommands = {
    createIncident: wrap(handleCreateIncident),
    changeSeverity: wrap(handleChangeSeverity),
    assignInvestigator: wrap(handleAssignInvestigator),
    addEvidence: wrap(handleAddEvidence),
    addWorker: wrap(handleAddWorker),
    closeIncident: wrap(handleCloseIncident),
    reopenIncident: wrap(handleReopenIncident),
  };

  return {
    store,
    model,
    commands,
    queries,
    async getDashboardMetrics() {
      const storeMetrics = await store.getMetrics();
      const modelMetrics = model.getMetrics();
      // Lag: total eventos en store vs total eventos aplicados al model.
      const projectionLag = Math.max(
        0,
        storeMetrics.totalEvents - modelMetrics.eventsApplied,
      );
      return {
        totalEvents: storeMetrics.totalEvents,
        totalAggregates: storeMetrics.totalAggregates,
        appendCount: storeMetrics.appendCount,
        readCount: storeMetrics.readCount,
        avgAppendLatencyMs: storeMetrics.avgAppendLatencyMs,
        avgReadLatencyMs: storeMetrics.avgReadLatencyMs,
        eventTypesSeen: storeMetrics.eventTypesSeen,
        readModelAggregateCount: modelMetrics.aggregateCount,
        readModelEventsApplied: modelMetrics.eventsApplied,
        readModelLastAppliedIso: modelMetrics.lastAppliedOccurredAtIso,
        projectionLag,
      };
    },
    async rebuild(tenantId: string) {
      await model.rebuild(store, tenantId);
    },
  };
}

/**
 * Singleton lazy-init. El primer caller crea el system; los siguientes
 * obtienen la misma instancia. Para tests, NO usar esto — construir
 * con `buildIncidentSystem()` directamente.
 */
let _singleton: IncidentSystem | null = null;
export function getIncidentSystem(): IncidentSystem {
  if (!_singleton) {
    _singleton = buildIncidentSystem();
  }
  return _singleton;
}

/** Test-only: resetea el singleton para aislar tests que lo usen. */
export function __resetIncidentSystemForTests(): void {
  _singleton = null;
}
