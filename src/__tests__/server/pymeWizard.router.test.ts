// Real-router supertest for the PYME Wizard (fast onboarding plan) HTTP surface
// (src/server/routes/pymeWizard.ts). One stateless POST endpoint over the
// pure-compute engine in src/services/pymeWizard/pymeOnboardingWizard.ts:
//
//   POST /:projectId/pyme-wizard/build-plan
//     body: PymeOnboardingInput
//     200:  { plan: OnboardingPlan }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore — 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real deterministic
// compute. Happy-path assertions re-derive expected values from the engine's
// own logic (criticalPath, totalEstimatedMinutes, regulatoryNotes, etc.) rather
// than copying the handler.
//
// NOTE: this router (src/server/routes/pymeWizard.ts) is DISTINCT from
// the already-covered src/server/routes/pymeOnboarding.ts — different engine,
// different mount path.

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

import pymeWizardRouter from '../../server/routes/pymeWizard.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { buildOnboardingPlan } from '../../services/pymeWizard/pymeOnboardingWizard.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', pymeWizardRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. pyme-wizard/build-plan
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/pyme-wizard/build-plan', () => {
  const url = '/api/p1/pyme-wizard/build-plan';

  it('401 without auth header', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ industry: 'construction', workerCount: 10, keyRisks: [] });
    expect(res.status).toBe(401);
  });

  it('200 construction company <25 workers: profile + RIOHS + induction + review on criticalPath', async () => {
    // workerCount=10 (<25) → CPHS not mandatory, added as optional (required=false)
    // No keyRisks → no risk training steps
    // Engine: criticalPath = required steps only
    const input = { industry: 'construction' as const, workerCount: 10, keyRisks: [] as never[] };
    const expected = buildOnboardingPlan(input);

    const res = await request(buildApp()).post(url).set(uid).send(input);
    expect(res.status).toBe(200);

    const { plan } = res.body as { plan: typeof expected };
    // Critical path contains only required step ids
    expect(plan.criticalPath).toEqual(expected.criticalPath);
    // profile, doc_riohs, training_induction, final_review always required
    expect(plan.criticalPath).toContain('profile');
    expect(plan.criticalPath).toContain('doc_riohs');
    expect(plan.criticalPath).toContain('training_induction');
    expect(plan.criticalPath).toContain('final_review');
    // committee_cphs is NOT on criticalPath for <25 workers (it's optional)
    expect(plan.criticalPath).not.toContain('committee_cphs');

    // totalEstimatedMinutes reflects required steps only (not module_setup)
    expect(plan.totalEstimatedMinutes).toBe(expected.totalEstimatedMinutes);
    expect(plan.optionalSetupMinutes).toBe(expected.optionalSetupMinutes);

    // recommendedModules for construction
    expect(plan.recommendedModules).toEqual(['height_work', 'epp', 'incidents', 'documents']);
  });

  it('200 mining company >=25 workers: CPHS mandatory on criticalPath + sernageomin note', async () => {
    // workerCount=30 (>=25) → CPHS mandatory → included in criticalPath
    // industry=mining → reg.sernageomin.applicable note
    const input = {
      industry: 'mining' as const,
      workerCount: 30,
      keyRisks: [] as never[],
    };
    const expected = buildOnboardingPlan(input);

    const res = await request(buildApp()).post(url).set(uid).send(input);
    expect(res.status).toBe(200);

    const { plan } = res.body as { plan: typeof expected };
    expect(plan.criticalPath).toContain('committee_cphs');
    expect(plan.regulatoryNotes).toContain('reg.cphs.mandatory_25plus');
    expect(plan.regulatoryNotes).toContain('reg.sernageomin.applicable');
    expect(plan.totalEstimatedMinutes).toBe(expected.totalEstimatedMinutes);
  });

  it('200 risk training steps are sorted alphabetically + deduplicated', async () => {
    // keyRisks with duplicate 'falls_from_height' and unsorted order
    const input = {
      industry: 'construction' as const,
      workerCount: 5,
      keyRisks: ['noise', 'falls_from_height', 'noise'] as Array<'noise' | 'falls_from_height'>,
    };
    const res = await request(buildApp()).post(url).set(uid).send(input);
    expect(res.status).toBe(200);

    const { plan } = res.body as {
      plan: { steps: Array<{ id: string }>; regulatoryNotes: string[] };
    };
    // Only 2 unique risks, sorted: falls_from_height, noise
    const riskStepIds = plan.steps
      .filter((s) => s.id.startsWith('training_risk_'))
      .map((s) => s.id);
    expect(riskStepIds).toEqual(['training_risk_falls_from_height', 'training_risk_noise']);

    // falls_from_height triggers regulatory note
    expect(plan.regulatoryNotes).toContain('reg.height_work_procedure_required');
  });

  it('200 hasExistingRiohs=true reduces RIOHS step time to 3 min (reuse existing)', async () => {
    // Engine: riohsStep with hasExistingRiohs=true → estimatedMinutes=3 instead of 8
    const input = {
      industry: 'services' as const,
      workerCount: 5,
      keyRisks: [] as never[],
      hasExistingRiohs: true,
    };
    const res = await request(buildApp()).post(url).set(uid).send(input);
    expect(res.status).toBe(200);
    const riohsStep = (res.body.plan.steps as Array<{ id: string; estimatedMinutes: number }>).find(
      (s) => s.id === 'doc_riohs',
    );
    expect(riohsStep?.estimatedMinutes).toBe(3);
  });

  it('400 when industry is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ industry: 'aerospace', workerCount: 10, keyRisks: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when workerCount is 0 (schema .positive())', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ industry: 'construction', workerCount: 0, keyRisks: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a keyRisk is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ industry: 'construction', workerCount: 10, keyRisks: ['radiation'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/pyme-wizard/build-plan')
      .set(uid)
      .send({ industry: 'construction', workerCount: 10, keyRisks: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/pyme-wizard/build-plan')
      .set(uid)
      .send({ industry: 'construction', workerCount: 10, keyRisks: [] });
    expect(res.status).toBe(403);
  });
});

// Type-only guard: keep engine types referenced so the import is not pruned.
const _typeCheck = buildOnboardingPlan.length;
void _typeCheck;
