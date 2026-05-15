// Praeventio Guard — Incident aggregate: eventos + reducer.
//
// El aggregate `Incident` es el primer caso de uso CQRS productivo:
// crear, actualizar severidad, asignar investigador, agregar evidencia,
// cerrar con causa raíz. Cada acción se materializa como un evento de
// dominio en el Event Store.
//
// Por qué `Incident` primero:
//   - Es el dominio más auditado (Ley 16.744 art. 76, ISO 45001 §10.2)
//   - Tiene linaje histórico claro (eventos están ORDENADOS y no se
//     pierde el "qué se sabía cuando")
//   - El read model (lista de incidentes) es el query más caliente
//     (dashboard, exports, métricas TRIR/LTIFR)
//
// El reducer reconstruye el estado completo desde 0 reproducción los
// eventos. Esto significa:
//   - El read model se puede REBUILDEAR desde el Event Store en
//     cualquier momento (replay = single source of truth)
//   - Si el read model se corrompe, se borra y se reconstruye
//   - El audit es "free": replay hasta un punto en el tiempo = estado
//     histórico exacto

import type { DomainEvent } from '../../eventStore/types.js';

// ────────────────────────────────────────────────────────────────────────
// Event payload types (discriminated by eventType)
// ────────────────────────────────────────────────────────────────────────

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical' | 'sif';
export type IncidentStatus = 'open' | 'investigating' | 'closed';

export interface IncidentCreatedPayload {
  description: string;
  occurredAtIso: string;
  reportedByUid: string;
  initialSeverity: IncidentSeverity;
  location?: string;
  involvedWorkerUids?: string[];
}

export interface IncidentSeverityChangedPayload {
  newSeverity: IncidentSeverity;
  reason: string;
}

export interface IncidentInvestigatorAssignedPayload {
  investigatorUid: string;
}

export interface IncidentEvidenceAddedPayload {
  evidenceId: string;
  kind: 'photo' | 'video' | 'document' | 'witness_statement';
  storageUrl?: string;
  description?: string;
}

export interface IncidentWorkerAddedPayload {
  workerUid: string;
}

export interface IncidentClosedPayload {
  closedByUid: string;
  rootCauseSummary: string;
  preventiveActions: string[];
  reopenable: boolean;
}

export interface IncidentReopenedPayload {
  reopenedByUid: string;
  reason: string;
}

/** Union de todos los event types de Incident. */
export type IncidentEvent =
  | DomainEvent<IncidentCreatedPayload> & { eventType: 'incident.created' }
  | DomainEvent<IncidentSeverityChangedPayload> & {
      eventType: 'incident.severity_changed';
    }
  | DomainEvent<IncidentInvestigatorAssignedPayload> & {
      eventType: 'incident.investigator_assigned';
    }
  | DomainEvent<IncidentEvidenceAddedPayload> & {
      eventType: 'incident.evidence_added';
    }
  | DomainEvent<IncidentWorkerAddedPayload> & {
      eventType: 'incident.worker_added';
    }
  | DomainEvent<IncidentClosedPayload> & { eventType: 'incident.closed' }
  | DomainEvent<IncidentReopenedPayload> & { eventType: 'incident.reopened' };

// ────────────────────────────────────────────────────────────────────────
// Aggregate state (read model row for this aggregate)
// ────────────────────────────────────────────────────────────────────────

export interface IncidentState {
  id: string;
  projectId: string;
  tenantId: string;
  description: string;
  occurredAtIso: string;
  reportedByUid: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  location?: string;
  involvedWorkerUids: string[];
  investigatorUid?: string;
  evidence: Array<{
    evidenceId: string;
    kind: 'photo' | 'video' | 'document' | 'witness_statement';
    storageUrl?: string;
    description?: string;
    addedAtIso: string;
  }>;
  rootCauseSummary?: string;
  preventiveActions: string[];
  closedAtIso?: string;
  closedByUid?: string;
  reopenedAtIso?: string;
  reopenedReason?: string;
  /** Última seq aplicada — útil para detectar gaps en projecciones. */
  version: number;
  /** Snapshots de cambios de severidad — útil para análisis de drift. */
  severityHistory: Array<{
    fromSeverity: IncidentSeverity;
    toSeverity: IncidentSeverity;
    reason: string;
    changedAtIso: string;
  }>;
}

// ────────────────────────────────────────────────────────────────────────
// Reducer — events → state
// ────────────────────────────────────────────────────────────────────────

/**
 * Aplica un evento al state actual. Pure function — no mutación, devuelve
 * un nuevo state. Si el evento no aplica (e.g. closed sobre un aggregate
 * ya closed), el reducer lanza — el caller (command handler) DEBE
 * validar antes de appendear.
 */
export function applyIncidentEvent(
  state: IncidentState | null,
  event: IncidentEvent,
): IncidentState {
  switch (event.eventType) {
    case 'incident.created': {
      if (state) {
        throw new Error(
          `incident.created event on existing aggregate ${event.aggregateId}`,
        );
      }
      const p = event.payload;
      return {
        id: event.aggregateId,
        projectId: event.metadata.projectId ?? '',
        tenantId: event.metadata.tenantId,
        description: p.description,
        occurredAtIso: p.occurredAtIso,
        reportedByUid: p.reportedByUid,
        severity: p.initialSeverity,
        status: 'open',
        location: p.location,
        involvedWorkerUids: [...(p.involvedWorkerUids ?? [])],
        evidence: [],
        preventiveActions: [],
        version: event.sequenceNumber,
        severityHistory: [],
      };
    }

    case 'incident.severity_changed': {
      if (!state) throw new Error('severity_changed event with no aggregate');
      if (state.status === 'closed') {
        throw new Error('cannot change severity on closed incident');
      }
      const p = event.payload;
      return {
        ...state,
        severity: p.newSeverity,
        severityHistory: [
          ...state.severityHistory,
          {
            fromSeverity: state.severity,
            toSeverity: p.newSeverity,
            reason: p.reason,
            changedAtIso: event.metadata.occurredAt,
          },
        ],
        version: event.sequenceNumber,
      };
    }

    case 'incident.investigator_assigned': {
      if (!state) throw new Error('investigator_assigned with no aggregate');
      if (state.status === 'closed') {
        throw new Error('cannot assign investigator to closed incident');
      }
      return {
        ...state,
        investigatorUid: event.payload.investigatorUid,
        // Asignar investigator implícitamente mueve a 'investigating'
        // (si estaba en 'open').
        status: state.status === 'open' ? 'investigating' : state.status,
        version: event.sequenceNumber,
      };
    }

    case 'incident.evidence_added': {
      if (!state) throw new Error('evidence_added with no aggregate');
      const p = event.payload;
      // Idempotency a nivel de aggregate: si ya existe ese evidenceId,
      // no lo duplicamos (re-replay del mismo evento puede pasar).
      if (state.evidence.some((e) => e.evidenceId === p.evidenceId)) {
        return { ...state, version: event.sequenceNumber };
      }
      return {
        ...state,
        evidence: [
          ...state.evidence,
          {
            evidenceId: p.evidenceId,
            kind: p.kind,
            storageUrl: p.storageUrl,
            description: p.description,
            addedAtIso: event.metadata.occurredAt,
          },
        ],
        version: event.sequenceNumber,
      };
    }

    case 'incident.worker_added': {
      if (!state) throw new Error('worker_added with no aggregate');
      const uid = event.payload.workerUid;
      if (state.involvedWorkerUids.includes(uid)) {
        return { ...state, version: event.sequenceNumber };
      }
      return {
        ...state,
        involvedWorkerUids: [...state.involvedWorkerUids, uid],
        version: event.sequenceNumber,
      };
    }

    case 'incident.closed': {
      if (!state) throw new Error('closed with no aggregate');
      if (state.status === 'closed') {
        throw new Error('incident already closed');
      }
      const p = event.payload;
      return {
        ...state,
        status: 'closed',
        closedAtIso: event.metadata.occurredAt,
        closedByUid: p.closedByUid,
        rootCauseSummary: p.rootCauseSummary,
        preventiveActions: [...p.preventiveActions],
        version: event.sequenceNumber,
      };
    }

    case 'incident.reopened': {
      if (!state) throw new Error('reopened with no aggregate');
      if (state.status !== 'closed') {
        throw new Error('cannot reopen non-closed incident');
      }
      return {
        ...state,
        status: 'investigating',
        reopenedAtIso: event.metadata.occurredAt,
        reopenedReason: event.payload.reason,
        // Mantenemos closedAtIso + rootCauseSummary como historial.
        version: event.sequenceNumber,
      };
    }

    default: {
      // Exhaustive check via never trick.
      const _exhaustive: never = event;
      throw new Error(
        `unknown incident event type: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Reduce una secuencia ordenada de eventos a un state. Si el array está
 * vacío, devuelve null (no existe el aggregate).
 *
 * Esto es la operación FUNDAMENTAL de event sourcing:
 *   state = events.reduce(applyEvent, null)
 *
 * Permite "replay desde cero" para reconstruir state desde el Event
 * Store, o reconstruir state en un punto del tiempo histórico.
 */
export function reduceIncidentEvents(
  events: readonly IncidentEvent[],
): IncidentState | null {
  if (events.length === 0) return null;
  let state: IncidentState | null = null;
  for (const e of events) {
    state = applyIncidentEvent(state, e);
  }
  return state;
}
