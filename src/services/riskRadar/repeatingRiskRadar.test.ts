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

describe('Codex P2 PR #100 fixes', () => {
  it('time_cluster incluye TODOS los incidents dentro de ventana 14d', () => {
    const incidents = [
      inc({ id: '1', occurredAt: '2026-05-08T00:00:00Z' }),
      inc({ id: '2', occurredAt: '2026-05-09T00:00:00Z' }),
      inc({ id: '3', occurredAt: '2026-05-10T00:00:00Z' }),
      inc({ id: '4', occurredAt: '2026-05-11T00:00:00Z' }), // dentro de ventana, antes era omitido
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const cluster = r.patterns.find((p) => p.kind === 'time_cluster');
    expect(cluster?.occurrences).toBe(4);
    expect(cluster?.involvedIncidentIds).toContain('4');
  });

  it('time_cluster: filtra futuros (clock skew / bad import)', () => {
    const future = new Date(NOW.getTime() + 30 * 86_400_000).toISOString();
    const incidents = [
      inc({ id: '1', occurredAt: future }),
      inc({ id: '2', occurredAt: future }),
      inc({ id: '3', occurredAt: future }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    expect(r.consideredIncidents).toBe(0);
    expect(r.patterns).toHaveLength(0);
  });

  it('time_cluster: emite múltiples clusters no-superpuestos', () => {
    const incidents = [
      // Cluster 1: 3 lows enero
      inc({ id: 'a', severity: 'low', occurredAt: '2026-03-01T00:00:00Z' }),
      inc({ id: 'b', severity: 'low', occurredAt: '2026-03-02T00:00:00Z' }),
      inc({ id: 'c', severity: 'low', occurredAt: '2026-03-03T00:00:00Z' }),
      // Cluster 2: 3 criticals últimas semanas
      inc({ id: 'd', severity: 'critical', occurredAt: '2026-05-08T00:00:00Z' }),
      inc({ id: 'e', severity: 'critical', occurredAt: '2026-05-09T00:00:00Z' }),
      inc({ id: 'f', severity: 'critical', occurredAt: '2026-05-10T00:00:00Z' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const clusters = r.patterns.filter((p) => p.kind === 'time_cluster');
    expect(clusters.length).toBe(2);
    // Después del severity sort, el critical cluster aparece primero
    expect(clusters[0].severity).toBe('critical');
  });

  it('latestIso: compara por timestamp parseado (timezone offsets)', () => {
    const incidents = [
      inc({ id: '1', workerUid: 'w', occurredAt: '2026-05-11T00:15:00Z' }),
      // Este es POSTERIOR cronológicamente (23:30 GMT-3 = 02:30 UTC siguiente día)
      inc({ id: '2', workerUid: 'w', occurredAt: '2026-05-11T23:30:00-03:00' }),
      inc({ id: '3', workerUid: 'w', occurredAt: '2026-05-10T00:00:00Z' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, { minOccurrences: 3, windowDays: 90, now: NOW });
    const p = r.patterns.find((x) => x.kind === 'same_worker_repeated');
    expect(p?.lastSeenAt).toBe('2026-05-11T23:30:00-03:00');
  });

  it('time_cluster: ID estable ante backfill anterior', () => {
    // Caso 1: incident a + b + c en marzo (bucket fijo de 14d)
    const base = [
      inc({ id: 'a', occurredAt: '2026-03-10T00:00:00Z' }),
      inc({ id: 'b', occurredAt: '2026-03-11T00:00:00Z' }),
      inc({ id: 'c', occurredAt: '2026-03-12T00:00:00Z' }),
    ];
    const r1 = buildRepeatingRiskRadar(base, { minOccurrences: 3, windowDays: 90, now: NOW });
    const c1 = r1.patterns.find((p) => p.kind === 'time_cluster');
    // Backfill: el mismo cluster, mismo bucket — debería tener el mismo ID
    const withBackfill = [
      ...base,
      inc({ id: 'before', occurredAt: '2026-03-09T00:00:00Z' }),
    ];
    const r2 = buildRepeatingRiskRadar(withBackfill, { minOccurrences: 3, windowDays: 90, now: NOW });
    const c2 = r2.patterns.find((p) => p.kind === 'time_cluster');
    // ambos buckets caen en el mismo 14-d window — IDs idénticos
    expect(c2?.id).toBe(c1?.id);
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

describe('Codex P2 PR #312 round 2 fixes', () => {
  // P2 #2 — Avoid counting missing kinds as incident types.
  it('detectSameZoneMultipleKinds: legacy doc con kind="" NO infla la diversidad', () => {
    // Zona A con 2 incidentes "caída" + 1 legacy sin kind. Antes el
    // Set incluía '' como segundo "tipo" → falso patrón multi-kind.
    // Después: kinds={caída} → size=1 → no se reporta.
    const incidents = [
      inc({ id: '1', kind: 'caída', zoneId: 'A' }),
      inc({ id: '2', kind: 'caída', zoneId: 'A' }),
      inc({ id: '3', kind: '', zoneId: 'A' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, {
      minOccurrences: 3,
      windowDays: 90,
      now: NOW,
    });
    expect(
      r.patterns.find((p) => p.kind === 'same_zone_multiple_kinds'),
    ).toBeUndefined();
  });

  it('detectSameZoneMultipleKinds: docs con kind real distintos SÍ reportan', () => {
    const incidents = [
      inc({ id: '1', kind: 'caída', zoneId: 'A' }),
      inc({ id: '2', kind: 'golpe', zoneId: 'A' }),
      inc({ id: '3', kind: '', zoneId: 'A' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, {
      minOccurrences: 3,
      windowDays: 90,
      now: NOW,
    });
    const p = r.patterns.find((x) => x.kind === 'same_zone_multiple_kinds');
    expect(p).toBeDefined();
    // size=2 (caída + golpe), no =3 (con el '' contado).
    expect(p?.label).toMatch(/2 tipos de incidente/);
  });

  // P2 #4 — Avoid counting missing zones as real zones.
  it('detectSameKindAcrossZones: legacy doc con zoneId="" NO infla la diversidad', () => {
    // 2 caídas en zona A + 1 caída legacy sin zona. Antes Set incluía
    // '' como segunda "zona" → falso patrón cross-zone. Después: solo
    // zona A → size=1 → no se reporta.
    const incidents = [
      inc({ id: '1', kind: 'caída', zoneId: 'A' }),
      inc({ id: '2', kind: 'caída', zoneId: 'A' }),
      inc({ id: '3', kind: 'caída', zoneId: '' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, {
      minOccurrences: 3,
      windowDays: 90,
      now: NOW,
    });
    expect(
      r.patterns.find((p) => p.kind === 'same_kind_across_zones'),
    ).toBeUndefined();
  });

  it('detectSameKindAcrossZones: zonas reales distintas SÍ reportan', () => {
    const incidents = [
      inc({ id: '1', kind: 'caída', zoneId: 'A' }),
      inc({ id: '2', kind: 'caída', zoneId: 'B' }),
      inc({ id: '3', kind: 'caída', zoneId: '' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, {
      minOccurrences: 3,
      windowDays: 90,
      now: NOW,
    });
    const p = r.patterns.find((x) => x.kind === 'same_kind_across_zones');
    expect(p).toBeDefined();
    // size=2 (A + B), no =3 con '' contado.
    expect(p?.label).toMatch(/2 zonas distintas/);
  });

  // P2 #2 + P2 #4 combinado — kind y zoneId vacíos no forman grupo.
  it('detectores kind/zone: doc con kind="" no crea grupo bogus', () => {
    // 3 docs todos sin kind → groupBy no crea grupo "" → 0 patterns
    const incidents = [
      inc({ id: '1', kind: '', zoneId: 'A' }),
      inc({ id: '2', kind: '', zoneId: 'B' }),
      inc({ id: '3', kind: '', zoneId: 'C' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, {
      minOccurrences: 3,
      windowDays: 90,
      now: NOW,
    });
    expect(
      r.patterns.find((p) => p.kind === 'same_kind_across_zones'),
    ).toBeUndefined();
  });

  it('detectores kind/zone: doc con zoneId="" no crea grupo bogus', () => {
    const incidents = [
      inc({ id: '1', kind: 'a', zoneId: '' }),
      inc({ id: '2', kind: 'b', zoneId: '' }),
      inc({ id: '3', kind: 'c', zoneId: '' }),
    ];
    const r = buildRepeatingRiskRadar(incidents, {
      minOccurrences: 3,
      windowDays: 90,
      now: NOW,
    });
    expect(
      r.patterns.find((p) => p.kind === 'same_zone_multiple_kinds'),
    ).toBeUndefined();
  });
});
