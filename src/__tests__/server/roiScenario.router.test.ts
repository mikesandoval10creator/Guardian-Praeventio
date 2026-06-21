// Real-router supertest for the ROI Scenario Comparator HTTP surface
// (src/server/routes/roiScenario.ts). One stateless POST endpoint over the
// pure engine in src/services/roiScenario/roiScenarioSimulator.ts:
//
//   POST /:projectId/roi-scenario/compare
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked so the response shapes are real compute.

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

import roiScenarioRouter from '../../server/routes/roiScenario.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', roiScenarioRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A valid baseline for the baselineStateSchema.
function baseline(overrides: Record<string, unknown> = {}) {
  return {
    averageDirectCostPerIncidentClp: 1_000_000,
    baselineRatePerYear: 10,
    workersCount: 100,
    indirectMultiplier: 4,
    ...overrides,
  };
}

// A valid scenario for the investmentScenarioSchema.
function scenario(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-a',
    name: 'Programa de capacitación',
    description: 'Inversión en capacitación preventiva',
    investments: [{ category: 'training', amountClp: 5_000_000 }],
    assumptions: {
      expectedIncidentReductionPct: 50,
      expectedComplianceImprovementPct: 30,
      paybackMonthsEstimate: 12,
      confidenceLevel: 'high',
    },
    ...overrides,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/roi-scenario/compare', () => {
  const url = '/api/p1/roi-scenario/compare';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ scenarios: [scenario()], baseline: baseline() });
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine comparison shape and math', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ scenarios: [scenario()], baseline: baseline() });
    expect(res.status).toBe(200);

    const comparison = res.body.comparison;
    // Real engine math (deterministic): 10 incidents/yr * 50% = 5 avoided.
    // direct = 5 * 1_000_000 = 5_000_000; indirect = direct * 4 = 20_000_000;
    // savings = 25_000_000. ROI = (25M - 5M) / 5M * 100 = 400%.
    // payback = 5M / 25M * 12 = 2.4 months.
    expect(comparison.outcomes).toHaveLength(1);
    const out = comparison.outcomes[0];
    expect(out.scenarioId).toBe('s-a');
    expect(out.scenarioName).toBe('Programa de capacitación');
    expect(out.totalInvestmentClp).toBe(5_000_000);
    expect(out.projectedSavingsClp).toBe(25_000_000);
    expect(out.projectedRoiPercent).toBe(400);
    expect(out.paybackMonths).toBe(2.4);
    // Score: roi>=200 → 100*0.5; payback 2.4 → (1-2.4/36)*100*0.3; high → 100*0.2.
    // 50 + 28 + 20 = 98.
    expect(out.recommendationScore).toBe(98);
    // Sensitivity band: ±20% on reduction (50→40 / 50→60).
    // low: 4 avoided → savings 20M → ROI (20M-5M)/5M*100 = 300.
    // high: 6 avoided → savings 30M → ROI (30M-5M)/5M*100 = 500.
    expect(out.sensitivityBand).toEqual({ roiLowerBound: 300, roiUpperBound: 500 });
    // Single scenario is the recommended one; rationale is non-empty.
    expect(comparison.recommendedScenario.scenarioId).toBe('s-a');
    expect(Array.isArray(comparison.rationale)).toBe(true);
    expect(comparison.rationale.length).toBeGreaterThan(0);
    // baseline echoed back verbatim.
    expect(comparison.baseline).toEqual(baseline());
  });

  it('200 picks the higher-score scenario as recommended across N scenarios', async () => {
    // Scenario "lo" has a weak reduction (10%) → low ROI; "hi" has strong (60%).
    const lo = scenario({
      id: 's-lo',
      name: 'Bajo impacto',
      assumptions: {
        expectedIncidentReductionPct: 10,
        expectedComplianceImprovementPct: 10,
        paybackMonthsEstimate: 24,
        confidenceLevel: 'low',
      },
    });
    const hi = scenario({
      id: 's-hi',
      name: 'Alto impacto',
      assumptions: {
        expectedIncidentReductionPct: 60,
        expectedComplianceImprovementPct: 40,
        paybackMonthsEstimate: 6,
        confidenceLevel: 'high',
      },
    });
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ scenarios: [lo, hi], baseline: baseline() });
    expect(res.status).toBe(200);
    expect(res.body.comparison.outcomes).toHaveLength(2);
    expect(res.body.comparison.recommendedScenario.scenarioId).toBe('s-hi');
  });

  it('400 on empty scenarios array (schema min 1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ scenarios: [], baseline: baseline() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on missing baseline', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ scenarios: [scenario()] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid investment category enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        scenarios: [scenario({ investments: [{ category: 'bribes', amountClp: 1 }] })],
        baseline: baseline(),
      });
    expect(res.status).toBe(400);
  });

  it('400 on out-of-range reduction percentage (>100)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        scenarios: [
          scenario({
            assumptions: {
              expectedIncidentReductionPct: 150,
              expectedComplianceImprovementPct: 30,
              paybackMonthsEstimate: 12,
              confidenceLevel: 'high',
            },
          }),
        ],
        baseline: baseline(),
      });
    expect(res.status).toBe(400);
  });

  it('400 on negative baseline rate', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        scenarios: [scenario()],
        baseline: baseline({ baselineRatePerYear: -5 }),
      });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/roi-scenario/compare')
      .set(uid)
      .send({ scenarios: [scenario()], baseline: baseline() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/roi-scenario/compare')
      .set(uid)
      .send({ scenarios: [scenario()], baseline: baseline() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
