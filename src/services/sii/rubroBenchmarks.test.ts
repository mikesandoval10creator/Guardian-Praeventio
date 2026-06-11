// Épica Rubros SII — slice 4: anonymous per-rubro benchmark engine tests.
//
// Exercises the pure k-anonymity aggregation (rule #9 module):
//   - k gate boundaries: 4 projects (deny) / 5 projects (allow)
//   - tenant-k gate: 5+ projects from <3 tenants (deny — single-tenant skew)
//   - per-metric suppression when a metric has fewer contributors than k
//   - percentile math (median / p25 / p75, linear interpolation)
//   - empty input, duplicate projectKey dedupe, non-finite value hygiene
//   - NO identifier (projectKey / tenantKey) ever appears in the output
//   - determinism under input shuffling

import { describe, it, expect } from 'vitest';
import {
  computeRubroBenchmarks,
  K_MIN_PROJECTS,
  K_MIN_TENANTS,
  RUBRO_METRIC_IDS,
  type AnonymousProjectMetrics,
  type RubroMetricId,
} from './rubroBenchmarks';

function row(
  projectKey: string,
  tenantKey: string,
  metrics: Partial<Record<RubroMetricId, number | null>>,
): AnonymousProjectMetrics {
  return { projectKey, tenantKey, metrics };
}

/** n rows, each from its own tenant, with simple distinct values. */
function distinctRows(n: number): AnonymousProjectMetrics[] {
  return Array.from({ length: n }, (_, i) =>
    row(`p${i}`, `t${i}`, {
      incidentes12m: i,
      hallazgosAbiertosPct: i * 10,
      obligacionesAlDiaPct: 100 - i * 10,
    }),
  );
}

describe('computeRubroBenchmarks — k-anonymity gate', () => {
  it('exports the documented thresholds (k=5 projects, 3 tenants)', () => {
    expect(K_MIN_PROJECTS).toBe(5);
    expect(K_MIN_TENANTS).toBe(3);
  });

  it('empty input → ineligible, k=0, all metrics suppressed', () => {
    const report = computeRubroBenchmarks([]);
    expect(report.eligible).toBe(false);
    expect(report.k).toBe(0);
    expect(report.kTenants).toBe(0);
    for (const id of RUBRO_METRIC_IDS) {
      expect(report.perMetric[id]).toBeNull();
    }
  });

  it('4 projects (boundary below k) → ineligible and fully suppressed', () => {
    const report = computeRubroBenchmarks(distinctRows(4));
    expect(report.eligible).toBe(false);
    for (const id of RUBRO_METRIC_IDS) {
      expect(report.perMetric[id]).toBeNull();
    }
  });

  it('5 projects from 5 tenants (boundary at k) → eligible', () => {
    const report = computeRubroBenchmarks(distinctRows(5));
    expect(report.eligible).toBe(true);
    expect(report.k).toBe(5);
    expect(report.kTenants).toBe(5);
    expect(report.perMetric.incidentes12m).not.toBeNull();
  });

  it('6 projects but only 2 tenants → ineligible (tenant skew)', () => {
    // Single-tenant-per-uid means one company can own many projects of the
    // same rubro. With <3 tenants, the viewer (who knows their own values)
    // could attribute the rest of the distribution to ONE identifiable
    // company. Suppress entirely.
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`p${i}`, i < 3 ? 'tA' : 'tB', { incidentes12m: i }),
    );
    const report = computeRubroBenchmarks(rows);
    expect(report.eligible).toBe(false);
    expect(report.perMetric.incidentes12m).toBeNull();
  });

  it('6 projects from exactly 3 tenants (tenant boundary) → eligible', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`p${i}`, `t${i % 3}`, { incidentes12m: i }),
    );
    const report = computeRubroBenchmarks(rows);
    expect(report.eligible).toBe(true);
    expect(report.kTenants).toBe(3);
  });

  it('duplicate projectKey rows count once toward k', () => {
    const rows = [
      ...distinctRows(4),
      row('p0', 't0', { incidentes12m: 99 }), // duplicate of p0 — ignored
    ];
    const report = computeRubroBenchmarks(rows);
    expect(report.k).toBe(4);
    expect(report.eligible).toBe(false);
  });

  it('a metric whose own contributors are below k is suppressed even when the report is eligible', () => {
    // 6 projects/6 tenants contribute incidentes12m, but only 4 of them
    // have hallazgosAbiertosPct → that metric alone must stay null.
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`p${i}`, `t${i}`, {
        incidentes12m: i,
        hallazgosAbiertosPct: i < 4 ? i * 10 : null,
      }),
    );
    const report = computeRubroBenchmarks(rows);
    expect(report.eligible).toBe(true);
    expect(report.perMetric.incidentes12m).not.toBeNull();
    expect(report.perMetric.hallazgosAbiertosPct).toBeNull();
    expect(report.perMetric.obligacionesAlDiaPct).toBeNull(); // nobody reported it
  });

  it('a metric whose contributors span <3 tenants is suppressed', () => {
    // Report-level gate passes (5 projects / 3 tenants) but one metric is
    // only reported by the two projects of tenant tA + one of tB? No —
    // build: metric reported by 5 projects but only tenants tA/tA/tA/tA/tB.
    const rows = [
      row('p0', 'tA', { incidentes12m: 1, hallazgosAbiertosPct: 10 }),
      row('p1', 'tA', { incidentes12m: 2, hallazgosAbiertosPct: 20 }),
      row('p2', 'tA', { incidentes12m: 3, hallazgosAbiertosPct: 30 }),
      row('p3', 'tA', { incidentes12m: 4, hallazgosAbiertosPct: 40 }),
      row('p4', 'tB', { incidentes12m: 5, hallazgosAbiertosPct: 50 }),
      row('p5', 'tC', { incidentes12m: 6 }),
      row('p6', 'tC', { incidentes12m: 7 }),
    ];
    const report = computeRubroBenchmarks(rows);
    expect(report.eligible).toBe(true); // 7 projects, 3 tenants overall
    expect(report.perMetric.incidentes12m).not.toBeNull();
    // hallazgosAbiertosPct: 5 contributors but only tenants {tA, tB} → null.
    expect(report.perMetric.hallazgosAbiertosPct).toBeNull();
  });
});

describe('computeRubroBenchmarks — percentile math', () => {
  it('computes median/p25/p75 with linear interpolation (n=4)', () => {
    const rows = [1, 2, 3, 4].map((v, i) =>
      row(`p${i}`, `t${i}`, { incidentes12m: v }),
    );
    // Below k on purpose? No — need eligibility; add a 5th value.
    rows.push(row('p4', 't4', { incidentes12m: 5 }));
    const report = computeRubroBenchmarks(rows);
    const dist = report.perMetric.incidentes12m!;
    // sorted [1,2,3,4,5]: median=3, p25=2, p75=4 (exact indices)
    expect(dist.median).toBe(3);
    expect(dist.p25).toBe(2);
    expect(dist.p75).toBe(4);
    expect(dist.count).toBe(5);
  });

  it('interpolates between ranks (n=6)', () => {
    const rows = [0, 10, 20, 30, 40, 50].map((v, i) =>
      row(`p${i}`, `t${i}`, { hallazgosAbiertosPct: v }),
    );
    const dist = computeRubroBenchmarks(rows).perMetric.hallazgosAbiertosPct!;
    // sorted [0,10,20,30,40,50]: median=(20+30)/2=25; p25 at idx 1.25 → 12.5;
    // p75 at idx 3.75 → 37.5
    expect(dist.median).toBe(25);
    expect(dist.p25).toBe(12.5);
    expect(dist.p75).toBe(37.5);
  });

  it('ignores null / NaN / Infinity / negative values', () => {
    const rows = [
      row('p0', 't0', { incidentes12m: 1 }),
      row('p1', 't1', { incidentes12m: 2 }),
      row('p2', 't2', { incidentes12m: 3 }),
      row('p3', 't3', { incidentes12m: 4 }),
      row('p4', 't4', { incidentes12m: 5 }),
      row('p5', 't5', { incidentes12m: null }),
      row('p6', 't6', { incidentes12m: Number.NaN }),
      row('p7', 't7', { incidentes12m: Number.POSITIVE_INFINITY }),
      row('p8', 't8', { incidentes12m: -3 }),
    ];
    const dist = computeRubroBenchmarks(rows).perMetric.incidentes12m!;
    expect(dist.count).toBe(5);
    expect(dist.median).toBe(3);
  });

  it('is deterministic under input order shuffling', () => {
    const rows = distinctRows(7);
    const shuffled = [rows[3], rows[6], rows[0], rows[5], rows[1], rows[4], rows[2]];
    expect(computeRubroBenchmarks(shuffled)).toEqual(computeRubroBenchmarks(rows));
  });
});

describe('computeRubroBenchmarks — anonymity of the output', () => {
  it('never leaks projectKey / tenantKey values in the serialized report', () => {
    const rows = distinctRows(6).map((r, i) => ({
      ...r,
      projectKey: `SECRET-PROJECT-${i}`,
      tenantKey: `SECRET-TENANT-${i}`,
    }));
    const json = JSON.stringify(computeRubroBenchmarks(rows));
    expect(json).not.toContain('SECRET-PROJECT');
    expect(json).not.toContain('SECRET-TENANT');
    expect(json).not.toContain('projectKey');
    expect(json).not.toContain('tenantKey');
  });
});
