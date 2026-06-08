import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '../../eventStore/inMemoryEventStore.js';
import {
  handleCreateIncident,
  handleChangeSeverity,
  handleAssignInvestigator,
  handleAddEvidence,
  handleAddWorker,
  handleCloseIncident,
  handleReopenIncident,
  IncidentCommandError,
} from './incidentCommands.js';
import {
  reduceIncidentEvents,
  type IncidentEvent,
} from './incidentEvents.js';

let store: InMemoryEventStore;
let nowMs = 1_700_000_000_000;
const nowIso = () => new Date(nowMs++).toISOString();

beforeEach(() => {
  store = new InMemoryEventStore(() => nowMs);
  nowMs = 1_700_000_000_000;
});

const ctx = () => ({ store, nowIso });

const createCmdBase = () => ({
  kind: 'incident.create' as const,
  aggregateId: 'inc-1',
  issuedByUid: 'sup-1',
  tenantId: 'tenant-1',
  projectId: 'proj-1',
  payload: {
    description: 'Trabajador resbaló en plataforma húmeda nivel 4',
    occurredAtIso: '2026-05-14T10:00:00Z',
    initialSeverity: 'medium' as const,
    location: 'Túnel 4',
    involvedWorkerUids: ['w-1'],
  },
});

// ────────────────────────────────────────────────────────────────────────

describe('handleCreateIncident', () => {
  it('happy path: emite incident.created', async () => {
    const events = await handleCreateIncident(ctx(), createCmdBase());
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('incident.created');
    expect(events[0]!.sequenceNumber).toBe(1);
  });

  it('descripción corta: throws INVALID_PAYLOAD', async () => {
    const cmd = { ...createCmdBase(), payload: { ...createCmdBase().payload, description: 'x' } };
    await expect(handleCreateIncident(ctx(), cmd)).rejects.toThrow(IncidentCommandError);
  });

  it('aggregate ya existe: throws AGGREGATE_ALREADY_EXISTS', async () => {
    await handleCreateIncident(ctx(), createCmdBase());
    await expect(handleCreateIncident(ctx(), createCmdBase())).rejects.toThrow(
      /AGGREGATE_ALREADY_EXISTS/,
    );
  });

  it('replay reconstruye estado completo', async () => {
    const events = await handleCreateIncident(ctx(), createCmdBase());
    const state = reduceIncidentEvents(events as IncidentEvent[]);
    expect(state).not.toBeNull();
    expect(state!.severity).toBe('medium');
    expect(state!.status).toBe('open');
    expect(state!.involvedWorkerUids).toEqual(['w-1']);
  });
});

describe('handleChangeSeverity', () => {
  beforeEach(async () => {
    await handleCreateIncident(ctx(), createCmdBase());
  });

  it('cambio válido: emite severity_changed', async () => {
    const events = await handleChangeSeverity(ctx(), {
      kind: 'incident.change_severity',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: {
        newSeverity: 'critical',
        reason: 'Trabajador con fractura confirmada, ya en mutualidad',
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('incident.severity_changed');
  });

  it('misma severidad: no-op (no emite evento)', async () => {
    const events = await handleChangeSeverity(ctx(), {
      kind: 'incident.change_severity',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { newSeverity: 'medium', reason: 'sin cambio observado en evaluación' },
    });
    expect(events).toEqual([]);
  });

  it('reason corto: throws', async () => {
    await expect(
      handleChangeSeverity(ctx(), {
        kind: 'incident.change_severity',
        aggregateId: 'inc-1',
        issuedByUid: 'sup-1',
        tenantId: 'tenant-1',
        payload: { newSeverity: 'high', reason: 'x' },
      }),
    ).rejects.toThrow(/INVALID_PAYLOAD/);
  });

  it('aggregate no existe: throws AGGREGATE_NOT_FOUND', async () => {
    await expect(
      handleChangeSeverity(ctx(), {
        kind: 'incident.change_severity',
        aggregateId: 'inc-999',
        issuedByUid: 'sup-1',
        tenantId: 'tenant-1',
        payload: { newSeverity: 'high', reason: 'cambio justificado por evaluación' },
      }),
    ).rejects.toThrow(/AGGREGATE_NOT_FOUND/);
  });

  it('tenant mismatch: throws TENANT_MISMATCH', async () => {
    await expect(
      handleChangeSeverity(ctx(), {
        kind: 'incident.change_severity',
        aggregateId: 'inc-1',
        issuedByUid: 'sup-1',
        tenantId: 'tenant-OTRO',
        payload: { newSeverity: 'high', reason: 'cambio justificado por evaluación' },
      }),
    ).rejects.toThrow(/TENANT_MISMATCH/);
  });
});

describe('handleAssignInvestigator', () => {
  beforeEach(async () => {
    await handleCreateIncident(ctx(), createCmdBase());
  });

  it('asigna y cambia status a investigating', async () => {
    await handleAssignInvestigator(ctx(), {
      kind: 'incident.assign_investigator',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { investigatorUid: 'inv-1' },
    });
    const events = (await store.read('inc-1')) as IncidentEvent[];
    const state = reduceIncidentEvents(events)!;
    expect(state.investigatorUid).toBe('inv-1');
    expect(state.status).toBe('investigating');
  });

  it('mismo investigator: no-op', async () => {
    await handleAssignInvestigator(ctx(), {
      kind: 'incident.assign_investigator',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { investigatorUid: 'inv-1' },
    });
    const events = await handleAssignInvestigator(ctx(), {
      kind: 'incident.assign_investigator',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { investigatorUid: 'inv-1' },
    });
    expect(events).toEqual([]);
  });
});

describe('handleAddEvidence + handleAddWorker', () => {
  beforeEach(async () => {
    await handleCreateIncident(ctx(), createCmdBase());
  });

  it('add evidence: emite event', async () => {
    const events = await handleAddEvidence(ctx(), {
      kind: 'incident.add_evidence',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: {
        evidenceId: 'ev-1',
        kind: 'photo',
        storageUrl: 'https://storage/foo.jpg',
        description: 'plataforma post-incidente',
      },
    });
    expect(events).toHaveLength(1);
  });

  it('add evidence duplicada: no-op', async () => {
    await handleAddEvidence(ctx(), {
      kind: 'incident.add_evidence',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { evidenceId: 'ev-1', kind: 'photo' },
    });
    const events = await handleAddEvidence(ctx(), {
      kind: 'incident.add_evidence',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { evidenceId: 'ev-1', kind: 'photo' },
    });
    expect(events).toEqual([]);
  });

  it('add worker incremental', async () => {
    await handleAddWorker(ctx(), {
      kind: 'incident.add_worker',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { workerUid: 'w-99' },
    });
    const events = (await store.read('inc-1')) as IncidentEvent[];
    const state = reduceIncidentEvents(events)!;
    expect(state.involvedWorkerUids).toContain('w-99');
    expect(state.involvedWorkerUids).toContain('w-1');
  });
});

describe('handleCloseIncident', () => {
  it('happy path: asigna investigator + cierra', async () => {
    await handleCreateIncident(ctx(), createCmdBase());
    await handleAssignInvestigator(ctx(), {
      kind: 'incident.assign_investigator',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { investigatorUid: 'inv-1' },
    });
    await handleCloseIncident(ctx(), {
      kind: 'incident.close',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: {
        rootCauseSummary: 'plataforma sin antideslizante por mantenimiento atrasado',
        preventiveActions: ['instalar antideslizante', 'auditoría semanal de mantención'],
        reopenable: false,
      },
    });
    const events = (await store.read('inc-1')) as IncidentEvent[];
    const state = reduceIncidentEvents(events)!;
    expect(state.status).toBe('closed');
    expect(state.preventiveActions).toHaveLength(2);
  });

  it('sin investigator: throws INVARIANT_VIOLATED', async () => {
    await handleCreateIncident(ctx(), createCmdBase());
    await expect(
      handleCloseIncident(ctx(), {
        kind: 'incident.close',
        aggregateId: 'inc-1',
        issuedByUid: 'sup-1',
        tenantId: 'tenant-1',
        payload: {
          rootCauseSummary: 'una descripción larga del root cause descubierto',
          preventiveActions: ['acción'],
          reopenable: false,
        },
      }),
    ).rejects.toThrow(/INVARIANT_VIOLATED/);
  });

  it('sin acciones preventivas: throws INVALID_PAYLOAD', async () => {
    await handleCreateIncident(ctx(), createCmdBase());
    await handleAssignInvestigator(ctx(), {
      kind: 'incident.assign_investigator',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { investigatorUid: 'inv-1' },
    });
    await expect(
      handleCloseIncident(ctx(), {
        kind: 'incident.close',
        aggregateId: 'inc-1',
        issuedByUid: 'sup-1',
        tenantId: 'tenant-1',
        payload: {
          rootCauseSummary: 'una descripción larga del root cause descubierto',
          preventiveActions: [],
          reopenable: false,
        },
      }),
    ).rejects.toThrow(/INVALID_PAYLOAD/);
  });

  it('reopen sobre cerrado: emite reopened y status vuelve a investigating', async () => {
    await handleCreateIncident(ctx(), createCmdBase());
    await handleAssignInvestigator(ctx(), {
      kind: 'incident.assign_investigator',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: { investigatorUid: 'inv-1' },
    });
    await handleCloseIncident(ctx(), {
      kind: 'incident.close',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-1',
      tenantId: 'tenant-1',
      payload: {
        rootCauseSummary: 'root cause sufficient length here',
        preventiveActions: ['a1'],
        reopenable: true,
      },
    });
    await handleReopenIncident(ctx(), {
      kind: 'incident.reopen',
      aggregateId: 'inc-1',
      issuedByUid: 'sup-2',
      tenantId: 'tenant-1',
      payload: { reason: 'nueva evidencia indica más causas que las descubiertas inicialmente' },
    });
    const events = (await store.read('inc-1')) as IncidentEvent[];
    const state = reduceIncidentEvents(events)!;
    expect(state.status).toBe('investigating');
    expect(state.reopenedReason).toMatch(/nueva evidencia/);
  });

  it('reopen sobre no-cerrado: throws', async () => {
    await handleCreateIncident(ctx(), createCmdBase());
    await expect(
      handleReopenIncident(ctx(), {
        kind: 'incident.reopen',
        aggregateId: 'inc-1',
        issuedByUid: 'sup-2',
        tenantId: 'tenant-1',
        payload: { reason: 'una razón suficientemente larga para audit log' },
      }),
    ).rejects.toThrow(/INVARIANT_VIOLATED/);
  });
});

describe('generateEventId — crypto event identity (CLAUDE.md #15)', () => {
  it('emits a non-empty unique eventId per created incident (no Math.random collisions)', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const freshStore = new InMemoryEventStore(() => nowMs);
      const cmd = { ...createCmdBase(), aggregateId: `inc-${i}` };
      const events = await handleCreateIncident({ store: freshStore, nowIso }, cmd);
      expect(events).toHaveLength(1);
      const id = (events[0] as IncidentEvent).eventId;
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      seen.add(id);
    }
    expect(seen.size).toBe(50);
  });
});
