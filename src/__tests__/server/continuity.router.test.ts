// Real-router supertest for the Business Continuity HTTP surface
// (src/server/routes/continuity.ts). Three stateless POST endpoints over the
// pure engine in src/services/continuity/continuityPlanning.ts:
//
//   POST /:projectId/continuity/detect-spofs          → { spofs }
//   POST /:projectId/continuity/simulate-outage        → { outcome }
//   POST /:projectId/continuity/build-polyvalence-plan → { plan }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked so every 200 asserts the real deterministic
// output. The expected shapes below are re-derived from the engine's documented
// contract (SPOF kind/impactScope mapping, severity branch order, coverage
// rounding), not copied from the handler.

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

import continuityRouter from '../../server/routes/continuity.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', continuityRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db!._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db!._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. detect-spofs
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/continuity/detect-spofs', () => {
  const url = '/api/p1/continuity/detect-spofs';
  // One holder of each SPOF source so we exercise every branch of the engine.
  const body = {
    input: {
      uniqueSkillHolders: [
        { uid: 'w-rigger', skill: 'rigging', dependentTasks: ['izaje', 'maniobra'] },
      ],
      equipmentWithoutBackup: [
        { id: 'grua-01', label: 'Grúa torre 01', dependentTasks: ['montaje'] },
      ],
      soleSuppliers: [{ supplierId: 'sup-acme', service: 'oxígeno medicinal' }],
      unbackedCriticalDocs: [{ docId: 'doc-iper', title: 'Matriz IPER faena' }],
    },
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 maps each source to a SPOF with the engine kind/impactScope contract', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.spofs)).toBe(true);
    expect(res.body.spofs).toHaveLength(4);

    const byKind = Object.fromEntries(
      res.body.spofs.map((s: { kind: string }) => [s.kind, s]),
    );

    // person: id=uid, label="uid (skill)", operational+safety, dependentTasks
    // carried through, cross-training mitigation naming the skill.
    expect(byKind.person).toMatchObject({
      kind: 'person',
      id: 'w-rigger',
      label: 'w-rigger (rigging)',
      dependentTasks: ['izaje', 'maniobra'],
      impactScopes: ['operational', 'safety'],
    });
    expect(byKind.person.mitigation).toContain('rigging');

    // equipment: operational only, dependentTasks carried through.
    expect(byKind.equipment).toMatchObject({
      kind: 'equipment',
      id: 'grua-01',
      label: 'Grúa torre 01',
      dependentTasks: ['montaje'],
      impactScopes: ['operational'],
    });

    // supplier: operational+compliance, NO dependentTasks, id is supplierId.
    expect(byKind.supplier).toMatchObject({
      kind: 'supplier',
      id: 'sup-acme',
      label: 'sup-acme',
      dependentTasks: [],
      impactScopes: ['operational', 'compliance'],
    });

    // document: compliance only, label is the title.
    expect(byKind.document).toMatchObject({
      kind: 'document',
      id: 'doc-iper',
      label: 'Matriz IPER faena',
      dependentTasks: [],
      impactScopes: ['compliance'],
    });
  });

  it('200 returns an empty list when no sources are supplied', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        input: {
          uniqueSkillHolders: [],
          equipmentWithoutBackup: [],
          soleSuppliers: [],
          unbackedCriticalDocs: [],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.spofs).toEqual([]);
  });

  it('400 on invalid body (missing input)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a holder is missing required fields', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        input: {
          uniqueSkillHolders: [{ uid: 'w1' }], // missing skill + dependentTasks
          equipmentWithoutBackup: [],
          soleSuppliers: [],
          unbackedCriticalDocs: [],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/continuity/detect-spofs')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/continuity/detect-spofs')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. simulate-outage
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/continuity/simulate-outage', () => {
  const url = '/api/p1/continuity/simulate-outage';

  // A 'person' SPOF carries operational+safety; an outage of >8h on a safety
  // scope is 'catastrophic' per the engine's branch order, with both
  // production-stop and risk-exposure hours = outageHours, and the catastrophic
  // mitigation steps appended.
  const safetySpof = {
    kind: 'person' as const,
    id: 'w-rigger',
    label: 'w-rigger (rigging)',
    dependentTasks: ['izaje', 'maniobra', 'descarga'],
    impactScopes: ['operational', 'safety'] as Array<'operational' | 'safety' | 'compliance'>,
    mitigation: 'Cross-training: identificar 2 candidatos.',
  };

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ input: { resourceId: 'x', resourceKind: 'person', outageHours: 1, spofs: [] } });
    expect(res.status).toBe(401);
  });

  it('200 derives catastrophic severity for a >8h safety-scope outage', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        input: {
          resourceId: 'w-rigger',
          resourceKind: 'person',
          outageHours: 10,
          spofs: [safetySpof],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.outcome.severity).toBe('catastrophic');
    expect(res.body.outcome.affectedTaskCount).toBe(3);
    expect(res.body.outcome.affectedTasks).toEqual(['izaje', 'maniobra', 'descarga']);
    expect(res.body.outcome.productionStopHours).toBe(10); // operational scope
    expect(res.body.outcome.riskExposureHours).toBe(10); // safety scope
    // First step is the SPOF mitigation; catastrophic appends the two escalations.
    expect(res.body.outcome.mitigationSteps[0]).toBe(safetySpof.mitigation);
    expect(res.body.outcome.mitigationSteps).toHaveLength(3);
  });

  it('200 returns minor with zero impact when the resource is not a known SPOF', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        input: {
          resourceId: 'unknown',
          resourceKind: 'equipment',
          outageHours: 100,
          spofs: [safetySpof],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toMatchObject({
      severity: 'minor',
      affectedTaskCount: 0,
      affectedTasks: [],
      productionStopHours: 0,
      riskExposureHours: 0,
    });
  });

  it('200 an operational-only SPOF has no risk-exposure hours and moderate severity', async () => {
    // operational scope only, 2 dependent tasks (<=5), outage <=24 → moderate.
    const opSpof = {
      kind: 'equipment' as const,
      id: 'grua-01',
      label: 'Grúa 01',
      dependentTasks: ['montaje', 'izaje'],
      impactScopes: ['operational'] as Array<'operational' | 'safety' | 'compliance'>,
      mitigation: 'Adquirir backup.',
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        input: { resourceId: 'grua-01', resourceKind: 'equipment', outageHours: 4, spofs: [opSpof] },
      });
    expect(res.status).toBe(200);
    expect(res.body.outcome.severity).toBe('moderate');
    expect(res.body.outcome.productionStopHours).toBe(4);
    expect(res.body.outcome.riskExposureHours).toBe(0);
    expect(res.body.outcome.mitigationSteps).toEqual([opSpof.mitigation]);
  });

  it('400 when outageHours is negative', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        input: { resourceId: 'x', resourceKind: 'person', outageHours: -1, spofs: [] },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an invalid resourceKind enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        input: { resourceId: 'x', resourceKind: 'alien', outageHours: 1, spofs: [] },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/continuity/simulate-outage')
      .set(uid)
      .send({ input: { resourceId: 'x', resourceKind: 'person', outageHours: 1, spofs: [] } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. build-polyvalence-plan
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/continuity/build-polyvalence-plan', () => {
  const url = '/api/p1/continuity/build-polyvalence-plan';

  // 4 workers. rigging held by 1/4 = 25%; welding held by 2/4 = 50%. With the
  // default minCoveragePercent=30, rigging (25 < 30) is undercovered and welding
  // (50 >= 30) is not. The engine sends the route string[] which it converts to
  // Set<string> before invoking buildPolyvalencePlan.
  const body = {
    matrix: [
      { workerUid: 'w1', skills: ['rigging', 'welding'] },
      { workerUid: 'w2', skills: ['welding'] },
      { workerUid: 'w3', skills: ['scaffolding'] },
      { workerUid: 'w4', skills: ['scaffolding'] },
    ],
    requiredSkills: ['rigging', 'welding'],
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 derives coverage %, undercovered skills, and a round-robin training pair', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    const { plan } = res.body;
    expect(plan.requiredSkills).toEqual(['rigging', 'welding']);
    // Math.round((holders / 4) * 100): rigging 1/4=25, welding 2/4=50.
    expect(plan.coverageBySkill).toEqual({ rigging: 25, welding: 50 });
    // default minCoveragePercent=30 → only rigging is undercovered.
    expect(plan.underCoveredSkills).toEqual(['rigging']);
    // rigging trainers=[w1], trainees=[w2,w3,w4] → min(1,3)=1 pair, first of each.
    expect(plan.trainingPairs).toEqual([
      { trainer: 'w1', trainee: 'w2', skill: 'rigging' },
    ]);
  });

  it('200 honours an explicit minCoveragePercent that flags both skills', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, minCoveragePercent: 60 });
    expect(res.status).toBe(200);
    // With a 60% bar, both rigging(25) and welding(50) fall short.
    expect(res.body.plan.underCoveredSkills).toEqual(['rigging', 'welding']);
  });

  it('200 yields 0% coverage and no pairs for an empty matrix', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrix: [], requiredSkills: ['rigging'] });
    expect(res.status).toBe(200);
    expect(res.body.plan.coverageBySkill).toEqual({ rigging: 0 });
    expect(res.body.plan.underCoveredSkills).toEqual(['rigging']);
    expect(res.body.plan.trainingPairs).toEqual([]);
  });

  it('400 when minCoveragePercent is out of range (>100)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, minCoveragePercent: 150 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when matrix entries are malformed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ matrix: [{ workerUid: 'w1', skills: 'not-an-array' }], requiredSkills: ['x'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/continuity/build-polyvalence-plan')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
