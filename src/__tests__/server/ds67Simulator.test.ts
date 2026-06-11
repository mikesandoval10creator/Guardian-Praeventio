// Real-router supertest for the DS 67 cotización-adicional simulator
// (épica B1, capa 2). Covers: 401/403/400 surface, the manual happy path
// (engine wired end-to-end with the worked recargo example), and the
// merge path where omitted `lostDays` are pre-filled from REAL registered
// incidents (top-level + nested, de-duplicated), with per-period
// provenance (`lostDaysSource`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { evaluationPeriodWindows } from '../../services/compliance/ds67Simulator';

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
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import ds67SimulatorRouter from '../../server/routes/ds67.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/compliance', ds67SimulatorRouter);
  return app;
}

const SIMULATE = '/api/compliance/p1/ds67/simulator/simulate';
const PREFILL = '/api/compliance/p1/ds67/simulator/prefill';

// The route aggregates incidents into the DS 67 períodos anuales relative
// to "now" — compute the same windows here so seeds land deterministically.
const windows = evaluationPeriodWindows(new Date(), 3);
const insideWindow = (i: number, daysIn = 30) =>
  new Date(Date.parse(windows[i].startIso) + daysIn * 86_400_000).toISOString();

const manualBody = {
  periods: [
    { averageWorkers: 100, lostDays: 350 },
    { averageWorkers: 100, lostDays: 425 },
    { averageWorkers: 100, lostDays: 500, invalidityEvents: { muerte: 1 } },
  ],
  currentAdditionalCotizacionPct: 0.68,
  annualPayrollClp: 1_200_000_000,
};

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', name: 'Faena' });
});

describe('POST /api/compliance/:projectId/ds67/simulator/simulate', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(SIMULATE).send(manualBody);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await request(buildApp()).post(SIMULATE).set('x-test-uid', 'u1').send(manualBody);
    expect(res.status).toBe(403);
  });

  it('400 on invalid payload (empty periods)', async () => {
    const res = await request(buildApp())
      .post(SIMULATE)
      .set('x-test-uid', 'u1')
      .send({ periods: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on negative lostDays', async () => {
    const res = await request(buildApp())
      .post(SIMULATE)
      .set('x-test-uid', 'u1')
      .send({
        periods: [
          { averageWorkers: 10, lostDays: -1 },
          { averageWorkers: 10, lostDays: 0 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('200 manual happy path — engine wired end-to-end (recargo example)', async () => {
    const res = await request(buildApp()).post(SIMULATE).set('x-test-uid', 'u1').send(manualBody);
    expect(res.status).toBe(200);
    expect(res.body.result.averageTemporaryRate).toBe(425);
    expect(res.body.result.invalidityDeathRate).toBe(140);
    expect(res.body.result.totalRate).toBe(565);
    expect(res.body.result.additionalCotizacionPct).toBe(4.76);
    expect(res.body.result.deltaPct).toBe(4.08);
    expect(res.body.result.annualCostClp).toBe(57_120_000);
    expect(res.body.result.annualCostDeltaClp).toBe(48_960_000);
    expect(res.body.result.legalCitation).toContain('DS 67');
    // All three periods were user-provided.
    expect(res.body.periods.map((p: { lostDaysSource: string }) => p.lostDaysSource)).toEqual([
      'manual',
      'manual',
      'manual',
    ]);
  });

  it('200 merge path — omitted lostDays pre-filled from registered incidents', async () => {
    // Newest período anual: 2 incidents with lost days + 1 nested duplicate.
    H.db!._seed('incidents/i1', { projectId: 'p1', occurredAt: insideWindow(2, 10), lostDays: 12 });
    H.db!._seed('incidents/i2', { projectId: 'p1', occurredAt: insideWindow(2, 40), lostDays: 8 });
    H.db!._seed('tenants/t1/projects/p1/incidents/i2', {
      projectId: 'p1',
      occurredAt: insideWindow(2, 40),
      lostDays: 8,
    });
    // Incident without lostDays still counts, contributes 0 days.
    H.db!._seed('incidents/i3', { projectId: 'p1', occurredAt: insideWindow(2, 60) });
    // Incident OUTSIDE every window is ignored.
    H.db!._seed('incidents/old', {
      projectId: 'p1',
      occurredAt: '2010-01-05T00:00:00.000Z',
      lostDays: 99,
    });

    const res = await request(buildApp())
      .post(SIMULATE)
      .set('x-test-uid', 'u1')
      .send({
        periods: [
          { averageWorkers: 100, lostDays: 0 },
          { averageWorkers: 100, lostDays: 0 },
          { averageWorkers: 100 }, // lostDays omitted → fill from incidents (20).
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.periods[2].lostDaysSource).toBe('incidents');
    expect(res.body.periods[2].lostDays).toBe(20);
    expect(res.body.periods[2].registeredIncidentCount).toBe(3);
    expect(res.body.periods[0].lostDaysSource).toBe('manual');
    // Tasas: (0 + 0 + 20)/3 = 6,67 → 7 → tramo 0–32 → 0%.
    expect(res.body.result.averageTemporaryRate).toBe(7);
    expect(res.body.result.additionalCotizacionPct).toBe(0);
  });
});

describe('GET /api/compliance/:projectId/ds67/simulator/prefill', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get(PREFILL);
    expect(res.status).toBe(401);
  });

  it('200 returns the 3 períodos anuales with real incident aggregates', async () => {
    H.db!._seed('incidents/a', { projectId: 'p1', occurredAt: insideWindow(1, 5), lostDays: 4 });
    H.db!._seed('incidents/b', { projectId: 'p1', occurredAt: insideWindow(2, 5), lostDays: 6 });
    H.db!._seed('tenants/t1/projects/p1/incidents/c', {
      projectId: 'p1',
      occurredAt: insideWindow(2, 90),
      lostDays: 5,
    });

    const res = await request(buildApp()).get(PREFILL).set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.periods).toHaveLength(3);
    expect(res.body.periods[0].registeredLostDays).toBe(0);
    expect(res.body.periods[0].registeredIncidentCount).toBe(0);
    expect(res.body.periods[1].registeredLostDays).toBe(4);
    expect(res.body.periods[2].registeredLostDays).toBe(11);
    expect(res.body.periods[2].registeredIncidentCount).toBe(2);
    expect(res.body.periods[2].label).toMatch(/^01-07-\d{4} al 30-06-\d{4}$/);
    expect(res.body.periods[2].startIso).toBe(windows[2].startIso);
  });
});
