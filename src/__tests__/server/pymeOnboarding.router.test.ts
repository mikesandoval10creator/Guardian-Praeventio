// Real-router supertest for the PYME Onboarding HTTP surface
// (src/server/routes/pymeOnboarding.ts). Two stateless POST endpoints over the
// pure-compute engine in src/services/pymeOnboarding/pymeWizard.ts:
//
//   POST /sprint-k/:projectId/pyme-onboarding/maturity → { maturity }
//   POST /sprint-k/:projectId/pyme-onboarding/plan     → { plan }
//
// Mounted in server.ts as `app.use('/api/sprint-k', pymeOnboardingRouter)`.
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore — 403 is exercised by NOT seeding the caller into the project.
// verifyAuth + logger + observability are mocked; the engine runs UNMOCKED so
// every 200 asserts real deterministic compute. Happy-path assertions
// re-derive expected output from the engine's own scoring rules rather than
// copying the handler.

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

import pymeOnboardingRouter from '../../server/routes/pymeOnboarding.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  computeMaturity,
  buildThirtyDayPlan,
  type PymeWizardInput,
} from '../../services/pymeOnboarding/pymeWizard.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', pymeOnboardingRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

/** All capabilities present — 30-worker construction company (highest maturity). */
function fullInput(over: Partial<PymeWizardInput> = {}): PymeWizardInput {
  return {
    industry: 'construction',
    workerCount: 30,
    hasSupervisor: true,
    hasCphs: true,
    hasRiohs: true,
    hasTrainingProgram: true,
    registersIncidents: true,
    hasMutualidad: true,
    usesNormedEpp: true,
    ...over,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // u1 is a member of p1; u1 is NOT a member of p2.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['other'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/pyme-onboarding/maturity
// ────────────────────────────────────────────────────────────────────────

describe('POST /api/sprint-k/:projectId/pyme-onboarding/maturity', () => {
  const url = '/api/sprint-k/p1/pyme-onboarding/maturity';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send(fullInput());
    expect(res.status).toBe(401);
  });

  it('200 level 5 (autonomous) for a fully-equipped 30-worker construction company', async () => {
    // score = 15(mutualidad)+10(epp)+15(riohs)+15(cphs>=25)+10(supervisor)
    //        +15(training)+20(incidents) = 100 → level 5
    const body = fullInput();
    const expected = computeMaturity(body);
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.maturity.level).toBe(5);
    expect(res.body.maturity.label).toBe('autonomous');
    expect(res.body.maturity.score).toBe(expected.score);
    expect(res.body.maturity.missingCapabilities).toEqual([]);
    expect(res.body.maturity.nextSteps).toEqual([]);
  });

  it('200 level 1 (reactive) for a bare-minimum 10-worker company with nothing in place', async () => {
    // workerCount<25: no CPHS required but also no cphs score → engine adds 10 (small-pyme bonus).
    // Everything else false → score = 10 → level 1 (reactive, <30).
    const body = fullInput({
      workerCount: 10,
      hasSupervisor: false,
      hasCphs: false,
      hasRiohs: false,
      hasTrainingProgram: false,
      registersIncidents: false,
      hasMutualidad: false,
      usesNormedEpp: false,
    });
    const expected = computeMaturity(body);
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.maturity.level).toBe(1);
    expect(res.body.maturity.label).toBe('reactive');
    expect(res.body.maturity.score).toBe(expected.score);
    expect(res.body.maturity.missingCapabilities.length).toBeGreaterThan(0);
    // nextSteps is exactly the first 3 missing capabilities from the engine
    expect(res.body.maturity.nextSteps).toEqual(expected.missingCapabilities.slice(0, 3));
  });

  it('200 surfaces the mandatory CPHS warning for >=25-worker company without CPHS', async () => {
    const body = fullInput({ workerCount: 30, hasCphs: false });
    const expected = computeMaturity(body);
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.maturity.score).toBe(expected.score);
    // CPHS is mandatory for >=25 workers (DS 44/2024)
    const hasCphsWarning = (res.body.maturity.missingCapabilities as string[]).some((m) =>
      m.includes('CPHS'),
    );
    expect(hasCphsWarning).toBe(true);
  });

  it('400 when industry is not a valid enum value', async () => {
    const body = { ...fullInput(), industry: 'aerospace' };
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a required boolean field (hasCphs) is absent', async () => {
    const { hasCphs: _omit, ...body } = fullInput();
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when workerCount is negative (schema .nonnegative())', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(fullInput({ workerCount: -1 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/pyme-onboarding/maturity')
      .set(uid)
      .send(fullInput());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/ghost/pyme-onboarding/maturity')
      .set(uid)
      .send(fullInput());
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/pyme-onboarding/plan
// ────────────────────────────────────────────────────────────────────────

describe('POST /api/sprint-k/:projectId/pyme-onboarding/plan', () => {
  const url = '/api/sprint-k/p1/pyme-onboarding/plan';

  it('401 without auth header', async () => {
    const maturity = computeMaturity(fullInput());
    const res = await request(buildApp())
      .post(url)
      .send({ maturity, industry: 'construction' });
    expect(res.status).toBe(401);
  });

  it('200 for an autonomous company returns only the universal day-30 review action', async () => {
    // Score 100 → no missingCapabilities → buildThirtyDayPlan appends only the
    // day-30 review step.
    const maturity = computeMaturity(fullInput());
    const expected = buildThirtyDayPlan(maturity, 'construction');
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ maturity, industry: 'construction' });
    expect(res.status).toBe(200);
    expect(res.body.plan).toHaveLength(expected.length);
    const last: { day: number; requiresSpecialist: boolean } =
      res.body.plan[res.body.plan.length - 1];
    expect(last.day).toBe(30);
    expect(last.requiresSpecialist).toBe(false);
  });

  it('200 for a bare-minimum company produces plan actions covering each gap + day-30 review', async () => {
    // All false / small workerCount → many gaps → many plan actions.
    const bareInput = fullInput({
      workerCount: 10,
      hasSupervisor: false,
      hasCphs: false,
      hasRiohs: false,
      hasTrainingProgram: false,
      registersIncidents: false,
      hasMutualidad: false,
      usesNormedEpp: false,
    });
    const maturity = computeMaturity(bareInput);
    const expected = buildThirtyDayPlan(maturity, 'mining');
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ maturity, industry: 'mining' });
    expect(res.status).toBe(200);
    expect(res.body.plan).toHaveLength(expected.length);
    // Plan always ends on day 30
    const last: { day: number } = res.body.plan[res.body.plan.length - 1];
    expect(last.day).toBe(30);
    // mutualidad gap is always day 1 when missing
    const first: { day: number } = res.body.plan[0];
    expect(first.day).toBe(1);
  });

  it('400 when maturity.level is out of the 1-5 literal range', async () => {
    const maturity = { ...computeMaturity(fullInput()), level: 6 };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ maturity, industry: 'construction' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when industry value is not in the enum', async () => {
    const maturity = computeMaturity(fullInput());
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ maturity, industry: 'blockchain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const maturity = computeMaturity(fullInput());
    const res = await request(buildApp())
      .post('/api/sprint-k/p2/pyme-onboarding/plan')
      .set(uid)
      .send({ maturity, industry: 'construction' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// Type-only guard: keep imported engine types referenced to prevent pruning.
const _typeCheck: keyof PymeWizardInput = 'industry';
void _typeCheck;
