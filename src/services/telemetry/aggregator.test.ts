import { describe, it, expect } from 'vitest';
import {
  aggregateFeed,
  computeVelocities,
  rollupTenant,
  assertNoPII,
  type TelemetryEvent,
} from './aggregator.js';

const NOW = new Date('2026-05-12T22:00:00Z');

function ev(over: Partial<TelemetryEvent> & Pick<TelemetryEvent, 'id'>): TelemetryEvent {
  return {
    kind: 'incident_recorded',
    occurredAt: '2026-05-10T00:00:00Z',
    projectId: 'p1',
    tenantId: 't1',
    severity: 'medium',
    ...over,
  };
}

describe('aggregateFeed', () => {
  it('cuenta solo eventos del projectId solicitado dentro de la ventana', () => {
    const feed = aggregateFeed({
      events: [
        ev({ id: '1', projectId: 'p1', occurredAt: '2026-05-10T00:00:00Z' }),
        ev({ id: '2', projectId: 'p2', occurredAt: '2026-05-10T00:00:00Z' }),
        ev({ id: '3', projectId: 'p1', occurredAt: '2025-01-01T00:00:00Z' }), // fuera ventana
      ],
      projectId: 'p1',
      window: '7d',
      now: NOW,
    });
    expect(feed.totalEvents).toBe(1);
  });

  it('countByKind suma correctamente', () => {
    const feed = aggregateFeed({
      events: [
        ev({ id: '1', kind: 'incident_recorded' }),
        ev({ id: '2', kind: 'incident_recorded' }),
        ev({ id: '3', kind: 'training_completed' }),
      ],
      projectId: 'p1',
      window: '30d',
      now: NOW,
    });
    expect(feed.countByKind.incident_recorded).toBe(2);
    expect(feed.countByKind.training_completed).toBe(1);
  });

  it('countBySeverity suma', () => {
    const feed = aggregateFeed({
      events: [
        ev({ id: '1', severity: 'critical' }),
        ev({ id: '2', severity: 'critical' }),
        ev({ id: '3', severity: 'low' }),
      ],
      projectId: 'p1',
      window: '30d',
      now: NOW,
    });
    expect(feed.countBySeverity.critical).toBe(2);
    expect(feed.countBySeverity.low).toBe(1);
  });

  it('ventana 7d excluye eventos a 8d+ atrás', () => {
    const feed = aggregateFeed({
      events: [
        ev({ id: '1', occurredAt: '2026-05-11T00:00:00Z' }), // 1d
        ev({ id: '2', occurredAt: '2026-05-03T00:00:00Z' }), // 9d
      ],
      projectId: 'p1',
      window: '7d',
      now: NOW,
    });
    expect(feed.totalEvents).toBe(1);
  });

  it('respeta tenantId filter', () => {
    const feed = aggregateFeed({
      events: [
        ev({ id: '1', tenantId: 't1' }),
        ev({ id: '2', tenantId: 't2' }),
      ],
      projectId: 'p1',
      tenantId: 't1',
      window: '30d',
      now: NOW,
    });
    expect(feed.totalEvents).toBe(1);
  });
});

describe('computeVelocities', () => {
  it('perDay = count / windowDays', () => {
    const feed = aggregateFeed({
      events: Array.from({ length: 14 }, (_, i) => ev({ id: `${i}`, kind: 'inspection_done' })),
      projectId: 'p1',
      window: '7d',
      now: NOW,
    });
    const v = computeVelocities(feed);
    const inspection = v.find((x) => x.kind === 'inspection_done');
    expect(inspection?.perDay).toBe(2);
  });

  it('ordena por count desc', () => {
    const feed = aggregateFeed({
      events: [
        ev({ id: '1', kind: 'incident_recorded' }),
        ev({ id: '2', kind: 'incident_recorded' }),
        ev({ id: '3', kind: 'incident_recorded' }),
        ev({ id: '4', kind: 'training_completed' }),
      ],
      projectId: 'p1',
      window: '30d',
      now: NOW,
    });
    const v = computeVelocities(feed);
    expect(v[0].kind).toBe('incident_recorded');
    expect(v[0].count).toBe(3);
  });
});

describe('rollupTenant', () => {
  it('agrega N feeds del mismo tenant', () => {
    const feedP1 = aggregateFeed({
      events: [ev({ id: 'a', projectId: 'p1' }), ev({ id: 'b', projectId: 'p1' })],
      projectId: 'p1',
      tenantId: 't1',
      window: '7d',
      now: NOW,
    });
    const feedP2 = aggregateFeed({
      events: [ev({ id: 'c', projectId: 'p2' })],
      projectId: 'p2',
      tenantId: 't1',
      window: '7d',
      now: NOW,
    });
    const rollup = rollupTenant([feedP1, feedP2], 't1');
    expect(rollup.totalProjects).toBe(2);
    expect(rollup.totalEvents).toBe(3);
    expect(rollup.topProjects[0].projectId).toBe('p1');
  });

  it('topProjects ordenado por totalEvents desc', () => {
    const f1 = aggregateFeed({
      events: Array.from({ length: 10 }, (_, i) => ev({ id: `a${i}`, projectId: 'p1' })),
      projectId: 'p1',
      tenantId: 't1',
      window: '7d',
      now: NOW,
    });
    const f2 = aggregateFeed({
      events: Array.from({ length: 3 }, (_, i) => ev({ id: `b${i}`, projectId: 'p2' })),
      projectId: 'p2',
      tenantId: 't1',
      window: '7d',
      now: NOW,
    });
    const r = rollupTenant([f1, f2], 't1');
    expect(r.topProjects.map((p) => p.projectId)).toEqual(['p1', 'p2']);
  });
});

describe('assertNoPII (privacy guard)', () => {
  it('passes si el evento no tiene campos PII', () => {
    expect(() => assertNoPII({ id: '1', kind: 'incident_recorded' })).not.toThrow();
  });

  it('tira si tiene workerUid', () => {
    expect(() => assertNoPII({ id: '1', workerUid: 'w-123' })).toThrowError(/workerUid/);
  });

  it('tira si tiene fullName', () => {
    expect(() => assertNoPII({ id: '1', fullName: 'Ana Soto' })).toThrowError(/fullName/);
  });

  it('tira si tiene rut/email/phone/address', () => {
    expect(() => assertNoPII({ rut: '12345678-9' })).toThrowError(/rut/);
    expect(() => assertNoPII({ email: 'a@b.c' })).toThrowError(/email/);
    expect(() => assertNoPII({ phone: '+56' })).toThrowError(/phone/);
    expect(() => assertNoPII({ address: 'x' })).toThrowError(/address/);
  });
});
