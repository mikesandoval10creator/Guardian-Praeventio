// Real-router supertest for the Consultative Sale Playbook HTTP surface
// (src/server/routes/consultativeSale.ts). One stateless POST endpoint over the
// pure engine in src/services/consultativeSale/consultativeSalePlaybook.ts:
//
//   POST /:projectId/sales/build-playbook → { playbook }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked, so every 200 asserts the real playbook
// shape re-derived from the engine (recommendTier branches, priorityModules
// filter/sort/slice, closeProb scoring), never copied from the handler.

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

import consultativeSaleRouter from '../../server/routes/consultativeSale.js';
import { buildSalePlaybook } from '../../services/consultativeSale/consultativeSalePlaybook.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', consultativeSaleRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };
const url = '/api/p1/sales/build-playbook';

// A mining prospect: large but < 500 workers → pro via the high-risk branch
// (industry mining + >50 workers), currentSolution paper, stage demo.
const body = {
  companyName: 'Minera Los Andes',
  industry: 'mining' as const,
  size: 'large' as const,
  workersCount: 200,
  projectsActive: 4,
  jurisdiction: 'CL' as const,
  declaredPains: [
    'high_incident_rate',
    'difficult_audit_prep',
    'unclear_compliance_status',
  ] as const,
  currentSolution: 'paper' as const,
  stage: 'demo' as const,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db!._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db!._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/sales/build-playbook', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 returns the real playbook re-derived from the engine', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    // Re-derive from the REAL engine — the handler must return exactly this.
    const expected = buildSalePlaybook(body as never);
    expect(res.body.playbook).toEqual(expected);

    const pb = res.body.playbook;
    // mining + 200 workers (>50) → pro tier via the high-risk branch.
    expect(pb.recommendedTier).toBe('pro');
    expect(pb.tierJustification).toBe('Industria alto riesgo + >50 trabajadores');
    expect(pb.prospectName).toBe('Minera Los Andes');

    // Priority modules: only modules whose pains intersect declaredPains, and
    // accessible at pro tier, sorted desc by hit count, capped at 5.
    // risk_radar resolves high_incident_rate; shift_risk_panel resolves
    // high_incident_rate; audit_express resolves difficult_audit_prep;
    // compliance_traffic_light resolves unclear_compliance_status.
    const moduleIds = pb.priorityModules.map(
      (m: { module: { id: string } }) => m.module.id,
    );
    expect(moduleIds).toContain('risk_radar');
    expect(moduleIds).toContain('audit_express');
    expect(moduleIds).toContain('compliance_traffic_light');
    expect(pb.priorityModules.length).toBeLessThanOrEqual(5);
    // Every priority module actually resolves at least one declared pain.
    for (const pm of pb.priorityModules as Array<{
      resolvesPainsCount: number;
    }>) {
      expect(pm.resolvesPainsCount).toBeGreaterThan(0);
    }

    // demo stage → the first 4 demo discovery questions.
    expect(pb.nextStageQuestions).toHaveLength(3); // demo has only 3 defined
    expect(pb.nextStageQuestions[0]).toBe(
      '¿Quieres que partamos por el módulo que más te interesa o un tour ejecutivo?',
    );

    // mining case study hint present.
    expect(pb.caseStudyHints).toContain('Mining mediano CL — Codelco contratista');
    expect(pb.caseStudyHints).toContain('Caso con >200 trabajadores');

    // closeProb: base 30 +15 (>=3 pains) +15 (>=3 modules) +20 (paper) = 80.
    expect(pb.estimatedCloseProb).toBe(80);
    expect(pb.estimatedCloseProb).toBeGreaterThanOrEqual(0);
    expect(pb.estimatedCloseProb).toBeLessThanOrEqual(100);

    // rationale mentions the high-risk industry + paper/Excel opportunity.
    expect(pb.rationale.some((r: string) => r.includes('alto-riesgo'))).toBe(true);
    expect(
      pb.rationale.some((r: string) => r.includes('papel/Excel')),
    ).toBe(true);
  });

  it('200 enterprise size escalates the tier and never exceeds 100 closeProb', async () => {
    const enterpriseBody = {
      ...body,
      size: 'enterprise' as const,
      workersCount: 800,
      stage: 'closing' as const,
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send(enterpriseBody);
    expect(res.status).toBe(200);
    const expected = buildSalePlaybook(enterpriseBody as never);
    expect(res.body.playbook).toEqual(expected);
    // size enterprise → enterprise tier (first branch).
    expect(res.body.playbook.recommendedTier).toBe('enterprise');
    expect(res.body.playbook.tierJustification).toBe(
      'Tamaño enterprise o ≥500 trabajadores',
    );
    // closeProb saturates at 100 (base 30 +15 +15 +20 paper +20 closing = 100).
    expect(res.body.playbook.estimatedCloseProb).toBe(100);
    // enterprise rollout case study hint surfaces.
    expect(res.body.playbook.caseStudyHints).toContain(
      'Enterprise rollout 5+ sitios',
    );
  });

  it('200 a micro prospect with no qualifying pains lands on the free tier', async () => {
    const microBody = {
      companyName: 'Taller Pequeño',
      industry: 'retail' as const,
      size: 'micro' as const,
      workersCount: 4,
      jurisdiction: 'CL' as const,
      declaredPains: ['lone_worker_safety'] as const,
      stage: 'discovery' as const,
    };
    const res = await request(buildApp()).post(url).set(uid).send(microBody);
    expect(res.status).toBe(200);
    expect(res.body.playbook).toEqual(buildSalePlaybook(microBody as never));
    expect(res.body.playbook.recommendedTier).toBe('free');
    expect(res.body.playbook.tierJustification).toBe(
      'Probar free tier antes de upgrade',
    );
    // closeProb: base 30, only 1 pain, sos_lone_worker is starter (not free
    // accessible) so 0 priority modules, no paper, micro+free → -10 = 20.
    expect(res.body.playbook.estimatedCloseProb).toBe(20);
    // free tier cannot access the starter-min sos_lone_worker module.
    expect(res.body.playbook.priorityModules).toEqual([]);
  });

  it('400 on an unknown industry enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, industry: 'space_mining' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an invalid declared pain', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, declaredPains: ['not_a_real_pain'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a negative workersCount', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, workersCount: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a required field is missing', async () => {
    const { stage: _drop, ...incomplete } = body;
    const res = await request(buildApp()).post(url).set(uid).send(incomplete);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an empty companyName (min(1) violated)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, companyName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/sales/build-playbook')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/sales/build-playbook')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
