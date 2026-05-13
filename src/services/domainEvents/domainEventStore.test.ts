import { describe, it, expect } from 'vitest';
import {
  InMemoryEventStore,
  validateEvent,
  replay,
  buildSnapshot,
  DomainEventValidationError,
  type DomainEvent,
} from './domainEventStore.js';

function ev(over: Partial<DomainEvent>): DomainEvent {
  return {
    id: 'e-1',
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

describe('validateEvent', () => {
  it('happy path no tira', () => {
    expect(() => validateEvent(ev({}))).not.toThrow();
  });

  it('id vacío → missing_id', () => {
    expect(() => validateEvent(ev({ id: '' }))).toThrowError(/missing_id/);
  });

  it('occurredAt malformado → invalid_date', () => {
    expect(() => validateEvent(ev({ occurredAt: 'not-a-date' }))).toThrowError(/invalid_date/);
  });

  it('schemaVersion 0 → bad_schema_version', () => {
    expect(() => validateEvent(ev({ schemaVersion: 0 }))).toThrowError(/bad_schema_version/);
  });

  it('tenant vacío → missing_tenant', () => {
    expect(() => validateEvent(ev({ tenantId: '' }))).toThrowError(/missing_tenant/);
  });
});

describe('InMemoryEventStore append', () => {
  it('append y listByEntity ordena cronológicamente', () => {
    const s = new InMemoryEventStore();
    s.append(ev({ id: 'e2', occurredAt: '2026-05-02T00:00:00Z' }));
    s.append(ev({ id: 'e1', occurredAt: '2026-05-01T00:00:00Z' }));
    s.append(ev({ id: 'e3', occurredAt: '2026-05-03T00:00:00Z' }));
    const list = s.listByEntity('t1', 'incident:abc');
    expect(list.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('append rechaza id duplicado (append-only inmutable)', () => {
    const s = new InMemoryEventStore();
    s.append(ev({ id: 'e1' }));
    expect(() => s.append(ev({ id: 'e1' }))).toThrowError(/duplicate_id/);
  });

  it('listByEntity filtra por tenant', () => {
    const s = new InMemoryEventStore();
    s.append(ev({ id: 'a', tenantId: 't1' }));
    s.append(ev({ id: 'b', tenantId: 't2' }));
    expect(s.listByEntity('t1', 'incident:abc').map((e) => e.id)).toEqual(['a']);
  });

  it('listByCorrelation agrupa workflow multi-step', () => {
    const s = new InMemoryEventStore();
    s.append(ev({ id: 'a', correlationId: 'wf-1', occurredAt: '2026-05-01T00:00:00Z' }));
    s.append(ev({ id: 'b', correlationId: 'wf-1', occurredAt: '2026-05-01T01:00:00Z' }));
    s.append(ev({ id: 'c', correlationId: 'wf-2', occurredAt: '2026-05-01T02:00:00Z' }));
    const wf = s.listByCorrelation('t1', 'wf-1');
    expect(wf.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('replay', () => {
  it('replaya eventos desde initial state', () => {
    const s = new InMemoryEventStore();
    s.append(ev({ id: 'e1', type: 'incident.created', occurredAt: '2026-05-01T00:00:00Z', payload: { severity: 'low' } }));
    s.append(ev({ id: 'e2', type: 'incident.severity_changed', occurredAt: '2026-05-02T00:00:00Z', payload: { severity: 'high' } }));

    type State = { severity: string | null };
    const reducer = (state: State, event: DomainEvent): State => {
      if (event.type === 'incident.created' || event.type === 'incident.severity_changed') {
        return { severity: (event.payload.severity as string) ?? state.severity };
      }
      return state;
    };

    const final = replay(s, 't1', 'incident:abc', { severity: null }, reducer);
    expect(final.severity).toBe('high');
  });

  it('replay con snapshot solo aplica eventos posteriores', () => {
    const s = new InMemoryEventStore();
    s.append(ev({ id: 'e1', occurredAt: '2026-04-01T00:00:00Z', payload: { count: 1 } }));
    s.append(ev({ id: 'e2', occurredAt: '2026-05-15T00:00:00Z', payload: { count: 2 } }));

    s.saveSnapshot({
      entityRef: 'incident:abc',
      tenantId: 't1',
      asOf: '2026-04-30T23:59:59Z',
      state: { count: 1 },
      lastEventId: 'e1',
      eventsCompactedCount: 1,
    });

    type State = { count: number };
    const reducer = (state: State, event: DomainEvent): State => {
      return { count: state.count + ((event.payload.count as number) ?? 0) };
    };

    const final = replay(s, 't1', 'incident:abc', { count: 0 }, reducer);
    // Solo aplica e2 (e1 está en el snapshot)
    expect(final.count).toBe(1 + 2); // snapshot.count (1) + e2.count (2)
  });
});

describe('buildSnapshot', () => {
  it('genera snapshot con eventsCompactedCount y lastEventId', () => {
    const s = new InMemoryEventStore();
    s.append(ev({ id: 'e1', occurredAt: '2026-05-01T00:00:00Z' }));
    s.append(ev({ id: 'e2', occurredAt: '2026-05-15T00:00:00Z' }));
    s.append(ev({ id: 'e3', occurredAt: '2026-06-01T00:00:00Z' }));

    const snap = buildSnapshot(
      s,
      't1',
      'incident:abc',
      '2026-05-31T23:59:59Z',
      { count: 0 },
      (state: { count: number }) => ({ count: state.count + 1 }),
    );
    expect(snap.eventsCompactedCount).toBe(2); // e1 + e2 (no e3, está fuera)
    expect(snap.lastEventId).toBe('e2');
    expect((snap.state as { count: number }).count).toBe(2);
  });

  it('snapshot sin eventos → lastEventId vacío', () => {
    const s = new InMemoryEventStore();
    const snap = buildSnapshot(
      s,
      't1',
      'incident:none',
      '2026-05-31T23:59:59Z',
      { x: 0 },
      (state) => state,
    );
    expect(snap.lastEventId).toBe('');
    expect(snap.eventsCompactedCount).toBe(0);
  });
});
