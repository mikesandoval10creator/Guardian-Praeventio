import { describe, it, expect } from 'vitest';
import {
  executeAuditReplay,
  diffStates,
  exportComplianceTrail,
  ReplayAuditError,
  type DomainEventLike,
  type EventStoreLike,
  type ReplayQuery,
  type ReplayResult,
} from './eventReplayAuditTool.js';

// ────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────

function ev(over: Partial<DomainEventLike>): DomainEventLike {
  return {
    id: 'e1',
    occurredAt: '2026-05-01T10:00:00Z',
    type: 'incident.created',
    entityRef: 'incident:abc',
    tenantId: 't1',
    actorUid: 'sup-1',
    payload: { severity: 'medium' },
    schemaVersion: 1,
    ...over,
  };
}

/** Store fake mínimo. Ordena cronológicamente como el real. */
function fakeStore(events: DomainEventLike[]): EventStoreLike {
  return {
    listByEntity(tenantId, entityRef) {
      return events
        .filter((e) => e.tenantId === tenantId && e.entityRef === entityRef)
        .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    },
  };
}

interface IncidentState {
  severity?: string;
  status?: string;
  closedAt?: string;
}

function incidentReducer(state: IncidentState, e: DomainEventLike): IncidentState {
  switch (e.type) {
    case 'incident.created':
      return { ...state, severity: e.payload.severity as string, status: 'open' };
    case 'incident.severity_changed':
      return { ...state, severity: e.payload.severity as string };
    case 'incident.closed':
      return { ...state, status: 'closed', closedAt: e.occurredAt };
    default:
      return state;
  }
}

function baseQuery(over: Partial<ReplayQuery> = {}): ReplayQuery {
  return {
    tenantId: 't1',
    entityRef: 'incident:abc',
    pointInTime: '2026-05-31T23:59:59Z',
    auditorUid: 'auditor-1',
    reason: 'compliance_audit',
    ...over,
  };
}

const NOW = '2026-05-13T12:00:00Z';

// ────────────────────────────────────────────────────────────────────────
// executeAuditReplay
// ────────────────────────────────────────────────────────────────────────

describe('executeAuditReplay - validation', () => {
  it('tenantId vacío → missing_tenant', () => {
    const store = fakeStore([]);
    expect(() =>
      executeAuditReplay(store, baseQuery({ tenantId: '' }), {}, incidentReducer, NOW),
    ).toThrowError(/missing_tenant/);
  });

  it('entityRef vacío → missing_entity', () => {
    const store = fakeStore([]);
    expect(() =>
      executeAuditReplay(store, baseQuery({ entityRef: undefined }), {}, incidentReducer, NOW),
    ).toThrowError(/missing_entity/);
  });

  it('auditorUid vacío → missing_auditor', () => {
    const store = fakeStore([]);
    expect(() =>
      executeAuditReplay(store, baseQuery({ auditorUid: '' }), {}, incidentReducer, NOW),
    ).toThrowError(/missing_auditor/);
  });

  it('pointInTime inválido → bad_point_in_time', () => {
    const store = fakeStore([]);
    expect(() =>
      executeAuditReplay(store, baseQuery({ pointInTime: 'not-a-date' }), {}, incidentReducer, NOW),
    ).toThrowError(/bad_point_in_time/);
  });

  it('reason inválido → bad_reason', () => {
    const store = fakeStore([]);
    expect(() =>
      executeAuditReplay(
        store,
        baseQuery({ reason: 'pizza' as ReplayQuery['reason'] }),
        {},
        incidentReducer,
        NOW,
      ),
    ).toThrowError(/bad_reason/);
  });

  it('errores son instancia de ReplayAuditError', () => {
    const store = fakeStore([]);
    try {
      executeAuditReplay(store, baseQuery({ tenantId: '' }), {}, incidentReducer, NOW);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReplayAuditError);
      expect((err as ReplayAuditError).code).toBe('missing_tenant');
    }
  });
});

describe('executeAuditReplay - reconstruction', () => {
  it('reconstruye state aplicando eventos cronológicamente', () => {
    const store = fakeStore([
      ev({ id: 'e1', occurredAt: '2026-05-01T10:00:00Z', type: 'incident.created', payload: { severity: 'medium' } }),
      ev({ id: 'e2', occurredAt: '2026-05-05T10:00:00Z', type: 'incident.severity_changed', payload: { severity: 'high' } }),
      ev({ id: 'e3', occurredAt: '2026-05-10T10:00:00Z', type: 'incident.closed', payload: {} }),
    ]);
    const result = executeAuditReplay<IncidentState>(store, baseQuery(), {}, incidentReducer, NOW);
    expect(result.reconstructedState.severity).toBe('high');
    expect(result.reconstructedState.status).toBe('closed');
    expect(result.eventsApplied).toBe(3);
  });

  it('respeta pointInTime — eventos posteriores NO se aplican', () => {
    const store = fakeStore([
      ev({ id: 'e1', occurredAt: '2026-05-01T10:00:00Z', type: 'incident.created', payload: { severity: 'medium' } }),
      ev({ id: 'e2', occurredAt: '2026-05-15T10:00:00Z', type: 'incident.severity_changed', payload: { severity: 'high' } }),
    ]);
    const result = executeAuditReplay<IncidentState>(
      store,
      baseQuery({ pointInTime: '2026-05-10T00:00:00Z' }),
      {},
      incidentReducer,
      NOW,
    );
    expect(result.reconstructedState.severity).toBe('medium');
    expect(result.eventsApplied).toBe(1);
  });

  it('eventTypeIn filtra solo los tipos solicitados', () => {
    const store = fakeStore([
      ev({ id: 'e1', occurredAt: '2026-05-01T10:00:00Z', type: 'incident.created', payload: { severity: 'low' } }),
      ev({ id: 'e2', occurredAt: '2026-05-05T10:00:00Z', type: 'incident.severity_changed', payload: { severity: 'high' } }),
      ev({ id: 'e3', occurredAt: '2026-05-10T10:00:00Z', type: 'incident.closed', payload: {} }),
    ]);
    const result = executeAuditReplay<IncidentState>(
      store,
      baseQuery({ eventTypeIn: ['incident.severity_changed'] }),
      {},
      incidentReducer,
      NOW,
    );
    // Solo se aplicó severity_changed → status nunca se seteó.
    expect(result.reconstructedState.status).toBeUndefined();
    expect(result.reconstructedState.severity).toBe('high');
    expect(result.eventsApplied).toBe(1);
    // eventsScanned cuenta todos (3) — el filter de tipo es post-window.
    expect(result.auditEntry.eventsScanned).toBe(3);
  });

  it('eventTypeBreakdown agrega por tipo', () => {
    const store = fakeStore([
      ev({ id: 'e1', occurredAt: '2026-05-01T10:00:00Z', type: 'incident.created' }),
      ev({ id: 'e2', occurredAt: '2026-05-02T10:00:00Z', type: 'incident.severity_changed' }),
      ev({ id: 'e3', occurredAt: '2026-05-03T10:00:00Z', type: 'incident.severity_changed' }),
      ev({ id: 'e4', occurredAt: '2026-05-04T10:00:00Z', type: 'incident.closed' }),
    ]);
    const result = executeAuditReplay<IncidentState>(store, baseQuery(), {}, incidentReducer, NOW);
    expect(result.eventTypeBreakdown).toEqual({
      'incident.created': 1,
      'incident.severity_changed': 2,
      'incident.closed': 1,
    });
  });

  it('multi-tenant: NO lee eventos de otro tenant', () => {
    const store = fakeStore([
      ev({ id: 'e1', tenantId: 't1', payload: { severity: 'low' } }),
      ev({ id: 'e2', tenantId: 't2', payload: { severity: 'high' } }),
    ]);
    const result = executeAuditReplay<IncidentState>(store, baseQuery(), {}, incidentReducer, NOW);
    expect(result.reconstructedState.severity).toBe('low');
    expect(result.eventsApplied).toBe(1);
  });

  it('sin eventos → state inicial, breakdown vacío', () => {
    const store = fakeStore([]);
    const initial: IncidentState = { status: 'unknown' };
    const result = executeAuditReplay<IncidentState>(store, baseQuery(), initial, incidentReducer, NOW);
    expect(result.reconstructedState).toEqual(initial);
    expect(result.eventsApplied).toBe(0);
    expect(result.eventTypeBreakdown).toEqual({});
  });
});

describe('executeAuditReplay - audit entry', () => {
  it('audit entry contiene metadata completa', () => {
    const store = fakeStore([ev({})]);
    const result = executeAuditReplay<IncidentState>(
      store,
      baseQuery({ reason: 'legal_request', auditorUid: 'lawyer-77' }),
      {},
      incidentReducer,
      NOW,
    );
    expect(result.auditEntry.auditorUid).toBe('lawyer-77');
    expect(result.auditEntry.reason).toBe('legal_request');
    expect(result.auditEntry.executedAt).toBe(NOW);
    expect(result.auditEntry.eventsScanned).toBe(1);
    expect(result.auditEntry.queryId).toContain('lawyer-77');
    expect(result.auditEntry.queryId).toContain('legal_request');
  });

  it('queryId determinístico con nowOverride fijo', () => {
    const store = fakeStore([ev({})]);
    const r1 = executeAuditReplay<IncidentState>(store, baseQuery(), {}, incidentReducer, NOW);
    const r2 = executeAuditReplay<IncidentState>(store, baseQuery(), {}, incidentReducer, NOW);
    expect(r1.auditEntry.queryId).toBe(r2.auditEntry.queryId);
  });

  it('queryId distinto cuando cambia el auditor', () => {
    const store = fakeStore([ev({})]);
    const r1 = executeAuditReplay<IncidentState>(store, baseQuery({ auditorUid: 'a' }), {}, incidentReducer, NOW);
    const r2 = executeAuditReplay<IncidentState>(store, baseQuery({ auditorUid: 'b' }), {}, incidentReducer, NOW);
    expect(r1.auditEntry.queryId).not.toBe(r2.auditEntry.queryId);
  });
});

// ────────────────────────────────────────────────────────────────────────
// diffStates
// ────────────────────────────────────────────────────────────────────────

describe('diffStates', () => {
  it('detecta campo cambiado', () => {
    const diff = diffStates(
      { severity: 'low', status: 'open' },
      { severity: 'high', status: 'open' },
      { beforeAt: '2026-05-01T00:00:00Z', afterAt: '2026-05-10T00:00:00Z' },
    );
    expect(diff.changedFields).toEqual([{ field: 'severity', before: 'low', after: 'high' }]);
  });

  it('detecta campo agregado', () => {
    const diff = diffStates(
      { severity: 'low' },
      { severity: 'low', closedAt: '2026-05-10T00:00:00Z' },
      { beforeAt: '2026-05-01T00:00:00Z', afterAt: '2026-05-10T00:00:00Z' },
    );
    expect(diff.changedFields).toEqual([
      { field: 'closedAt', before: undefined, after: '2026-05-10T00:00:00Z' },
    ]);
  });

  it('detecta campo removido', () => {
    const diff = diffStates(
      { severity: 'low', tempField: 'x' },
      { severity: 'low' },
      { beforeAt: '2026-05-01T00:00:00Z', afterAt: '2026-05-10T00:00:00Z' },
    );
    expect(diff.changedFields).toEqual([{ field: 'tempField', before: 'x', after: undefined }]);
  });

  it('sin cambios → changedFields vacío', () => {
    const diff = diffStates(
      { severity: 'low' },
      { severity: 'low' },
      { beforeAt: '2026-05-01T00:00:00Z', afterAt: '2026-05-10T00:00:00Z' },
    );
    expect(diff.changedFields).toEqual([]);
  });

  it('changedFields en orden alfabético', () => {
    const diff = diffStates(
      { zeta: 1, alpha: 1, beta: 1 },
      { zeta: 2, alpha: 2, beta: 2 },
      { beforeAt: 'a', afterAt: 'b' },
    );
    expect(diff.changedFields.map((c) => c.field)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('compara objetos anidados via JSON', () => {
    const diff = diffStates(
      { meta: { a: 1 } },
      { meta: { a: 2 } },
      { beforeAt: 'a', afterAt: 'b' },
    );
    expect(diff.changedFields).toHaveLength(1);
    expect(diff.changedFields[0].field).toBe('meta');
  });

  it('preserva beforeAt y afterAt', () => {
    const diff = diffStates(
      { x: 1 },
      { x: 2 },
      { beforeAt: '2026-01-01T00:00:00Z', afterAt: '2026-02-01T00:00:00Z' },
    );
    expect(diff.beforeAt).toBe('2026-01-01T00:00:00Z');
    expect(diff.afterAt).toBe('2026-02-01T00:00:00Z');
  });
});

// ────────────────────────────────────────────────────────────────────────
// exportComplianceTrail
// ────────────────────────────────────────────────────────────────────────

function fakeResult(over: Partial<ReplayResult<unknown>> = {}): ReplayResult<unknown> {
  return {
    entityRef: 'incident:abc',
    pointInTime: '2026-05-31T23:59:59Z',
    reconstructedState: { severity: 'high' },
    eventsApplied: 3,
    eventTypeBreakdown: { 'incident.created': 1, 'incident.closed': 1 },
    auditEntry: {
      queryId: 'audit|t1|incident:abc|2026-05-31T23:59:59Z|auditor-1|compliance_audit|3|2026-05-13T12:00:00Z',
      auditorUid: 'auditor-1',
      reason: 'compliance_audit',
      executedAt: '2026-05-13T12:00:00Z',
      eventsScanned: 3,
    },
    ...over,
  };
}

describe('exportComplianceTrail', () => {
  it('markdown contiene header y tabla', () => {
    const out = exportComplianceTrail({ replays: [fakeResult()], format: 'markdown' });
    expect(out).toContain('# Compliance Replay Trail');
    expect(out).toContain('| Query ID |');
    expect(out).toContain('incident:abc');
    expect(out).toContain('compliance_audit');
  });

  it('markdown incluye breakdown por tipo', () => {
    const out = exportComplianceTrail({ replays: [fakeResult()], format: 'markdown' });
    expect(out).toContain('incident.created: 1');
    expect(out).toContain('incident.closed: 1');
  });

  it('csv tiene header + 1 fila por replay', () => {
    const out = exportComplianceTrail({
      replays: [fakeResult({ entityRef: 'incident:a' }), fakeResult({ entityRef: 'incident:b' })],
      format: 'csv',
    });
    const lines = out.split('\n');
    expect(lines[0]).toBe(
      'query_id,entity_ref,point_in_time,auditor_uid,reason,events_applied,events_scanned,executed_at',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('incident:a');
    expect(lines[2]).toContain('incident:b');
  });

  it('csv escapa comas y comillas', () => {
    const out = exportComplianceTrail({
      replays: [fakeResult({ entityRef: 'incident:a,b' })],
      format: 'csv',
    });
    expect(out).toContain('"incident:a,b"');
  });

  it('NO incluye reconstructedState (PII protection)', () => {
    const out = exportComplianceTrail({
      replays: [fakeResult({ reconstructedState: { secretSSN: '123-45-6789' } })],
      format: 'markdown',
    });
    expect(out).not.toContain('123-45-6789');
    expect(out).not.toContain('secretSSN');
  });

  it('empty replays → throws empty_export', () => {
    expect(() => exportComplianceTrail({ replays: [], format: 'markdown' })).toThrowError(/empty_export/);
  });

  it('bad format → throws bad_format', () => {
    expect(() =>
      exportComplianceTrail({
        replays: [fakeResult()],
        // @ts-expect-error testing runtime guard
        format: 'xml',
      }),
    ).toThrowError(/bad_format/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// End-to-end: replay → diff → export
// ────────────────────────────────────────────────────────────────────────

describe('e2e flow', () => {
  it('reconstruye dos puntos en el tiempo + diff + export markdown', () => {
    const store = fakeStore([
      ev({ id: 'e1', occurredAt: '2026-05-01T10:00:00Z', type: 'incident.created', payload: { severity: 'low' } }),
      ev({ id: 'e2', occurredAt: '2026-05-10T10:00:00Z', type: 'incident.severity_changed', payload: { severity: 'high' } }),
      ev({ id: 'e3', occurredAt: '2026-05-15T10:00:00Z', type: 'incident.closed', payload: {} }),
    ]);

    const r1 = executeAuditReplay<IncidentState>(
      store,
      baseQuery({ pointInTime: '2026-05-05T00:00:00Z', auditorUid: 'a' }),
      {},
      incidentReducer,
      NOW,
    );
    const r2 = executeAuditReplay<IncidentState>(
      store,
      baseQuery({ pointInTime: '2026-05-20T00:00:00Z', auditorUid: 'a' }),
      {},
      incidentReducer,
      NOW,
    );

    expect(r1.reconstructedState.severity).toBe('low');
    expect(r2.reconstructedState.status).toBe('closed');

    const diff = diffStates(r1.reconstructedState, r2.reconstructedState, {
      beforeAt: r1.pointInTime,
      afterAt: r2.pointInTime,
    });
    const fields = diff.changedFields.map((c) => c.field).sort();
    expect(fields).toContain('severity');
    expect(fields).toContain('status');

    const trail = exportComplianceTrail({ replays: [r1, r2], format: 'markdown' });
    expect(trail).toContain('# Compliance Replay Trail');
    expect(trail).toContain('Total replays: 2');
  });
});
