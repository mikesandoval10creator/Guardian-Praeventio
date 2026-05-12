import { describe, it, expect } from 'vitest';
import {
  buildRepeatingRiskRadar,
  toInboxAlerts,
  type IncidentSample,
} from './repeatingRiskRadar.js';

const NOW = new Date('2026-05-12T22:00:00Z');

function inc(over: Partial<IncidentSample> & Pick<IncidentSample, 'id'>): IncidentSample {
  return {
    occurredAt: '2026-05-10T10:00:00Z',
    kind: 'caída',
    zoneId: 'zone-A',
    severity: 'medium',
    ...over,
  };
}

describe('buildRepeatingRiskRadar', () => {
  it('sin incidents → 0 patterns', () => {
    const r = buildRepeatingRiskRadar([], { minOccurrences: 3, windowDays: 90, now: NOW });
    expect(r.patterns).toEqual([]);
    expect(r.totalPatterns).toBe(0);
    expect(r.maxSeverity).toBe('low');
  });

  it('detecta same_kind_across_zones cuando ≥3 mismo kind en zonas distintas', () => {
    const incidents = [
      inc({ id: '1', kind: 'caída', zoneId: 'A' }),
      inc({ id: '2', kind: 'caída', zoneId: 'B' }),
      inc({ id: '3', kind: 'caída', zoneId: 'C' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const p = r.patterns.find((x) => x.kind === 'same_kind_across_zones');
    expect(p).toBeDefined();
    expect(p?.occurrences).toBe(3);
  });

  it('NO detecta same_kind si todas en la misma zona', () => {
    const incidents = [
      inc({ id: '1', kind: 'caída', zoneId: 'A' }),
      inc({ id: '2', kind: 'caída', zoneId: 'A' }),
      inc({ id: '3', kind: 'caída', zoneId: 'A' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    expect(r.patterns.find((p) => p.kind === 'same_kind_across_zones')).toBeUndefined();
  });

  it('detecta same_zone_multiple_kinds', () => {
    const incidents = [
      inc({ id: '1', kind: 'caída', zoneId: 'A' }),
      inc({ id: '2', kind: 'golpe', zoneId: 'A' }),
      inc({ id: '3', kind: 'atrapamiento', zoneId: 'A' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const p = r.patterns.find((x) => x.kind === 'same_zone_multiple_kinds');
    expect(p).toBeDefined();
    expect(p?.label).toMatch(/Zona A/);
  });

  it('detecta same_worker_repeated', () => {
    const incidents = [
      inc({ id: '1', workerUid: 'w1' }),
      inc({ id: '2', workerUid: 'w1' }),
      inc({ id: '3', workerUid: 'w1' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const p = r.patterns.find((x) => x.kind === 'same_worker_repeated');
    expect(p).toBeDefined();
    expect(p?.recommendedAction).toMatch(/NO sancionar/);
  });

  it('detecta same_task_repeated', () => {
    const incidents = [
      inc({ id: '1', taskId: 't1' }),
      inc({ id: '2', taskId: 't1' }),
      inc({ id: '3', taskId: 't1' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    expect(r.patterns.find((x) => x.kind === 'same_task_repeated')).toBeDefined();
  });

  it('detecta night_shift pattern + recomendación específica', () => {
    const incidents = [
      inc({ id: '1', shift: 'night' }),
      inc({ id: '2', shift: 'night' }),
      inc({ id: '3', shift: 'night' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const p = r.patterns.find((x) => x.kind === 'same_shift_pattern');
    expect(p?.recommendedAction).toMatch(/fatiga.*iluminación.*supervisión.*nocturno/);
  });

  it('detecta time_cluster en ventana corta', () => {
    const incidents = [
      inc({ id: '1', occurredAt: '2026-05-08T00:00:00Z' }),
      inc({ id: '2', occurredAt: '2026-05-09T00:00:00Z' }),
      inc({ id: '3', occurredAt: '2026-05-10T00:00:00Z' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    expect(r.patterns.find((x) => x.kind === 'time_cluster')).toBeDefined();
  });

  it('respeta windowDays — excluye antiguos', () => {
    const incidents = [
      inc({ id: 'old1', kind: 'k', zoneId: 'A', occurredAt: '2025-01-01T00:00:00Z' }),
      inc({ id: 'old2', kind: 'k', zoneId: 'B', occurredAt: '2025-01-02T00:00:00Z' }),
      inc({ id: 'old3', kind: 'k', zoneId: 'C', occurredAt: '2025-01-03T00:00:00Z' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 30, now: NOW });
    expect(r.consideredIncidents).toBe(0);
    expect(r.patterns).toHaveLength(0);
  });

  it('maxSeverity es la peor de los patterns', () => {
    const incidents = [
      inc({ id: '1', workerUid: 'w1', severity: 'critical' }),
      inc({ id: '2', workerUid: 'w1', severity: 'low' }),
      inc({ id: '3', workerUid: 'w1', severity: 'medium' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    expect(r.maxSeverity).toBe('critical');
  });

  it('ordena por severity desc, luego occurrences', () => {
    const incidents = [
      // worker w1 → 3 (medium)
      inc({ id: '1', workerUid: 'w1' }),
      inc({ id: '2', workerUid: 'w1' }),
      inc({ id: '3', workerUid: 'w1' }),
      // worker w2 → 4 (critical)
      inc({ id: '4', workerUid: 'w2', severity: 'critical' }),
      inc({ id: '5', workerUid: 'w2', severity: 'critical' }),
      inc({ id: '6', workerUid: 'w2', severity: 'critical' }),
      inc({ id: '7', workerUid: 'w2', severity: 'critical' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const workerPatterns = r.patterns.filter((p) => p.kind === 'same_worker_repeated');
    expect(workerPatterns[0].severity).toBe('critical');
  });

  it('lastSeenAt es el más reciente de los involucrados', () => {
    const incidents = [
      inc({ id: '1', workerUid: 'w1', occurredAt: '2026-04-01T00:00:00Z' }),
      inc({ id: '2', workerUid: 'w1', occurredAt: '2026-05-08T00:00:00Z' }),
      inc({ id: '3', workerUid: 'w1', occurredAt: '2026-05-10T00:00:00Z' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const p = r.patterns.find((x) => x.kind === 'same_worker_repeated');
    expect(p?.lastSeenAt).toBe('2026-05-10T00:00:00Z');
  });
});

describe('toInboxAlerts', () => {
  it('mapea patterns a shape compatible con F.8', () => {
    // Spread temporal para evitar time_cluster (>14 días entre primero y último)
    const incidents = [
      inc({ id: '1', workerUid: 'w1', occurredAt: '2026-03-01T00:00:00Z' }),
      inc({ id: '2', workerUid: 'w1', occurredAt: '2026-04-01T00:00:00Z' }),
      inc({ id: '3', workerUid: 'w1', occurredAt: '2026-05-10T10:00:00Z' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const alerts = toInboxAlerts(r);
    const workerAlert = alerts.find((a) => a.id === 'same_worker:w1');
    expect(workerAlert).toBeDefined();
    expect(workerAlert?.occurrences).toBe(3);
    expect(workerAlert?.label).toMatch(/Trabajador w1/);
    expect(workerAlert?.lastSeenAt).toBe('2026-05-10T10:00:00Z');
  });
});
