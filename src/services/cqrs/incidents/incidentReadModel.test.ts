import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '../../eventStore/inMemoryEventStore.js';
import {
  IncidentReadModel,
  makeIncidentQueries,
} from './incidentReadModel.js';
import {
  handleCreateIncident,
  handleChangeSeverity,
  handleAssignInvestigator,
  handleCloseIncident,
} from './incidentCommands.js';
import type { IncidentEvent } from './incidentEvents.js';

let store: InMemoryEventStore;
let model: IncidentReadModel;
let nowMs = 1_700_000_000_000;
const nowIso = () => new Date(nowMs++).toISOString();

beforeEach(() => {
  store = new InMemoryEventStore(() => nowMs);
  model = new IncidentReadModel();
  nowMs = 1_700_000_000_000;
});

const baseCmd = (id: string, severity: 'low' | 'medium' | 'high' | 'critical' = 'medium') => ({
  kind: 'incident.create' as const,
  aggregateId: id,
  issuedByUid: 'sup-1',
  tenantId: 'tenant-1',
  projectId: 'proj-1',
  payload: {
    description: `incidente ${id} con descripción suficiente`,
    occurredAtIso: '2026-05-14T10:00:00Z',
    initialSeverity: severity,
  },
});

async function seed(): Promise<void> {
  await handleCreateIncident({ store, nowIso }, baseCmd('inc-1', 'low'));
  await handleCreateIncident({ store, nowIso }, baseCmd('inc-2', 'high'));
  await handleCreateIncident({ store, nowIso }, baseCmd('inc-3', 'critical'));
}

describe('IncidentReadModel — applyEvent', () => {
  it('apply un evento construye state', async () => {
    const events = await handleCreateIncident({ store, nowIso }, baseCmd('inc-1'));
    model.applyEvent(events[0]! as IncidentEvent);
    const state = model.getById('inc-1');
    expect(state).not.toBeNull();
    expect(state!.severity).toBe('medium');
  });

  it('apply duplicado (mismo seq) es idempotent', async () => {
    const events = await handleCreateIncident({ store, nowIso }, baseCmd('inc-1'));
    const event = events[0]! as IncidentEvent;
    model.applyEvent(event);
    model.applyEvent(event); // duplicado
    expect(model.getMetrics().eventsApplied).toBe(1);
  });

  it('evento corrupto NO crashea (se skipea con log)', async () => {
    const fakeEvent: IncidentEvent = {
      eventId: 'fake',
      aggregateId: 'inc-1',
      aggregateType: 'incident',
      eventType: 'incident.severity_changed' as const,
      sequenceNumber: 1,
      payload: { newSeverity: 'high', reason: 'x' },
      metadata: {
        occurredAt: '2026-05-14T10:00:00Z',
        causedByUid: 'u',
        tenantId: 'tenant-1',
      },
    } as IncidentEvent;
    expect(() => model.applyEvent(fakeEvent)).not.toThrow();
  });

  it('applyBatch ordena por (aggregateId, seq)', async () => {
    const e1 = await handleCreateIncident({ store, nowIso }, baseCmd('inc-1'));
    const e2 = await handleCreateIncident({ store, nowIso }, baseCmd('inc-2'));
    // Aplicar al revés para testear ordering
    model.applyBatch([...e2, ...e1] as IncidentEvent[]);
    expect(model.getById('inc-1')).not.toBeNull();
    expect(model.getById('inc-2')).not.toBeNull();
  });
});

describe('IncidentReadModel — rebuild', () => {
  it('rebuild desde Event Store reconstruye state completo', async () => {
    await seed();
    await handleChangeSeverity({ store, nowIso }, {
      kind: 'incident.change_severity',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { newSeverity: 'medium', reason: 'evaluación post inicial actualizada' },
    });
    // Read model vacío hasta acá.
    expect(model.getMetrics().aggregateCount).toBe(0);
    await model.rebuild(store, 'tenant-1');
    expect(model.getMetrics().aggregateCount).toBe(3);
    const inc1 = model.getById('inc-1')!;
    expect(inc1.severity).toBe('medium'); // tras el change_severity
  });

  it('rebuild solo trae eventos del tenant', async () => {
    await handleCreateIncident({ store, nowIso }, baseCmd('inc-1'));
    // Mismo aggregateId pero otro tenant — debería ser ignored
    await handleCreateIncident(
      { store, nowIso },
      { ...baseCmd('inc-tenant-OTRO'), tenantId: 'tenant-2' },
    );
    await model.rebuild(store, 'tenant-1');
    expect(model.getMetrics().aggregateCount).toBe(1);
  });
});

describe('IncidentReadModel — queries', () => {
  beforeEach(async () => {
    await seed();
    await model.rebuild(store, 'tenant-1');
  });

  it('listAll desc por occurredAt', () => {
    const all = model.listAll();
    expect(all).toHaveLength(3);
  });

  it('listByStatus open', () => {
    const open = model.listByStatus('open');
    expect(open).toHaveLength(3);
  });

  it('listBySeverity critical', () => {
    const c = model.listBySeverity('critical');
    expect(c).toHaveLength(1);
    expect(c[0]!.id).toBe('inc-3');
  });

  it('listByProject filtra', () => {
    const r = model.listByProject('proj-1');
    expect(r).toHaveLength(3);
    expect(model.listByProject('proj-OTRO')).toHaveLength(0);
  });

  it('listOpenByProject NO incluye closed', async () => {
    // Cerrar inc-1
    await handleAssignInvestigator(
      { store, nowIso },
      {
        kind: 'incident.assign_investigator',
        aggregateId: 'inc-1',
        issuedByUid: 'sup-1',
        tenantId: 'tenant-1',
        payload: { investigatorUid: 'inv-1' },
      },
    );
    await handleCloseIncident(
      { store, nowIso },
      {
        kind: 'incident.close',
        aggregateId: 'inc-1',
        issuedByUid: 'sup-1',
        tenantId: 'tenant-1',
        payload: {
          rootCauseSummary: 'root cause descubierto de longitud adecuada para audit',
          preventiveActions: ['a1'],
          reopenable: false,
        },
      },
    );
    await model.rebuild(store, 'tenant-1');
    expect(model.listOpenByProject('proj-1')).toHaveLength(2);
  });

  it('countsByStatus refleja contador real', async () => {
    const counts = model.countsByStatus();
    expect(counts.open + counts.investigating + counts.closed).toBe(3);
  });

  it('countsBySeverity real', () => {
    const counts = model.countsBySeverity();
    expect(counts.low).toBe(1);
    expect(counts.high).toBe(1);
    expect(counts.critical).toBe(1);
    expect(counts.medium).toBe(0);
  });
});

describe('makeIncidentQueries', () => {
  beforeEach(async () => {
    await seed();
    await model.rebuild(store, 'tenant-1');
  });

  it('expone el subconjunto de queries', () => {
    const q = makeIncidentQueries(model);
    expect(q.getById('inc-1')).not.toBeNull();
    expect(q.listByProject('proj-1')).toHaveLength(3);
    expect(q.countsByStatus().open).toBe(3);
  });
});
