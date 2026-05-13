import { describe, it, expect } from 'vitest';
import {
  buildTrendSeries,
  comparePeriods,
  detectOutliers,
  rankCategories,
  type IncidentRecord,
} from './trendAnalyzer.js';

function inc(over: Partial<IncidentRecord> & Pick<IncidentRecord, 'id'>): IncidentRecord {
  return {
    occurredAt: '2026-05-10T10:00:00Z',
    severity: 'medium',
    category: 'caída',
    ...over,
  };
}

describe('buildTrendSeries', () => {
  it('empty → empty points + avgCount 0', () => {
    const r = buildTrendSeries([], 'month');
    expect(r.points).toEqual([]);
    expect(r.avgCount).toBe(0);
    expect(r.direction).toBe('stable');
  });

  it('agrupa por mes', () => {
    const incidents: IncidentRecord[] = [
      inc({ id: '1', occurredAt: '2026-01-15T00:00:00Z' }),
      inc({ id: '2', occurredAt: '2026-01-20T00:00:00Z' }),
      inc({ id: '3', occurredAt: '2026-02-05T00:00:00Z' }),
    ];
    const r = buildTrendSeries(incidents, 'month');
    expect(r.points).toHaveLength(2);
    expect(r.points[0].bucket).toBe('2026-01');
    expect(r.points[0].count).toBe(2);
    expect(r.points[1].count).toBe(1);
  });

  it('agrupa por día', () => {
    const incidents: IncidentRecord[] = [
      inc({ id: '1', occurredAt: '2026-05-10T10:00:00Z' }),
      inc({ id: '2', occurredAt: '2026-05-10T15:00:00Z' }),
      inc({ id: '3', occurredAt: '2026-05-11T08:00:00Z' }),
    ];
    const r = buildTrendSeries(incidents, 'day');
    expect(r.points).toHaveLength(2);
    expect(r.points[0].bucket).toBe('2026-05-10');
    expect(r.points[0].count).toBe(2);
  });

  it('agrupa por semana con clave ISO Www', () => {
    const incidents: IncidentRecord[] = [
      inc({ id: '1', occurredAt: '2026-05-04T00:00:00Z' }),
      inc({ id: '2', occurredAt: '2026-05-07T00:00:00Z' }),
    ];
    const r = buildTrendSeries(incidents, 'week');
    expect(r.points).toHaveLength(1);
    expect(r.points[0].bucket).toMatch(/^2026-W\d{2}$/);
  });

  it('bySeverity acumula correctamente', () => {
    const incidents: IncidentRecord[] = [
      inc({ id: '1', occurredAt: '2026-01-15T00:00:00Z', severity: 'critical' }),
      inc({ id: '2', occurredAt: '2026-01-20T00:00:00Z', severity: 'high' }),
      inc({ id: '3', occurredAt: '2026-01-25T00:00:00Z', severity: 'high' }),
    ];
    const r = buildTrendSeries(incidents, 'month');
    expect(r.points[0].bySeverity.critical).toBe(1);
    expect(r.points[0].bySeverity.high).toBe(2);
    expect(r.points[0].bySeverity.low).toBe(0);
  });

  it('direction rising cuando slope positivo significativo', () => {
    const incidents: IncidentRecord[] = [];
    for (let m = 1; m <= 5; m++) {
      // Mes m tiene m incidents → tendencia clara al alza
      for (let i = 0; i < m; i++) {
        incidents.push(inc({ id: `${m}-${i}`, occurredAt: `2026-0${m}-15T00:00:00Z` }));
      }
    }
    const r = buildTrendSeries(incidents, 'month');
    expect(r.direction).toBe('rising');
  });

  it('direction falling cuando slope negativo', () => {
    const incidents: IncidentRecord[] = [];
    for (let m = 1; m <= 5; m++) {
      const count = 6 - m;
      for (let i = 0; i < count; i++) {
        incidents.push(inc({ id: `${m}-${i}`, occurredAt: `2026-0${m}-15T00:00:00Z` }));
      }
    }
    const r = buildTrendSeries(incidents, 'month');
    expect(r.direction).toBe('falling');
  });

  it('direction stable cuando counts iguales', () => {
    const incidents: IncidentRecord[] = [];
    for (let m = 1; m <= 5; m++) {
      for (let i = 0; i < 3; i++) {
        incidents.push(inc({ id: `${m}-${i}`, occurredAt: `2026-0${m}-15T00:00:00Z` }));
      }
    }
    const r = buildTrendSeries(incidents, 'month');
    expect(r.direction).toBe('stable');
  });

  it('moving average 3 tiene la misma longitud que counts', () => {
    const incidents: IncidentRecord[] = [
      inc({ id: '1', occurredAt: '2026-01-15T00:00:00Z' }),
      inc({ id: '2', occurredAt: '2026-02-15T00:00:00Z' }),
      inc({ id: '3', occurredAt: '2026-03-15T00:00:00Z' }),
    ];
    const r = buildTrendSeries(incidents, 'month');
    expect(r.movingAvg3.length).toBe(r.points.length);
  });

  it('Codex P2 PR #102: rellena buckets vacíos entre primer y último', () => {
    const incidents: IncidentRecord[] = [
      inc({ id: '1', occurredAt: '2026-01-15T00:00:00Z' }),
      inc({ id: '2', occurredAt: '2026-04-15T00:00:00Z' }), // gap Feb+Mar
    ];
    const r = buildTrendSeries(incidents, 'month');
    expect(r.points.length).toBe(4); // Jan + Feb(0) + Mar(0) + Apr
    expect(r.points[1].count).toBe(0);
    expect(r.points[2].count).toBe(0);
  });

  it('ignora timestamps inválidos', () => {
    const incidents: IncidentRecord[] = [
      inc({ id: '1', occurredAt: 'not-a-date' }),
      inc({ id: '2', occurredAt: '2026-01-15T00:00:00Z' }),
    ];
    const r = buildTrendSeries(incidents, 'month');
    expect(r.points).toHaveLength(1);
  });
});

describe('comparePeriods', () => {
  const incidents: IncidentRecord[] = [
    inc({ id: 'p1', occurredAt: '2026-04-15T00:00:00Z' }),
    inc({ id: 'p2', occurredAt: '2026-04-20T00:00:00Z' }),
    inc({ id: 'p3', occurredAt: '2026-04-25T00:00:00Z' }),
    inc({ id: 'c1', occurredAt: '2026-05-10T00:00:00Z' }),
    inc({ id: 'c2', occurredAt: '2026-05-20T00:00:00Z' }),
  ];

  it('detecta caída -33% (3→2) → falling', () => {
    const r = comparePeriods(incidents, {
      previousStart: new Date('2026-04-01T00:00:00Z'),
      previousEnd: new Date('2026-05-01T00:00:00Z'),
      currentStart: new Date('2026-05-01T00:00:00Z'),
      currentEnd: new Date('2026-06-01T00:00:00Z'),
    });
    expect(r.previousTotal).toBe(3);
    expect(r.currentTotal).toBe(2);
    expect(r.direction).toBe('falling');
    expect(r.deltaPercent).toBe(-33);
  });

  it('subida nuevo período + sin histórico → 100%', () => {
    const r = comparePeriods(incidents, {
      previousStart: new Date('2025-01-01T00:00:00Z'),
      previousEnd: new Date('2025-02-01T00:00:00Z'),
      currentStart: new Date('2026-05-01T00:00:00Z'),
      currentEnd: new Date('2026-06-01T00:00:00Z'),
    });
    expect(r.previousTotal).toBe(0);
    expect(r.deltaPercent).toBe(100);
    expect(r.direction).toBe('rising');
  });
});

describe('detectOutliers', () => {
  it('detecta picos 3σ', () => {
    const incidents: IncidentRecord[] = [];
    // baseline: 2 incidents por mes × 5 meses
    for (let m = 1; m <= 5; m++) {
      for (let i = 0; i < 2; i++) {
        incidents.push(inc({ id: `${m}-${i}`, occurredAt: `2026-0${m}-15T00:00:00Z` }));
      }
    }
    // outlier: mes 6 con 20 incidents
    for (let i = 0; i < 20; i++) {
      incidents.push(inc({ id: `6-${i}`, occurredAt: '2026-06-15T00:00:00Z' }));
    }
    const series = buildTrendSeries(incidents, 'month');
    // Codex P2 PR #102: con leave-one-out baseline, los 5 valores [2,2,2,2,2]
    // tienen std=0 sin el candidato → el 20 es outlier automático (default 3σ).
    const outliers = detectOutliers(series);
    expect(outliers.length).toBeGreaterThan(0);
    expect(outliers[0].bucket).toBe('2026-06');
  });

  it('sin outliers cuando varianza baja', () => {
    const incidents: IncidentRecord[] = [];
    for (let m = 1; m <= 5; m++) {
      for (let i = 0; i < 3; i++) {
        incidents.push(inc({ id: `${m}-${i}`, occurredAt: `2026-0${m}-15T00:00:00Z` }));
      }
    }
    const series = buildTrendSeries(incidents, 'month');
    expect(detectOutliers(series)).toEqual([]);
  });
});

describe('rankCategories', () => {
  it('ordena por count desc + cap top N', () => {
    const incidents: IncidentRecord[] = [
      inc({ id: '1', category: 'caída' }),
      inc({ id: '2', category: 'caída' }),
      inc({ id: '3', category: 'caída' }),
      inc({ id: '4', category: 'golpe' }),
      inc({ id: '5', category: 'electrico' }),
    ];
    const r = rankCategories(incidents, 3);
    expect(r[0].category).toBe('caída');
    expect(r[0].count).toBe(3);
    expect(r[0].percentOfTotal).toBe(60);
    expect(r).toHaveLength(3);
  });
});
