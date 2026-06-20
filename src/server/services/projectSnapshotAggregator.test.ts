// Unit test for the pure project-snapshot aggregator (READ-side pipeline P1).
//
// Pins the field-level classification (open finding / critical risk / completed
// audit / corrective-action on-time) and the honest-empty defaults, so the
// comparator receives REAL counts and is never fed fabricated values.

import { describe, it, expect } from 'vitest';
import {
  buildProjectSnapshot,
  type ProjectCollections,
} from './projectSnapshotAggregator';

const SNAP_AT = '2026-06-20T00:00:00Z';

function emptyCollections(): ProjectCollections {
  return { incidents: [], findings: [], audits: [], risks: [], correctiveActions: [] };
}

describe('buildProjectSnapshot', () => {
  it('honest-empty: no data → real zeros + 100% ratio baselines', () => {
    const snap = buildProjectSnapshot(
      { projectId: 'p1', projectName: 'Vacío', workersCount: 5 },
      emptyCollections(),
      SNAP_AT,
    );
    expect(snap.metrics.incidentCount).toBe(0);
    expect(snap.metrics.openFindingsCount).toBe(0);
    expect(snap.metrics.criticalRisksCount).toBe(0);
    expect(snap.metrics.auditCompliancePct).toBe(100);
    expect(snap.metrics.correctiveActionsOnTimePct).toBe(100);
    expect(snap.metrics.workersCount).toBe(5);
    expect(snap.snapshotAt).toBe(SNAP_AT);
  });

  it('counts incidents and open findings (closed/resolved excluded)', () => {
    const c = emptyCollections();
    c.incidents = [{}, {}, {}];
    c.findings = [
      { status: 'open' },
      {}, // missing status → counts as open
      { status: 'closed' },
      { status: 'resuelto' },
    ];
    const snap = buildProjectSnapshot(
      { projectId: 'p1', projectName: 'P', workersCount: 1 },
      c,
      SNAP_AT,
    );
    expect(snap.metrics.incidentCount).toBe(3);
    expect(snap.metrics.openFindingsCount).toBe(2);
  });

  it('classifies critical risks across severity/criticidad/severidad shapes', () => {
    const c = emptyCollections();
    c.risks = [
      { severity: 'critical' },
      { metadata: { criticidad: 'Alta' } },
      { metadata: { severidad: 4 } },
      { severity: 'low' }, // not critical
      { metadata: { severidad: 2 } }, // not critical
    ];
    const snap = buildProjectSnapshot(
      { projectId: 'p1', projectName: 'P', workersCount: 1 },
      c,
      SNAP_AT,
    );
    expect(snap.metrics.criticalRisksCount).toBe(3);
  });

  it('audit compliance = completed / total (status tokens es/en)', () => {
    const c = emptyCollections();
    c.audits = [
      { status: 'completada' },
      { status: 'completed' },
      { status: 'ejecutada' },
      { status: 'pendiente' },
    ];
    const snap = buildProjectSnapshot(
      { projectId: 'p1', projectName: 'P', workersCount: 1 },
      c,
      SNAP_AT,
    );
    expect(snap.metrics.auditCompliancePct).toBe(75); // 3 of 4
  });

  it('corrective-action on-time ratio excludes open actions, judges closed by dates', () => {
    const c = emptyCollections();
    c.correctiveActions = [
      { status: 'closed', closedAt: '2026-05-10T00:00:00Z', dueDate: '2026-05-15' }, // on time
      { status: 'closed', closedAt: '2026-05-20T00:00:00Z', dueDate: '2026-05-15' }, // late
      { status: 'completada', closedAt: '2026-05-01T00:00:00Z', dueDate: '2026-05-01' }, // on time (==)
      { status: 'open', dueDate: '2026-05-01' }, // ignored (not closed)
    ];
    const snap = buildProjectSnapshot(
      { projectId: 'p1', projectName: 'P', workersCount: 1 },
      c,
      SNAP_AT,
    );
    // 2 on-time of 3 closed = 67%
    expect(snap.metrics.correctiveActionsOnTimePct).toBe(67);
  });

  it('closed action with no comparable dates counts as on-time (honest default)', () => {
    const c = emptyCollections();
    c.correctiveActions = [{ status: 'cerrada' }]; // closed, no dates
    const snap = buildProjectSnapshot(
      { projectId: 'p1', projectName: 'P', workersCount: 1 },
      c,
      SNAP_AT,
    );
    expect(snap.metrics.correctiveActionsOnTimePct).toBe(100);
  });
});
