// Praeventio Guard — Incident command handlers.
//
// Cada handler:
//   1. Carga eventos previos del aggregate desde el Event Store
//   2. Reduce a state actual
//   3. Valida invariantes de dominio (reglas de negocio)
//   4. Decide qué evento(s) emitir
//   5. Appendea atómicamente al store con optimistic concurrency
//   6. Devuelve los eventos appendados (el caller los puede pasar al
//      proyector de read models)
//
// Por qué este patrón:
//   - Los handlers son la ÚNICA forma de escribir al Event Store
//   - Validación de invariantes está en UN solo lugar por command
//   - Concurrency conflicts se manejan automáticamente (retry transparente
//     o error explícito al caller)
//   - Tests se hacen sobre el handler + InMemoryEventStore — no necesitan
//     ningún mock más

import type { EventStore, Command, DomainEvent } from '../../eventStore/types.js';
import { EventStoreError } from '../../eventStore/types.js';
import {
  applyIncidentEvent,
  reduceIncidentEvents,
  type IncidentEvent,
  type IncidentSeverity,
  type IncidentState,
  type IncidentCreatedPayload,
  type IncidentSeverityChangedPayload,
  type IncidentInvestigatorAssignedPayload,
  type IncidentEvidenceAddedPayload,
  type IncidentWorkerAddedPayload,
  type IncidentClosedPayload,
  type IncidentReopenedPayload,
} from './incidentEvents.js';

// ────────────────────────────────────────────────────────────────────────
// Command types
// ────────────────────────────────────────────────────────────────────────

export type CreateIncidentCommand = Command<'incident.create', {
  description: string;
  occurredAtIso: string;
  initialSeverity: IncidentSeverity;
  location?: string;
  involvedWorkerUids?: string[];
}>;

export type ChangeIncidentSeverityCommand = Command<'incident.change_severity', {
  newSeverity: IncidentSeverity;
  reason: string;
}>;

export type AssignInvestigatorCommand = Command<'incident.assign_investigator', {
  investigatorUid: string;
}>;

export type AddIncidentEvidenceCommand = Command<'incident.add_evidence', {
  evidenceId: string;
  kind: 'photo' | 'video' | 'document' | 'witness_statement';
  storageUrl?: string;
  description?: string;
}>;

export type AddIncidentWorkerCommand = Command<'incident.add_worker', {
  workerUid: string;
}>;

export type CloseIncidentCommand = Command<'incident.close', {
  rootCauseSummary: string;
  preventiveActions: string[];
  reopenable: boolean;
}>;

export type ReopenIncidentCommand = Command<'incident.reopen', {
  reason: string;
}>;

export type AnyIncidentCommand =
  | CreateIncidentCommand
  | ChangeIncidentSeverityCommand
  | AssignInvestigatorCommand
  | AddIncidentEvidenceCommand
  | AddIncidentWorkerCommand
  | CloseIncidentCommand
  | ReopenIncidentCommand;

// ────────────────────────────────────────────────────────────────────────
// Validation errors
// ────────────────────────────────────────────────────────────────────────

export class IncidentCommandError extends Error {
  constructor(
    public readonly code:
      | 'AGGREGATE_NOT_FOUND'
      | 'AGGREGATE_ALREADY_EXISTS'
      | 'INVALID_PAYLOAD'
      | 'INVARIANT_VIOLATED'
      | 'TENANT_MISMATCH',
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'IncidentCommandError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Carga eventos del aggregate y los reduce a state. Devuelve null si no
 * existe. Pasa por la interfaz pública del Event Store — ningún acceso
 * directo al storage.
 */
async function loadAggregate(
  store: EventStore,
  aggregateId: string,
): Promise<IncidentState | null> {
  const events = (await store.read(aggregateId)) as IncidentEvent[];
  return reduceIncidentEvents(events);
}

function generateEventId(): string {
  // UUID v4 lite — suficiente para event identity (Firestore añade
  // ULID equivalente al hacer auto-id, pero queremos seedeable en tests).
  const rnd = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  return `${rnd(8)}-${rnd(4)}-${rnd(4)}-${rnd(4)}-${rnd(12)}`;
}

/**
 * Factory de eventos: el caller solo provee aggregateId + payload +
 * seq + metadata; nosotros añadimos eventId + occurredAt + tipos.
 */
function buildEvent<T>(
  aggregateId: string,
  eventType: IncidentEvent['eventType'],
  payload: T,
  seq: number,
  cmd: AnyIncidentCommand,
  nowIso: string,
): IncidentEvent {
  return {
    eventId: generateEventId(),
    aggregateId,
    aggregateType: 'incident',
    eventType,
    sequenceNumber: seq,
    payload,
    metadata: {
      occurredAt: nowIso,
      causedByUid: cmd.issuedByUid,
      tenantId: cmd.tenantId,
      projectId: cmd.projectId,
      correlationId: cmd.correlationId,
    },
  } as IncidentEvent;
}

interface HandlerCtx {
  store: EventStore;
  nowIso?: () => string;
}

function clock(ctx: HandlerCtx): string {
  return ctx.nowIso ? ctx.nowIso() : new Date().toISOString();
}

// ────────────────────────────────────────────────────────────────────────
// Command handlers
// ────────────────────────────────────────────────────────────────────────

export async function handleCreateIncident(
  ctx: HandlerCtx,
  cmd: CreateIncidentCommand,
): Promise<IncidentEvent[]> {
  if (cmd.payload.description.trim().length < 10) {
    throw new IncidentCommandError(
      'INVALID_PAYLOAD',
      'description debe tener al menos 10 caracteres',
    );
  }
  const existing = await loadAggregate(ctx.store, cmd.aggregateId);
  if (existing) {
    throw new IncidentCommandError(
      'AGGREGATE_ALREADY_EXISTS',
      `incident ${cmd.aggregateId} ya existe`,
    );
  }
  const payload: IncidentCreatedPayload = {
    description: cmd.payload.description.trim(),
    occurredAtIso: cmd.payload.occurredAtIso,
    reportedByUid: cmd.issuedByUid,
    initialSeverity: cmd.payload.initialSeverity,
    location: cmd.payload.location,
    involvedWorkerUids: cmd.payload.involvedWorkerUids ?? [],
  };
  const event = buildEvent(
    cmd.aggregateId,
    'incident.created',
    payload,
    1,
    cmd,
    clock(ctx),
  );
  return (await ctx.store.append([event], { expectedSeq: 0 })) as IncidentEvent[];
}

export async function handleChangeSeverity(
  ctx: HandlerCtx,
  cmd: ChangeIncidentSeverityCommand,
): Promise<IncidentEvent[]> {
  const state = await loadAggregate(ctx.store, cmd.aggregateId);
  if (!state) {
    throw new IncidentCommandError(
      'AGGREGATE_NOT_FOUND',
      `incident ${cmd.aggregateId} no existe`,
    );
  }
  if (state.tenantId !== cmd.tenantId) {
    throw new IncidentCommandError(
      'TENANT_MISMATCH',
      'tenantId del command no coincide con el aggregate',
    );
  }
  if (state.status === 'closed') {
    throw new IncidentCommandError(
      'INVARIANT_VIOLATED',
      'no se puede cambiar severidad de un incidente cerrado',
    );
  }
  if (cmd.payload.reason.trim().length < 10) {
    throw new IncidentCommandError(
      'INVALID_PAYLOAD',
      'reason debe tener al menos 10 caracteres (audit)',
    );
  }
  if (state.severity === cmd.payload.newSeverity) {
    // No-op semántico — devolver vacío en lugar de emitir evento spam.
    return [];
  }
  const payload: IncidentSeverityChangedPayload = {
    newSeverity: cmd.payload.newSeverity,
    reason: cmd.payload.reason.trim(),
  };
  const event = buildEvent(
    cmd.aggregateId,
    'incident.severity_changed',
    payload,
    state.version + 1,
    cmd,
    clock(ctx),
  );
  return (await ctx.store.append([event], {
    expectedSeq: state.version,
  })) as IncidentEvent[];
}

export async function handleAssignInvestigator(
  ctx: HandlerCtx,
  cmd: AssignInvestigatorCommand,
): Promise<IncidentEvent[]> {
  const state = await loadAggregate(ctx.store, cmd.aggregateId);
  if (!state) {
    throw new IncidentCommandError(
      'AGGREGATE_NOT_FOUND',
      `incident ${cmd.aggregateId} no existe`,
    );
  }
  if (state.tenantId !== cmd.tenantId) {
    throw new IncidentCommandError(
      'TENANT_MISMATCH',
      'tenantId del command no coincide',
    );
  }
  if (state.status === 'closed') {
    throw new IncidentCommandError(
      'INVARIANT_VIOLATED',
      'no se puede asignar investigador a un incidente cerrado (reabrir primero)',
    );
  }
  if (state.investigatorUid === cmd.payload.investigatorUid) {
    return [];
  }
  const payload: IncidentInvestigatorAssignedPayload = {
    investigatorUid: cmd.payload.investigatorUid,
  };
  const event = buildEvent(
    cmd.aggregateId,
    'incident.investigator_assigned',
    payload,
    state.version + 1,
    cmd,
    clock(ctx),
  );
  return (await ctx.store.append([event], {
    expectedSeq: state.version,
  })) as IncidentEvent[];
}

export async function handleAddEvidence(
  ctx: HandlerCtx,
  cmd: AddIncidentEvidenceCommand,
): Promise<IncidentEvent[]> {
  const state = await loadAggregate(ctx.store, cmd.aggregateId);
  if (!state) {
    throw new IncidentCommandError('AGGREGATE_NOT_FOUND', `incident ${cmd.aggregateId} no existe`);
  }
  if (state.tenantId !== cmd.tenantId) {
    throw new IncidentCommandError('TENANT_MISMATCH', 'tenantId mismatch');
  }
  // Idempotency: si ya está la evidencia, no emitimos.
  if (state.evidence.some((e) => e.evidenceId === cmd.payload.evidenceId)) {
    return [];
  }
  const payload: IncidentEvidenceAddedPayload = {
    evidenceId: cmd.payload.evidenceId,
    kind: cmd.payload.kind,
    storageUrl: cmd.payload.storageUrl,
    description: cmd.payload.description,
  };
  const event = buildEvent(
    cmd.aggregateId,
    'incident.evidence_added',
    payload,
    state.version + 1,
    cmd,
    clock(ctx),
  );
  return (await ctx.store.append([event], {
    expectedSeq: state.version,
  })) as IncidentEvent[];
}

export async function handleAddWorker(
  ctx: HandlerCtx,
  cmd: AddIncidentWorkerCommand,
): Promise<IncidentEvent[]> {
  const state = await loadAggregate(ctx.store, cmd.aggregateId);
  if (!state) {
    throw new IncidentCommandError('AGGREGATE_NOT_FOUND', `incident ${cmd.aggregateId} no existe`);
  }
  if (state.tenantId !== cmd.tenantId) {
    throw new IncidentCommandError('TENANT_MISMATCH', 'tenantId mismatch');
  }
  if (state.involvedWorkerUids.includes(cmd.payload.workerUid)) {
    return [];
  }
  const payload: IncidentWorkerAddedPayload = {
    workerUid: cmd.payload.workerUid,
  };
  const event = buildEvent(
    cmd.aggregateId,
    'incident.worker_added',
    payload,
    state.version + 1,
    cmd,
    clock(ctx),
  );
  return (await ctx.store.append([event], {
    expectedSeq: state.version,
  })) as IncidentEvent[];
}

export async function handleCloseIncident(
  ctx: HandlerCtx,
  cmd: CloseIncidentCommand,
): Promise<IncidentEvent[]> {
  const state = await loadAggregate(ctx.store, cmd.aggregateId);
  if (!state) {
    throw new IncidentCommandError('AGGREGATE_NOT_FOUND', `incident ${cmd.aggregateId} no existe`);
  }
  if (state.tenantId !== cmd.tenantId) {
    throw new IncidentCommandError('TENANT_MISMATCH', 'tenantId mismatch');
  }
  if (state.status === 'closed') {
    throw new IncidentCommandError('INVARIANT_VIOLATED', 'incidente ya cerrado');
  }
  if (cmd.payload.rootCauseSummary.trim().length < 20) {
    throw new IncidentCommandError(
      'INVALID_PAYLOAD',
      'rootCauseSummary debe tener al menos 20 caracteres',
    );
  }
  if (cmd.payload.preventiveActions.length === 0) {
    throw new IncidentCommandError(
      'INVALID_PAYLOAD',
      'cerrar incidente requiere al menos 1 acción preventiva (ISO 45001 §10.2)',
    );
  }
  if (!state.investigatorUid) {
    throw new IncidentCommandError(
      'INVARIANT_VIOLATED',
      'no se puede cerrar un incidente sin investigador asignado',
    );
  }
  const payload: IncidentClosedPayload = {
    closedByUid: cmd.issuedByUid,
    rootCauseSummary: cmd.payload.rootCauseSummary.trim(),
    preventiveActions: cmd.payload.preventiveActions.map((a) => a.trim()),
    reopenable: cmd.payload.reopenable,
  };
  const event = buildEvent(
    cmd.aggregateId,
    'incident.closed',
    payload,
    state.version + 1,
    cmd,
    clock(ctx),
  );
  return (await ctx.store.append([event], {
    expectedSeq: state.version,
  })) as IncidentEvent[];
}

export async function handleReopenIncident(
  ctx: HandlerCtx,
  cmd: ReopenIncidentCommand,
): Promise<IncidentEvent[]> {
  const state = await loadAggregate(ctx.store, cmd.aggregateId);
  if (!state) {
    throw new IncidentCommandError('AGGREGATE_NOT_FOUND', `incident ${cmd.aggregateId} no existe`);
  }
  if (state.tenantId !== cmd.tenantId) {
    throw new IncidentCommandError('TENANT_MISMATCH', 'tenantId mismatch');
  }
  if (state.status !== 'closed') {
    throw new IncidentCommandError(
      'INVARIANT_VIOLATED',
      'solo se pueden reabrir incidentes cerrados',
    );
  }
  if (cmd.payload.reason.trim().length < 20) {
    throw new IncidentCommandError(
      'INVALID_PAYLOAD',
      'reopen reason debe tener al menos 20 caracteres (audit)',
    );
  }
  const payload: IncidentReopenedPayload = {
    reopenedByUid: cmd.issuedByUid,
    reason: cmd.payload.reason.trim(),
  };
  const event = buildEvent(
    cmd.aggregateId,
    'incident.reopened',
    payload,
    state.version + 1,
    cmd,
    clock(ctx),
  );
  return (await ctx.store.append([event], {
    expectedSeq: state.version,
  })) as IncidentEvent[];
}

// Re-export para que el caller pueda combinar handlers sin imports verbose.
export {
  EventStoreError,
  applyIncidentEvent,
  reduceIncidentEvents,
};
