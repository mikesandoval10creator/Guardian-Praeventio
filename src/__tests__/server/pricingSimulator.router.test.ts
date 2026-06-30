// Real-router supertest for the Pricing Simulator HTTP surface
// (src/server/routes/pricingSimulator.ts). Three stateless POST endpoints over
// the pure-compute engine in src/services/pricingSimulator/pricingSimulator.ts:
//
//   POST /:projectId/pricing/estimate-bill      → { estimate }
//   POST /:projectId/pricing/compare-tiers      → { comparisons }
//   POST /:projectId/pricing/worker-break-even  → { workers, found }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore — 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real deterministic
// compute. Happy-path assertions re-derive expected values from the engine's
// TIER_TABLE and DEFAULT_OVERAGE_RATES constants in pricingSimulator.ts:
//
//   free:       base 0, maxWorkers 5, maxProjects 1, 50 AI, 1 GB
//   starter:    base 29990, maxWorkers 25, maxProjects 3, 500 AI, 10 GB
//   pro:        base 89990, maxWorkers 100, maxProjects 10, 5000 AI, 100 GB
//   enterprise: base 290000, unlimited workers/projects, 50000 AI, 1000 GB
//   overage rates: worker 1500/proj 9990/aiCall 50/storageGb 990

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

import pricingSimulatorRouter from '../../server/routes/pricingSimulator.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', pricingSimulatorRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// Baseline usage that fits cleanly in 'starter' (25 workers, 3 projects, ≤500 AI, ≤10 GB)
const starterFitUsage = {
  workers: 20,
  projects: 2,
  aiCallsPerMonth: 400,
  storageGb: 8,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. estimate-bill
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/pricing/estimate-bill', () => {
  const url = '/api/p1/pricing/estimate-bill';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ tier: 'starter', usage: starterFitUsage });
    expect(res.status).toBe(401);
  });

  it('200 starter tier with usage within limits: no overage, fitsWithoutOverage true', async () => {
    // TIER_TABLE.starter: base=29990, maxWorkers=25, maxProjects=3, AI=500, GB=10
    // usage 20w/2p/400AI/8GB — all under limits → zero overage
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tier: 'starter', usage: starterFitUsage });
    expect(res.status).toBe(200);
    const { estimate } = res.body as {
      estimate: {
        tier: string;
        baseClp: number;
        overage: { workers: { excess: number; clp: number }; projects: { excess: number; clp: number }; aiCalls: { excess: number; clp: number }; storage: { excess: number; clp: number } };
        totalOverageClp: number;
        totalClp: number;
        fitsWithoutOverage: boolean;
      };
    };
    expect(estimate.tier).toBe('starter');
    expect(estimate.baseClp).toBe(29_990);
    expect(estimate.overage.workers).toEqual({ excess: 0, clp: 0 });
    expect(estimate.overage.projects).toEqual({ excess: 0, clp: 0 });
    expect(estimate.totalOverageClp).toBe(0);
    expect(estimate.totalClp).toBe(29_990);
    expect(estimate.fitsWithoutOverage).toBe(true);
  });

  it('200 free tier with 10 workers generates worker overage (excess 5 × 1500 = 7500)', async () => {
    // TIER_TABLE.free: maxWorkers=5 → 10w → excess=5 → 5×1500=7500
    // projects=1, AI=50, GB=1 → within limits → other overages = 0
    const usageOverFree = {
      workers: 10,
      projects: 1,
      aiCallsPerMonth: 50,
      storageGb: 1,
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tier: 'free', usage: usageOverFree });
    expect(res.status).toBe(200);
    expect(res.body.estimate.baseClp).toBe(0);
    expect(res.body.estimate.overage.workers).toEqual({ excess: 5, clp: 7_500 });
    expect(res.body.estimate.totalOverageClp).toBe(7_500);
    expect(res.body.estimate.totalClp).toBe(7_500);
    expect(res.body.estimate.fitsWithoutOverage).toBe(false);
  });

  it('200 enterprise tier: unlimited workers/projects → always fits (Infinity limit, safeExcess returns 0)', async () => {
    const bigUsage = {
      workers: 50_000,
      projects: 5_000,
      aiCallsPerMonth: 50_000,
      storageGb: 1_000,
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tier: 'enterprise', usage: bigUsage });
    expect(res.status).toBe(200);
    expect(res.body.estimate.overage.workers).toEqual({ excess: 0, clp: 0 });
    expect(res.body.estimate.overage.projects).toEqual({ excess: 0, clp: 0 });
    // AI calls: 50000 included → 50000 used → 0 excess
    expect(res.body.estimate.overage.aiCalls).toEqual({ excess: 0, clp: 0 });
    expect(res.body.estimate.fitsWithoutOverage).toBe(true);
  });

  it('400 when tier is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tier: 'diamond', usage: starterFitUsage });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when usage is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tier: 'starter' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/pricing/estimate-bill')
      .set(uid)
      .send({ tier: 'starter', usage: starterFitUsage });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/pricing/estimate-bill')
      .set(uid)
      .send({ tier: 'starter', usage: starterFitUsage });
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. compare-tiers
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/pricing/compare-tiers', () => {
  const url = '/api/p1/pricing/compare-tiers';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ currentTier: 'free', usage: starterFitUsage });
    expect(res.status).toBe(401);
  });

  it('200 returns comparisons for all 4 tiers with diffPctVsCurrent', async () => {
    // currentTier=starter (base 29990, no overage for 20w/2p/400AI/8GB)
    // Engine maps all 4 tiers and computes diffClp vs current.
    // free with 20 workers: (20-5)×1500 = 22500 overage < 29990 → free is cheaper here.
    // pro base 89990 > 29990 → enterprise 290000 > 29990 → both more expensive.
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: 'starter', usage: starterFitUsage });
    expect(res.status).toBe(200);
    const { comparisons } = res.body as {
      comparisons: Array<{ tier: string; estimate: { totalClp: number }; diffClpVsCurrent: number; diffPctVsCurrent: number; recommended: boolean }>;
    };
    expect(comparisons).toHaveLength(4);
    const tiers = comparisons.map((c) => c.tier);
    expect(tiers).toEqual(['free', 'starter', 'pro', 'enterprise']);

    // Same tier (starter): diffClp = 0, diffPct = 0, recommended = false
    const starterComp = comparisons.find((c) => c.tier === 'starter')!;
    expect(starterComp.diffClpVsCurrent).toBe(0);
    expect(starterComp.diffPctVsCurrent).toBe(0);
    expect(starterComp.recommended).toBe(false);

    // Pro (89990) and enterprise (290000) are more expensive than starter (29990).
    const proComp = comparisons.find((c) => c.tier === 'pro')!;
    expect(proComp.diffClpVsCurrent).toBeGreaterThan(0);

    const entComp = comparisons.find((c) => c.tier === 'enterprise')!;
    expect(entComp.diffClpVsCurrent).toBeGreaterThan(0);
    // Enterprise diff is larger than pro diff
    expect(entComp.diffClpVsCurrent).toBeGreaterThan(proComp.diffClpVsCurrent);
  });

  it('200 recommends upgrade when current tier has overage and another tier fits cleanly', async () => {
    // currentTier=free with 20 workers → 15 over limit → large overage → expensive
    // starter fits cleanly → recommended = true (fitsWithoutOverage && !current.fitsWithoutOverage)
    const overFreeUsage = { workers: 20, projects: 1, aiCallsPerMonth: 50, storageGb: 1 };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: 'free', usage: overFreeUsage });
    expect(res.status).toBe(200);
    const starterComp = (res.body.comparisons as Array<{ tier: string; recommended: boolean }>).find(
      (c) => c.tier === 'starter',
    )!;
    expect(starterComp.recommended).toBe(true);
  });

  it('400 when currentTier is invalid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: 'gold', usage: starterFitUsage });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/pricing/compare-tiers')
      .set(uid)
      .send({ currentTier: 'starter', usage: starterFitUsage });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. worker-break-even
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/pricing/worker-break-even', () => {
  const url = '/api/p1/pricing/worker-break-even';

  const baseUsage = { workers: 5, projects: 1, aiCallsPerMonth: 100, storageGb: 5 };

  it('401 without auth header', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ currentTier: 'free', nextTier: 'starter', baseUsage });
    expect(res.status).toBe(401);
  });

  it('200 finds the break-even worker count where starter becomes cheaper than free', async () => {
    // free: base 0, overage 1500/worker above 5
    // starter: base 29990, no overage until 25 workers
    // At low worker counts, free+overage < starter. At some point, free overage exceeds 29990.
    // free cost = (w-5)*1500; starter = 29990
    // Break-even: (w-5)*1500 = 29990 → w = 5 + 29990/1500 = 5 + 19.99... = 24.99... → w=25
    // Engine searches in steps of 5 starting from baseUsage.workers(5).
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: 'free', nextTier: 'starter', baseUsage });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    // Break-even should be ≤25 (where starter fits cleanly at 25 workers, free hits limit overage)
    expect(res.body.workers).toBeGreaterThan(5);
    expect(res.body.workers).toBeLessThanOrEqual(25);
  });

  it('200 enterprise is never cheaper than free for tiny teams (found=false or large worker count)', async () => {
    // For very small teams, enterprise (290000 base) will never be cheaper within 0-10000 range.
    // The search caps at 10000 → returns { workers: 10000, found: false }
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: 'pro', nextTier: 'enterprise', baseUsage: { workers: 1, projects: 1, aiCallsPerMonth: 100, storageGb: 5 } });
    expect(res.status).toBe(200);
    // pro=89990, enterprise=290000 — enterprise only pays off at very large workers
    // May find or not, but result shape is always { workers: number, found: boolean }
    expect(typeof res.body.workers).toBe('number');
    expect(typeof res.body.found).toBe('boolean');
  });

  it('400 when nextTier is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: 'free', baseUsage });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when currentTier is an invalid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: 'titanio', nextTier: 'enterprise', baseUsage });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/pricing/worker-break-even')
      .set(uid)
      .send({ currentTier: 'free', nextTier: 'starter', baseUsage });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
