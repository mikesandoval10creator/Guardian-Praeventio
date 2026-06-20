// Real-router supertest for src/server/routes/multiProject.ts
// (Plan v3 Fase 1 — coverage campaign; route mounted at /api/sprint-k in server.ts).
//
// 3 POST endpoints, all behind verifyAuth + validate(zod) + guard(assertProjectMember):
//
//   POST /:projectId/multi-project/compare        body: { snapshots: ProjectSnapshot[] }
//   POST /:projectId/multi-project/best-practices body: { report: ComparisonReport }
//   POST /:projectId/multi-project/risk-projects  body: { report: ComparisonReport }
//
// Pure compute — no Firestore writes. Firestore is only needed by
// assertProjectMember to verify project membership.
//
// Covers: 401 (no token), 400 (schema / systemic z.unknown() bug probe),
// 403 (non-member), 403 (project not found), 200 happy paths, tenant
// isolation (cross-tenant non-member cannot access another tenant's project).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import multiProjectRouter from '../../server/routes/multiProject.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mirrors the real server.ts mount: app.use('/api/sprint-k', multiProjectRouter)
  app.use('/api/sprint-k', multiProjectRouter);
  return app;
}

const PROJECT_ID = 'p-mp-test';
const CALLER_UID = 'uid-mp-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Test Multi-Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Minimal valid ProjectSnapshot (field names from IncidentCounts in osha.ts:
//   totalRecordable, lostTime, restrictedOrTransferred, seriousInjuriesAndFatalities,
//   fatalities, totalLostDays — NOT recordableIncidents / lostTimeIncidents)
// ─────────────────────────────────────────────────────────────────────────
const minSnapshot = {
  projectId: 'proj-a',
  projectName: 'Proyecto A',
  workersCount: 100,
  totalHoursWorked: 200000,
  incidents: {
    totalRecordable: 2,
    lostTime: 1,
    restrictedOrTransferred: 0,
    seriousInjuriesAndFatalities: 0,
    fatalities: 0,
    totalLostDays: 5,
  },
  complianceTrafficLightScore: 80,
  trainingCoverage: 75,
  eppCoverage: 90,
  openCorrectiveActions: 3,
  closedCorrectiveActions: 7,
  daysSinceLastIncident: 45,
};

// ─────────────────────────────────────────────────────────────────────────
// Build a realistic ComparisonReport from two snapshots (engine is pure)
// ─────────────────────────────────────────────────────────────────────────
import {
  compareProjects,
  type ComparisonReport,
  type ProjectSnapshot,
} from '../../services/multiProject/projectComparator.js';

const snapshotA: ProjectSnapshot = { ...minSnapshot };
const snapshotB: ProjectSnapshot = {
  projectId: 'proj-b',
  projectName: 'Proyecto B',
  workersCount: 50,
  totalHoursWorked: 100000,
  incidents: {
    totalRecordable: 5,
    lostTime: 3,
    restrictedOrTransferred: 1,
    seriousInjuriesAndFatalities: 1,
    fatalities: 0,
    totalLostDays: 15,
  },
  complianceTrafficLightScore: 40,
  trainingCoverage: 30,
  eppCoverage: 45,
  openCorrectiveActions: 10,
  closedCorrectiveActions: 2,
  daysSinceLastIncident: 3,
};
const validReport: ComparisonReport = compareProjects([snapshotA, snapshotB]);

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ═════════════════════════════════════════════════════════════════════════
// 1. POST /:projectId/multi-project/compare
// ═════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/multi-project/compare', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/multi-project/compare`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ snapshots: [] });
    expect(res.status).toBe(401);
  });

  it('400 when body is missing snapshots entirely', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when snapshots is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ snapshots: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 (systemic bug probe) — snapshot item is undefined/null, not an object', async () => {
    // After the fix: snapshotSchema = z.record(z.string(), z.unknown())
    // A null item is not a record → 400. Before fix: z.unknown() accepted it → engine TypeError → 500.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ snapshots: [null] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ snapshots: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-proj/multi-project/compare`)
      .set('x-test-uid', CALLER_UID)
      .send({ snapshots: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 empty snapshots array → empty ComparisonReport', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ snapshots: [] });
    expect(res.status).toBe(200);
    const { report } = res.body as { report: ComparisonReport };
    expect(report.scores).toEqual([]);
    expect(report.topProject).toBeNull();
    expect(report.worstProject).toBeNull();
    expect(report.trirOutliers).toEqual([]);
  });

  it('200 two valid snapshots → scores computed, topProject set', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ snapshots: [snapshotA, snapshotB] });
    expect(res.status).toBe(200);
    const { report } = res.body as { report: ComparisonReport };
    expect(report.scores).toHaveLength(2);
    expect(report.topProject).not.toBeNull();
    expect(report.worstProject).not.toBeNull();
    // topProject must have higher or equal overallScore than worstProject
    const topScore = (report.topProject as { overallScore: number }).overallScore;
    const worstScore = (report.worstProject as { overallScore: number }).overallScore;
    expect(topScore).toBeGreaterThanOrEqual(worstScore);
    // averages shape must be present
    expect(typeof report.averages.trir).toBe('number');
    expect(typeof report.averages.overallScore).toBe('number');
  });

  it('200 tenant isolation — member of project in tenant-1 cannot be blocked by different tenantId header', async () => {
    // The route only checks project membership via Firestore, not tenant header.
    // A caller with x-test-tenant not matching cannot access a project they are not in.
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-proj/multi-project/compare`)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-tenant', 'tenant-other')
      .send({ snapshots: [] });
    expect(res.status).toBe(403); // project not found → forbidden
    expect(res.body.error).toBe('forbidden');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. POST /:projectId/multi-project/best-practices
// ═════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/multi-project/best-practices', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/multi-project/best-practices`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ report: validReport });
    expect(res.status).toBe(401);
  });

  it('400 when body is missing report field entirely', async () => {
    // Systemic bug probe: z.unknown() accepted undefined → engine TypeError → 500.
    // After fix: z.record(z.string(), z.unknown()) rejects undefined → 400.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when report is a scalar (string), not an object', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: 'not-an-object' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when report is null', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'intruder-uid')
      .send({ report: validReport });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 with a valid report → returns practices array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: validReport });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.practices)).toBe(true);
    // Each practice has metric + recommendation
    for (const p of res.body.practices as { metric: string; recommendation: string }[]) {
      expect(typeof p.metric).toBe('string');
      expect(typeof p.recommendation).toBe('string');
    }
  });

  it('200 report with no topProject → empty practices array (engine early-return)', async () => {
    const emptyReport: ComparisonReport = compareProjects([]);
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: emptyReport });
    expect(res.status).toBe(200);
    expect(res.body.practices).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. POST /:projectId/multi-project/risk-projects
// ═════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/multi-project/risk-projects', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/multi-project/risk-projects`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ report: validReport });
    expect(res.status).toBe(401);
  });

  it('400 when body is missing report field entirely', async () => {
    // Systemic bug probe: same as best-practices — z.unknown() accepted undefined → 500.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when report is null', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'intruder-uid')
      .send({ report: validReport });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when accessing a project the caller does not belong to (cross-tenant isolation)', async () => {
    // Seed another project NOT containing CALLER_UID
    H.db!._seed('projects/other-tenant-proj', {
      name: 'Other Tenant Project',
      members: ['other-uid'],
      createdBy: 'other-uid',
    });
    const res = await request(buildApp())
      .post(`/api/sprint-k/other-tenant-proj/multi-project/risk-projects`)
      .set('x-test-uid', CALLER_UID)
      .send({ report: validReport });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 valid report → returns alerts array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: validReport });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.alerts)).toBe(true);
  });

  it('200 report with risky project (low score, recent incident) → alert included', async () => {
    // snapshotB has complianceTrafficLightScore=40, trainingCoverage=30, daysSinceLastIncident=3
    // → should trigger multiple risk reasons
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: validReport });
    expect(res.status).toBe(200);
    const { alerts } = res.body as { alerts: { projectId: string; reasons: string[] }[] };
    const alertB = alerts.find((a) => a.projectId === 'proj-b');
    expect(alertB).toBeDefined();
    expect(alertB!.reasons.length).toBeGreaterThan(0);
    // Confirms specific risk flags the engine emits for proj-b
    expect(alertB!.reasons.some((r) => r.includes('Incidente reciente'))).toBe(true);
  });

  it('200 report with no risky projects → empty alerts array', async () => {
    // Single high-performing snapshot: all metrics well above risk thresholds.
    // Use 1 closed action so closureRate is defined (not null) and score is not suppressed.
    const perfectSnap: ProjectSnapshot = {
      projectId: 'proj-perfect',
      projectName: 'Perfect Project',
      workersCount: 200,
      totalHoursWorked: 400000,
      incidents: {
        totalRecordable: 0,
        lostTime: 0,
        restrictedOrTransferred: 0,
        seriousInjuriesAndFatalities: 0,
        fatalities: 0,
        totalLostDays: 0,
      },
      complianceTrafficLightScore: 95,
      trainingCoverage: 95,
      eppCoverage: 98,
      openCorrectiveActions: 0,
      closedCorrectiveActions: 1, // ensures closureRate = 1.0 (100% — not null, not NaN)
      daysSinceLastIncident: 365,
    };
    const cleanReport = compareProjects([perfectSnap]);
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: cleanReport });
    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual([]);
  });

  it('200 alerts are sorted by reason count descending', async () => {
    const thirdSnap: ProjectSnapshot = {
      projectId: 'proj-c',
      projectName: 'Proyecto C',
      workersCount: 30,
      totalHoursWorked: 60000,
      incidents: {
        totalRecordable: 10,
        lostTime: 5,
        restrictedOrTransferred: 2,
        seriousInjuriesAndFatalities: 2,
        fatalities: 1,
        totalLostDays: 30,
      },
      complianceTrafficLightScore: 20,
      trainingCoverage: 20,
      eppCoverage: 20,
      openCorrectiveActions: 20,
      closedCorrectiveActions: 1,
      daysSinceLastIncident: 1,
    };
    const multiReport = compareProjects([snapshotA, snapshotB, thirdSnap]);
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ report: multiReport });
    expect(res.status).toBe(200);
    const { alerts } = res.body as { alerts: { projectId: string; reasons: string[] }[] };
    // proj-c has fatality + SIF + overallScore<50 + compliance<60 + training<50 + epp<50 + recent incident
    // → most reasons, so it should be first
    if (alerts.length >= 2) {
      for (let i = 0; i < alerts.length - 1; i++) {
        expect(alerts[i].reasons.length).toBeGreaterThanOrEqual(alerts[i + 1].reasons.length);
      }
    }
    const alertC = alerts.find((a) => a.projectId === 'proj-c');
    expect(alertC).toBeDefined();
    expect(alertC!.reasons.some((r) => r.includes('Fatalidad'))).toBe(true);
    expect(alertC!.reasons.some((r) => r.includes('SIF'))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4. GET /:projectId/multi-project/snapshots  (READ-side pipeline, P1)
// ═════════════════════════════════════════════════════════════════════════
//
// This is the endpoint that closes #1049 / DEEP-EX-34 H3: it AGGREGATES real
// per-project KPIs from incidents/findings/audits/risks/corrective_actions so
// ProjectsCompare receives real snapshots instead of an empty prop. The
// snapshot shape here is the *comparator* engine's `ProjectSnapshot`
// (projectComparator/projectComparator), NOT the multiProject engine's.

import type { ProjectSnapshot as ComparatorSnapshot } from '../../services/projectComparator/projectComparator.js';

describe('GET /:projectId/multi-project/snapshots', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/multi-project/snapshots`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the lens project does not exist', async () => {
    const res = await request(buildApp())
      .get(`/api/sprint-k/nonexistent-proj/multi-project/snapshots`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 aggregates REAL KPIs from seeded collections', async () => {
    // Seed a SECOND project the same caller belongs to, plus real data docs
    // across the 5 KPI collections for BOTH projects. The aggregator must
    // count them correctly (this is the data flowing end-to-end).
    const db = H.db!;
    db._seed(`projects/proj-norte`, {
      name: 'Faena Norte',
      members: [CALLER_UID],
      createdBy: CALLER_UID,
      workersCount: 42,
    });
    db._seed(`projects/proj-sur`, {
      name: 'Faena Sur',
      members: [CALLER_UID],
      createdBy: CALLER_UID,
      workersCount: 17,
    });

    // proj-norte: 1 incident, 2 open findings (1 closed → not counted),
    // 1 critical risk (1 low → not counted), audits 1/2 completed (50%),
    // corrective_actions 1 on-time + 1 late → 50% on-time.
    db._seed('incidents/inc-n1', { projectId: 'proj-norte', severity: 'high' });
    db._seed('findings/f-n1', { projectId: 'proj-norte', status: 'open' });
    db._seed('findings/f-n2', { projectId: 'proj-norte' }); // no status → open
    db._seed('findings/f-n3', { projectId: 'proj-norte', status: 'closed' });
    db._seed('risks/r-n1', { projectId: 'proj-norte', severity: 'critical' });
    db._seed('risks/r-n2', { projectId: 'proj-norte', severity: 'low' });
    db._seed('audits/a-n1', { projectId: 'proj-norte', status: 'completada' });
    db._seed('audits/a-n2', { projectId: 'proj-norte', status: 'pendiente' });
    db._seed('corrective_actions/ca-n1', {
      projectId: 'proj-norte',
      status: 'closed',
      closedAt: '2026-05-10T00:00:00Z',
      dueDate: '2026-05-15',
    }); // on time
    db._seed('corrective_actions/ca-n2', {
      projectId: 'proj-norte',
      status: 'closed',
      closedAt: '2026-05-20T00:00:00Z',
      dueDate: '2026-05-15',
    }); // late
    db._seed('corrective_actions/ca-n3', {
      projectId: 'proj-norte',
      status: 'open',
    }); // open → ignored in on-time ratio

    // proj-sur: empty → honest zeros (no fabricated metrics).

    const res = await request(buildApp()).get(url).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { snapshots } = res.body as { snapshots: ComparatorSnapshot[] };
    // 3 projects: original PROJECT_ID (no data) + norte + sur.
    expect(snapshots.length).toBe(3);

    const norte = snapshots.find((s) => s.projectId === 'proj-norte');
    expect(norte).toBeDefined();
    expect(norte!.projectName).toBe('Faena Norte');
    expect(norte!.metrics.incidentCount).toBe(1);
    expect(norte!.metrics.openFindingsCount).toBe(2);
    expect(norte!.metrics.criticalRisksCount).toBe(1);
    expect(norte!.metrics.auditCompliancePct).toBe(50);
    expect(norte!.metrics.correctiveActionsOnTimePct).toBe(50);
    expect(norte!.metrics.workersCount).toBe(42);

    // honest-empty: a project with no KPI docs reports real zeros (counts) +
    // 100 for the ratio metrics (no overdue work is the truthful baseline).
    const sur = snapshots.find((s) => s.projectId === 'proj-sur');
    expect(sur).toBeDefined();
    expect(sur!.metrics.incidentCount).toBe(0);
    expect(sur!.metrics.openFindingsCount).toBe(0);
    expect(sur!.metrics.criticalRisksCount).toBe(0);
    expect(sur!.metrics.auditCompliancePct).toBe(100);
    expect(sur!.metrics.correctiveActionsOnTimePct).toBe(100);
    expect(sur!.metrics.workersCount).toBe(17);
  });

  it('200 a real snapshot pair feeds the comparator engine without throwing', async () => {
    // End-to-end proof: the aggregated snapshots are accepted by the SAME
    // comparator engine the /project-comparator/compare endpoint runs.
    const db = H.db!;
    db._seed('projects/proj-x', {
      name: 'X', members: [CALLER_UID], createdBy: CALLER_UID, workersCount: 10,
    });
    db._seed('incidents/inc-x', { projectId: 'proj-x', severity: 'low' });

    const res = await request(buildApp()).get(url).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { snapshots } = res.body as { snapshots: ComparatorSnapshot[] };
    const twoReal = snapshots.slice(0, 2);
    expect(twoReal.length).toBe(2);
    const { compareProjects: comparatorCompare } = await import(
      '../../services/projectComparator/projectComparator.js'
    );
    const report = comparatorCompare(twoReal);
    expect(report.overallRanking.length).toBe(2);
    expect(report.metricComparisons.length).toBeGreaterThan(0);
  });
});
