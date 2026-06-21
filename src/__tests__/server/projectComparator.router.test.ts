// Real-router supertest for the project-comparator endpoint (1 route, pure
// compute). Mounts the REAL router via fakeFirestore and exercises:
//   POST /:projectId/project-comparator/compare
// Only infra is mocked (firebase-admin, verifyAuth, logger, captureRouteError).
// The Zod schema (validate), the membership guard (assertProjectMember), and
// the comparator engine (compareProjects) all run UNMOCKED so the 200 path
// asserts the REAL engine output and the 403 path exercises the REAL guard
// reading project membership from Firestore.
//
// Why this matters: routing/management endpoints that take a projectId MUST
// gate on assertProjectMember (CLAUDE.md #6) — the Admin SDK bypasses
// firestore.rules, so an un-gated read/compute over another tenant's KPIs
// would be an IDOR. This test pins that the guard runs BEFORE compute and
// that a non-member never reaches the engine. (Sibling projectComparator
// engine tests cover the pure math; the wire-up contract test only inspects
// router.stack — neither exercises the real HTTP surface end-to-end.)

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
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import comparatorRouter from '../../server/routes/projectComparator.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { captureRouteError } from '../../server/middleware/captureRouteError.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', comparatorRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };
const ep = '/api/sprint-k/p1/project-comparator/compare';

// A valid snapshot factory — caller pre-aggregates these KPIs.
function snap(
  projectId: string,
  projectName: string,
  metrics: Partial<{
    incidentCount: number;
    openFindingsCount: number;
    auditCompliancePct: number;
    criticalRisksCount: number;
    workersCount: number;
    correctiveActionsOnTimePct: number;
  }> = {},
) {
  return {
    projectId,
    projectName,
    snapshotAt: '2026-06-01T00:00:00.000Z',
    metrics: {
      incidentCount: 5,
      openFindingsCount: 3,
      auditCompliancePct: 80,
      criticalRisksCount: 1,
      workersCount: 100,
      correctiveActionsOnTimePct: 90,
      ...metrics,
    },
  };
}

beforeEach(() => {
  vi.mocked(captureRouteError).mockReset();
  H.db = createFakeFirestore();
  // u1 is a member of p1 (member of members[]). Real assertProjectMember reads this.
  H.db._seed('projects/p1', { tenantId: 't1', members: ['u1'] });
});

describe('POST /:projectId/project-comparator/compare', () => {
  it('401 without a token (verifyAuth)', async () => {
    const res = await request(buildApp())
      .post(ep)
      .send({ snapshots: [snap('a', 'Alfa'), snap('b', 'Beta')] });
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a member of the project (real guard, no IDOR)', async () => {
    // u2 is NOT in members[] and not createdBy — real assertProjectMember throws.
    const res = await request(buildApp())
      .post(ep)
      .set({ 'x-test-uid': 'u2' })
      .send({ snapshots: [snap('a', 'Alfa'), snap('b', 'Beta')] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist (guard denies before compute)', async () => {
    H.db!._store.delete('projects/p1');
    const res = await request(buildApp())
      .post(ep)
      .set(uid)
      .send({ snapshots: [snap('a', 'Alfa'), snap('b', 'Beta')] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 invalid_payload when snapshots is missing (real Zod schema)', async () => {
    const res = await request(buildApp()).post(ep).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('400 when fewer than MIN_PROJECTS_TO_COMPARE snapshots (schema .min)', async () => {
    const res = await request(buildApp())
      .post(ep)
      .set(uid)
      .send({ snapshots: [snap('a', 'Alfa')] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when more than MAX_PROJECTS_TO_COMPARE snapshots (schema .max)', async () => {
    const res = await request(buildApp())
      .post(ep)
      .set(uid)
      .send({
        snapshots: [
          snap('a', 'Alfa'),
          snap('b', 'Beta'),
          snap('c', 'Gamma'),
          snap('d', 'Delta'),
          snap('e', 'Epsilon'),
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a percentage metric is out of [0,100] (schema range)', async () => {
    const res = await request(buildApp())
      .post(ep)
      .set(uid)
      .send({
        snapshots: [snap('a', 'Alfa', { auditCompliancePct: 150 }), snap('b', 'Beta')],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a count metric is negative (schema nonnegative)', async () => {
    const res = await request(buildApp())
      .post(ep)
      .set(uid)
      .send({
        snapshots: [snap('a', 'Alfa', { incidentCount: -1 }), snap('b', 'Beta')],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when duplicate projectIds reach the engine (real compareProjects throws)', async () => {
    // Schema passes (both shapes valid) but the engine rejects duplicates.
    const res = await request(buildApp())
      .post(ep)
      .set(uid)
      .send({ snapshots: [snap('dup', 'Alfa'), snap('dup', 'Beta')] });
    expect(res.status).toBe(400);
    // Engine error message is `[DUPLICATE_PROJECT] ...` — surfaced as the 400 body.
    expect(res.body.error).toContain('DUPLICATE_PROJECT');
    // 400 (client/engine) must NOT be captured as a server error.
    expect(captureRouteError).not.toHaveBeenCalled();
  });

  it('200 returns the REAL engine report; ranks the safer project first', async () => {
    // Project "safe": fewer incidents/findings/risks, higher compliance.
    // Project "risky": worse on every ranked KPI. The engine must score
    // "safe" higher and name it the winner of each KPI.
    const res = await request(buildApp())
      .post(ep)
      .set(uid)
      .send({
        snapshots: [
          snap('risky', 'Faena Riesgosa', {
            incidentCount: 20,
            openFindingsCount: 15,
            auditCompliancePct: 50,
            criticalRisksCount: 8,
            correctiveActionsOnTimePct: 40,
          }),
          snap('safe', 'Faena Segura', {
            incidentCount: 1,
            openFindingsCount: 0,
            auditCompliancePct: 99,
            criticalRisksCount: 0,
            correctiveActionsOnTimePct: 98,
          }),
        ],
      });
    expect(res.status).toBe(200);
    const report = res.body.report;
    expect(report).toBeDefined();

    // Snapshots preserved in stable order.
    expect(report.projects.map((p: { projectId: string }) => p.projectId)).toEqual([
      'risky',
      'safe',
    ]);

    // Overall ranking sorted desc by score → safe first.
    expect(report.overallRanking[0].projectId).toBe('safe');
    expect(report.overallRanking[1].projectId).toBe('risky');
    expect(report.overallRanking[0].overallScore).toBeGreaterThan(
      report.overallRanking[1].overallScore,
    );

    // "safe" wins every ranked KPI → 100 score on each, kpiWins = 5.
    expect(report.overallRanking[0].overallScore).toBe(100);
    expect(report.overallRanking[0].kpiWins).toBe(report.metricComparisons.length);

    // Every metric comparison names "safe" as the winner.
    for (const mc of report.metricComparisons) {
      expect(mc.winnerProjectId).toBe('safe');
    }

    // The directive-2 "no decision" observation appears because the gap >= 20.
    expect(Array.isArray(report.observations)).toBe(true);
    expect(report.observations.join(' ')).toContain('Faena Segura');
  });

  it('200 reports a null winner + tie when both projects are identical', async () => {
    const res = await request(buildApp())
      .post(ep)
      .set(uid)
      .send({ snapshots: [snap('a', 'Alfa'), snap('b', 'Beta')] });
    expect(res.status).toBe(200);
    const report = res.body.report;
    // All metrics equal → no winner, normalized 100 for everyone.
    for (const mc of report.metricComparisons) {
      expect(mc.winnerProjectId).toBeNull();
      expect(mc.normalizedScores).toEqual([100, 100]);
    }
    expect(report.overallRanking[0].overallScore).toBe(100);
    expect(report.overallRanking[1].overallScore).toBe(100);
  });
});
