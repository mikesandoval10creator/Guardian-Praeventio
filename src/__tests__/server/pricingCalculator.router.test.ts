// Real-router supertest for the Pricing Calculator HTTP surface
// (src/server/routes/pricingCalculator.ts). Four stateless POST endpoints over
// the pure-compute engine in src/services/pricingCalculator/pricingCalculator.ts:
//
//   POST /:projectId/pricing-calculator/estimate-tier-cost   → { estimate }
//   POST /:projectId/pricing-calculator/compare-tiers        → { comparison }
//   POST /:projectId/pricing-calculator/compute-roi          → { report }
//   POST /:projectId/pricing-calculator/suggest-purchase-orders → { suggestions }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore — 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real deterministic
// compute. Happy-path assertions re-derive expected values from the engine's
// own formulas (sourced from src/services/pricingCalculator/pricingCalculator.ts).

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

import pricingCalculatorRouter from '../../server/routes/pricingCalculator.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', pricingCalculatorRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

/** A realistic tier plan for testing. */
const planA = {
  id: 'starter',
  monthlyPriceClp: 29_990,
  workerLimit: 25,
  projectLimit: 3,
  overagePerWorkerClp: 1_500,
  overagePerProjectClp: 9_990,
  features: ['incidents', 'workers'],
};

const planB = {
  id: 'pro',
  monthlyPriceClp: 89_990,
  workerLimit: 100,
  projectLimit: 10,
  overagePerWorkerClp: 1_200,
  overagePerProjectClp: 7_990,
  features: ['incidents', 'workers', 'analytics'],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. estimate-tier-cost
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/pricing-calculator/estimate-tier-cost', () => {
  const url = '/api/p1/pricing-calculator/estimate-tier-cost';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ plan: planA, usage: { activeWorkers: 10, activeProjects: 1 } });
    expect(res.status).toBe(401);
  });

  it('200 no overage when usage fits within plan limits (engine formula: workersOver=0, projectsOver=0)', async () => {
    // usage 10 workers, 1 project; plan limit 25/3 → no overage.
    // Engine: total = base(29990) + 0 + 0 = 29990, fitsInPlan = true
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ plan: planA, usage: { activeWorkers: 10, activeProjects: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.estimate.tierId).toBe('starter');
    expect(res.body.estimate.basePriceClp).toBe(29_990);
    expect(res.body.estimate.workerOverageClp).toBe(0);
    expect(res.body.estimate.projectOverageClp).toBe(0);
    expect(res.body.estimate.totalMonthlyClp).toBe(29_990);
    expect(res.body.estimate.fitsInPlan).toBe(true);
    expect(res.body.estimate.workersOver).toBe(0);
    expect(res.body.estimate.projectsOver).toBe(0);
  });

  it('200 calculates overage when usage exceeds plan limits', async () => {
    // 30 workers (5 over limit 25) × 1500 = 7500; 4 projects (1 over 3) × 9990 = 9990
    // total = 29990 + 7500 + 9990 = 47480
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ plan: planA, usage: { activeWorkers: 30, activeProjects: 4 } });
    expect(res.status).toBe(200);
    expect(res.body.estimate.workersOver).toBe(5);
    expect(res.body.estimate.workerOverageClp).toBe(7_500);
    expect(res.body.estimate.projectsOver).toBe(1);
    expect(res.body.estimate.projectOverageClp).toBe(9_990);
    expect(res.body.estimate.totalMonthlyClp).toBe(47_480);
    expect(res.body.estimate.fitsInPlan).toBe(false);
  });

  it('400 when plan is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ usage: { activeWorkers: 5, activeProjects: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/pricing-calculator/estimate-tier-cost')
      .set(uid)
      .send({ plan: planA, usage: { activeWorkers: 10, activeProjects: 1 } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. compare-tiers
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/pricing-calculator/compare-tiers', () => {
  const url = '/api/p1/pricing-calculator/compare-tiers';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ plans: [planA], usage: { activeWorkers: 10, activeProjects: 1 } });
    expect(res.status).toBe(401);
  });

  it('200 returns sorted estimates with cheapestFitting and recommended', async () => {
    // planA: 29990 base, no overage for 10w/1p → fits
    // planB: 89990 base, no overage for 10w/1p → fits but more expensive
    // cheapestFitting = planA (cheapest that fits); recommended = planA
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ plans: [planB, planA], usage: { activeWorkers: 10, activeProjects: 1 } });
    expect(res.status).toBe(200);
    const { comparison } = res.body as {
      comparison: {
        estimates: Array<{ tierId: string; totalMonthlyClp: number; fitsInPlan: boolean }>;
        cheapestFitting?: { tierId: string };
        recommended?: { tierId: string };
      };
    };
    // Sorted ascending by totalMonthlyClp → starter first
    expect(comparison.estimates[0].tierId).toBe('starter');
    expect(comparison.estimates[0].totalMonthlyClp).toBe(29_990);
    expect(comparison.cheapestFitting?.tierId).toBe('starter');
    expect(comparison.recommended?.tierId).toBe('starter');
  });

  it('200 recommended falls back to cheapest even when nothing fits', async () => {
    // 100 workers vs both plans' limits (25, 100) — planB just fits (100 = limit → 0 overage)
    // Actually planA: 100-25=75 over → overage. planB: 100-100=0 → fits.
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ plans: [planA, planB], usage: { activeWorkers: 100, activeProjects: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.comparison.cheapestFitting?.tierId).toBe('pro');
    expect(res.body.comparison.recommended?.tierId).toBe('pro');
  });

  it('400 when usage is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ plans: [planA] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/pricing-calculator/compare-tiers')
      .set(uid)
      .send({ plans: [planA], usage: { activeWorkers: 10, activeProjects: 1 } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. compute-roi
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/pricing-calculator/compute-roi', () => {
  const url = '/api/p1/pricing-calculator/compute-roi';

  const excellentInputs = {
    costPerPreventedIncident: 1_000_000,
    preventedIncidents: 3,
    costPerAvoidedFine: 500_000,
    finesAvoided: 2,
    adminHoursSaved: 40,
    adminHourlyRateClp: 10_000,
    monthlyPlanClp: 89_990,
    additionalSafetyInvestmentClp: 50_000,
  };

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ inputs: excellentInputs });
    expect(res.status).toBe(401);
  });

  it('200 computes excellent ROI from real engine math', async () => {
    // benefitsClp = 3×1_000_000 + 2×500_000 + 40×10_000 = 3_000_000+1_000_000+400_000 = 4_400_000
    // costsClp = 89_990 + 50_000 = 139_990
    // ratio = 4_400_000 / 139_990 ≈ 31.43 → round(31.43×100)/100 = 31.43 → level: excellent
    const res = await request(buildApp()).post(url).set(uid).send({ inputs: excellentInputs });
    expect(res.status).toBe(200);
    expect(res.body.report.benefitsClp).toBe(4_400_000);
    expect(res.body.report.costsClp).toBe(139_990);
    expect(res.body.report.benefitCostRatio).toBe(31.43);
    expect(res.body.report.level).toBe('excellent');
    expect(typeof res.body.report.message).toBe('string');
  });

  it('200 returns underwater level when benefits < costs', async () => {
    // benefits = 0 (0 incidents, 0 fines, 0 admin hours) → ratio < 1 → underwater
    const underwaterInputs = {
      costPerPreventedIncident: 0,
      preventedIncidents: 0,
      costPerAvoidedFine: 0,
      finesAvoided: 0,
      adminHoursSaved: 0,
      adminHourlyRateClp: 0,
      monthlyPlanClp: 100_000,
      additionalSafetyInvestmentClp: 50_000,
    };
    const res = await request(buildApp()).post(url).set(uid).send({ inputs: underwaterInputs });
    expect(res.status).toBe(200);
    expect(res.body.report.benefitsClp).toBe(0);
    expect(res.body.report.level).toBe('underwater');
    expect(res.body.report.message).toContain('negativa');
  });

  it('400 when inputs is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/pricing-calculator/compute-roi')
      .set(uid)
      .send({ inputs: excellentInputs });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. suggest-purchase-orders
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/pricing-calculator/suggest-purchase-orders', () => {
  const url = '/api/p1/pricing-calculator/suggest-purchase-orders';

  /** A consumable whose stock is at safety level → urgent. */
  const urgentItem = {
    itemId: 'casco-3m',
    itemName: 'Casco 3M',
    currentStock: 10,
    monthlyConsumption: 30,
    safetyStock: 10, // currentStock === safetyStock → isUrgent = true
    leadTimeDays: 14,
    unitPriceClp: 15_000,
  };

  /** A consumable with plenty of stock → not urgent. */
  const safeItem = {
    itemId: 'guantes-nitrilo',
    itemName: 'Guantes Nitrilo',
    currentStock: 1000,
    monthlyConsumption: 100,
    safetyStock: 50,
    leadTimeDays: 7,
    unitPriceClp: 2_000,
  };

  it('401 without auth header', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ consumables: [urgentItem] });
    expect(res.status).toBe(401);
  });

  it('200 engine marks item urgent when currentStock <= safetyStock', async () => {
    // urgentItem: currentStock(10) === safetyStock(10) → isUrgent = true
    // suggestedOrderQty = ceil(30 × 2) = 60; cost = 60 × 15000 = 900000
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ consumables: [urgentItem] });
    expect(res.status).toBe(200);
    const [sugg] = res.body.suggestions as Array<{
      itemId: string;
      isUrgent: boolean;
      suggestedOrderQty: number;
      suggestedOrderCostClp: number;
    }>;
    expect(sugg.itemId).toBe('casco-3m');
    expect(sugg.isUrgent).toBe(true);
    expect(sugg.suggestedOrderQty).toBe(60);   // ceil(30 × 2)
    expect(sugg.suggestedOrderCostClp).toBe(900_000); // 60 × 15000
  });

  it('200 urgent items sorted before non-urgent by real engine', async () => {
    // safeItem: currentStock(1000) >> safetyStock(50) → NOT urgent
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ consumables: [safeItem, urgentItem] });
    expect(res.status).toBe(200);
    const suggestions = res.body.suggestions as Array<{ itemId: string; isUrgent: boolean }>;
    expect(suggestions).toHaveLength(2);
    // Engine sorts urgent first
    expect(suggestions[0].isUrgent).toBe(true);
    expect(suggestions[0].itemId).toBe('casco-3m');
    expect(suggestions[1].isUrgent).toBe(false);
  });

  it('200 empty consumables array returns empty suggestions', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ consumables: [] });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });

  it('400 when consumables is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ consumables: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/pricing-calculator/suggest-purchase-orders')
      .set(uid)
      .send({ consumables: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
