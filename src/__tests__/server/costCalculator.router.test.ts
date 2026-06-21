// Real-router supertest for the Prevention Cost Calculator HTTP surface
// (src/server/routes/costCalculator.ts). Two stateless POST endpoints over the
// pure engine in src/services/costCalculator/preventionCostCalculator.ts:
//
//   POST /:projectId/cost-calculator/non-compliance → { estimate }
//   POST /:projectId/cost-calculator/prevention-roi  → { estimate }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked, so every 200 asserts the real CLP estimate
// re-derived from the engine formula (Ley 16.744 fine ranges × history × worker
// factor + stoppage + admin), never copied from the handler.

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
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import costCalculatorRouter from '../../server/routes/costCalculator.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', costCalculatorRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/cost-calculator/non-compliance', () => {
  const url = '/api/p1/cost-calculator/non-compliance';
  // safety_breach range = { min: 1_000_000, max: 30_000_000 }.
  const body = {
    kind: 'safety_breach' as const,
    affectedWorkerCount: 10,
    estimatedStoppageDays: 6,
    dailyStoppageCostClp: 500_000,
    adminHoursToFix: 4,
    adminHourlyCostClp: 20_000,
    hasHistoryOfFines: true,
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 returns the real CLP estimate re-derived from the engine formula', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    const est = res.body.estimate;
    // multiplier = 1.8 (hasHistory); workerFactor = 1 + min(10/50, 1) = 1.2.
    // fineMin = round(1_000_000 * 1.8 * 1.2) = 2_160_000.
    // fineMax = round(30_000_000 * 1.8 * 1.2) = 64_800_000.
    expect(est.historyMultiplier).toBe(1.8);
    expect(est.estimatedFineClpMin).toBe(2_160_000);
    expect(est.estimatedFineClpMax).toBe(64_800_000);
    // stoppage = 6 days * 500_000 = 3_000_000; admin = 4h * 20_000 = 80_000.
    expect(est.stoppageCostClp).toBe(3_000_000);
    expect(est.adminCostClp).toBe(80_000);
    expect(est.totalEstimatedClpMin).toBe(2_160_000 + 3_000_000 + 80_000);
    expect(est.totalEstimatedClpMax).toBe(64_800_000 + 3_000_000 + 80_000);
    // No charge can be negative — these are estimated costs, never refunds.
    expect(est.totalEstimatedClpMin).toBeGreaterThan(0);
    expect(est.totalEstimatedClpMax).toBeGreaterThanOrEqual(est.totalEstimatedClpMin);
    // notes: history multiplier note + stoppage >= 5 days note.
    expect(est.notes).toContain('Historial fiscalización previa: multa estimada × 1.8');
    expect(est.notes).toContain(
      'Paralización >5 días puede gatillar contrato suspendido con mandante',
    );
  });

  it('200 uses the 15_000 CLP/h admin default when adminHourlyCostClp is omitted', async () => {
    const { adminHourlyCostClp: _omit, ...noHourly } = body;
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...noHourly, hasHistoryOfFines: false, adminHoursToFix: 3 });
    expect(res.status).toBe(200);
    // adminCost = 3h * 15_000 default = 45_000; no history → multiplier 1.0.
    expect(res.body.estimate.adminCostClp).toBe(45_000);
    expect(res.body.estimate.historyMultiplier).toBe(1.0);
    // workerFactor still 1.2 → fineMin = round(1_000_000 * 1.0 * 1.2) = 1_200_000.
    expect(res.body.estimate.estimatedFineClpMin).toBe(1_200_000);
  });

  it('200 caps the worker factor at 2× beyond 50 affected workers', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, affectedWorkerCount: 5000, hasHistoryOfFines: false });
    expect(res.status).toBe(200);
    // workerFactor capped at 2 → fineMin = round(1_000_000 * 1.0 * 2) = 2_000_000.
    expect(res.body.estimate.estimatedFineClpMin).toBe(2_000_000);
    expect(res.body.estimate.estimatedFineClpMax).toBe(60_000_000);
  });

  it('200 fatal_accident_risk adds the civil-suit + cotización notes', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, kind: 'fatal_accident_risk', estimatedStoppageDays: 1 });
    expect(res.status).toBe(200);
    expect(res.body.estimate.notes).toContain(
      'Considerar también demanda civil y daño reputacional',
    );
    expect(res.body.estimate.notes).toContain(
      'SUSESO puede aplicar recargo de cotización Ley 16.744',
    );
    // Only 1 stoppage day → the >5-day note must NOT be present.
    expect(res.body.estimate.notes).not.toContain(
      'Paralización >5 días puede gatillar contrato suspendido con mandante',
    );
  });

  it('400 on an unknown incompletion kind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, kind: 'not_a_real_kind' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a negative affectedWorkerCount', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, affectedWorkerCount: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a required field is missing', async () => {
    const { hasHistoryOfFines: _drop, ...incomplete } = body;
    const res = await request(buildApp()).post(url).set(uid).send(incomplete);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/cost-calculator/non-compliance')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/cost-calculator/non-compliance')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/cost-calculator/prevention-roi', () => {
  const url = '/api/p1/cost-calculator/prevention-roi';
  const body = {
    expirationsCaughtEarly: 7,
    adminHoursSaved: 10,
    documentsGeneratedInternally: 5,
    potentialStoppagesAvoided: 2,
    nearMissesNotEscalated: 3,
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 returns the real ROI breakdown with defaults applied', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    const est = res.body.estimate;
    // Defaults: admin 15_000/h, doc 80_000, stoppage 800_000, incident 1_500_000.
    expect(est.adminHoursSavingsClp).toBe(10 * 15_000); // 150_000
    expect(est.documentInsourceSavingsClp).toBe(5 * 80_000); // 400_000
    expect(est.stoppageAvoidanceSavingsClp).toBe(2 * 800_000); // 1_600_000
    expect(est.incidentAvoidanceSavingsClp).toBe(3 * 1_500_000); // 4_500_000
    const total = 150_000 + 400_000 + 1_600_000 + 4_500_000; // 6_650_000
    expect(est.totalSavingsClp).toBe(total);
    // Savings are never negative.
    expect(est.totalSavingsClp).toBeGreaterThan(0);
    // topContributors sorted desc; incidents lead at round(4.5M/6.65M*100)=68%.
    expect(est.topContributors).toHaveLength(4);
    expect(est.topContributors[0]).toEqual({
      source: 'Incidentes evitados (near-miss)',
      amountClp: 4_500_000,
      percent: Math.round((4_500_000 / total) * 100),
    });
    expect(est.topContributors[1].source).toBe('Detenciones evitadas');
  });

  it('200 honors explicit cost overrides instead of defaults', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, adminHourlyCostClp: 20_000, externalDocCostClp: 100_000 });
    expect(res.status).toBe(200);
    expect(res.body.estimate.adminHoursSavingsClp).toBe(10 * 20_000); // 200_000
    expect(res.body.estimate.documentInsourceSavingsClp).toBe(5 * 100_000); // 500_000
  });

  it('200 returns an empty contributor list and zero total when nothing was saved', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        expirationsCaughtEarly: 0,
        adminHoursSaved: 0,
        documentsGeneratedInternally: 0,
        potentialStoppagesAvoided: 0,
        nearMissesNotEscalated: 0,
      });
    expect(res.status).toBe(200);
    // Division-by-zero guard: percent must not be NaN when total is 0.
    expect(res.body.estimate.totalSavingsClp).toBe(0);
    expect(res.body.estimate.topContributors).toEqual([]);
  });

  it('400 on a non-positive cost override (zero rejected by .positive())', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, adminHourlyCostClp: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a non-integer adminHoursSaved field being a string', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, adminHoursSaved: 'lots' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/cost-calculator/prevention-roi')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/cost-calculator/prevention-roi')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
