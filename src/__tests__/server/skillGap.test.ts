// Real-router supertest for src/server/routes/skillGap.ts
// (Plan v3 Fase 1 — 4 pure-compute POST endpoints, 0 Firestore writes).
//
// The route is mounted at /api/sprint-k in server.ts. All four endpoints are
// POST /:projectId/skills/<sub-path> behind verifyAuth + validate(zodSchema) +
// guard(assertProjectMember). We seed `projects/<id>` in fakeFirestore so
// assertProjectMember passes, then drive every status code: 401 (no token),
// 400 (schema fail — proves the z.unknown bug is fixed), 403 (guard),
// 200 (happy path with exact engine assertions).

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
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import skillGapRouter from '../../server/routes/skillGap.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', skillGapRouter);
  return app;
}

const PROJECT_ID = 'p-skillgap-test';
const CALLER_UID = 'uid-sg-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Skill Gap Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// ── Reusable minimal fixture data ────────────────────────────────────────────

const workerSkill = {
  workerUid: CALLER_UID,
  skillId: 'izaje-basico',
  level: 'competent',
  attainedAt: '2025-01-15T00:00:00.000Z',
};

const requirement = {
  skillId: 'izaje-basico',
  minLevel: 'competent',
  critical: false,
};

const requirementGap = {
  skillId: 'izaje-basico',
  minLevel: 'proficient', // one level above — creates a gap
  critical: true,
};

const gap = {
  workerUid: CALLER_UID,
  skillId: 'izaje-basico',
  currentLevel: 'competent',
  requiredLevel: 'proficient',
  gapLevels: 1,
  critical: true,
};

const skillDef = {
  id: 'izaje-basico',
  name: 'Izaje Básico',
  trainingProgramByLevel: {
    none: { hours: 0 },
    aware: { hours: 4 },
    novice: { hours: 16, provider: 'OTEC-A' },
    competent: { hours: 24, provider: 'OTEC-A' },
    proficient: { hours: 40, provider: 'OTEC-A' },
    expert: { hours: 80, provider: 'OTEC-A' },
  },
  validityMonths: 24,
  category: 'safety',
};

const crewMember = {
  uid: CALLER_UID,
  name: 'Juan Pérez',
  skills: [workerSkill],
};

const crewMemberAlt = {
  uid: 'uid-sg-alt',
  name: 'Ana López',
  skills: [],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/skills/analyze-gaps
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/skills/analyze-gaps', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/skills/analyze-gaps`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ workerSkills: [workerSkill], requirements: [requirement] });
    expect(res.status).toBe(401);
  });

  it('400 when workerSkills is missing — proves z.unknown bug is fixed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ requirements: [requirement] }); // no workerSkills
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when requirements is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ workerSkills: [workerSkill] }); // no requirements
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when workerSkills is not an array (scalar)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ workerSkills: 'bad-scalar', requirements: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ workerSkills: [workerSkill], requirements: [requirement] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-proj/skills/analyze-gaps`)
      .set('x-test-uid', CALLER_UID)
      .send({ workerSkills: [workerSkill], requirements: [requirement] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns empty gaps when worker meets all requirements', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ workerSkills: [workerSkill], requirements: [requirement] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.gaps)).toBe(true);
    expect(res.body.gaps).toHaveLength(0);
  });

  it('200 detects a gap when worker level is below required', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ workerSkills: [workerSkill], requirements: [requirementGap] });
    expect(res.status).toBe(200);
    const { gaps } = res.body as { gaps: typeof gap[] };
    expect(gaps).toHaveLength(1);
    expect(gaps[0].skillId).toBe('izaje-basico');
    expect(gaps[0].gapLevels).toBe(1);
    expect(gaps[0].critical).toBe(true);
    expect(gaps[0].currentLevel).toBe('competent');
    expect(gaps[0].requiredLevel).toBe('proficient');
  });

  it('200 accepts optional now param without breaking computation', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        workerSkills: [workerSkill],
        requirements: [requirementGap],
        now: '2026-01-01T00:00:00.000Z',
      });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.gaps)).toBe(true);
    expect(res.body.gaps).toHaveLength(1);
  });

  it('200 returns empty gaps for empty requirements', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ workerSkills: [workerSkill], requirements: [] });
    expect(res.status).toBe(200);
    expect(res.body.gaps).toEqual([]);
  });

  it('200 detects expired cert as gap even if level meets requirement', async () => {
    const expiredSkill = {
      ...workerSkill,
      expiresAt: '2020-01-01T00:00:00.000Z', // past date
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ workerSkills: [expiredSkill], requirements: [requirement] });
    expect(res.status).toBe(200);
    // expired cert → effective level 'none' → gap vs 'competent'
    const { gaps } = res.body as { gaps: Array<Record<string, unknown>> };
    expect(gaps).toHaveLength(1);
    expect(gaps[0].expired).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/skills/build-training-plan
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/skills/build-training-plan', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/skills/build-training-plan`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ gaps: [gap], skillsCatalog: [skillDef] });
    expect(res.status).toBe(401);
  });

  it('400 when gaps is missing — proves z.unknown bug is fixed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ skillsCatalog: [skillDef] }); // no gaps
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when skillsCatalog is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ gaps: [gap] }); // no skillsCatalog
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when hoursPerWeek exceeds max(40)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ gaps: [], skillsCatalog: [], hoursPerWeek: 41 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ gaps: [gap], skillsCatalog: [skillDef] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 empty gaps → plan with 0 steps', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ gaps: [], skillsCatalog: [] });
    expect(res.status).toBe(200);
    const { plan } = res.body as { plan: { steps: unknown[]; totalHours: number; blockedFromOperation: boolean } };
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps).toHaveLength(0);
    expect(plan.totalHours).toBe(0);
    expect(plan.blockedFromOperation).toBe(false);
  });

  it('200 builds a plan with correct step + hours for a critical gap', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ gaps: [gap], skillsCatalog: [skillDef] });
    expect(res.status).toBe(200);
    const { plan } = res.body as {
      plan: {
        workerUid: string;
        steps: { skillId: string; fromLevel: string; toLevel: string; estimatedHours: number; critical: boolean }[];
        totalHours: number;
        criticalHours: number;
        blockedFromOperation: boolean;
      };
    };
    expect(plan.workerUid).toBe(CALLER_UID);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].skillId).toBe('izaje-basico');
    expect(plan.steps[0].fromLevel).toBe('competent');
    expect(plan.steps[0].toLevel).toBe('proficient');
    // 'proficient' program in skillDef is 40 hours
    expect(plan.steps[0].estimatedHours).toBe(40);
    expect(plan.steps[0].critical).toBe(true);
    expect(plan.totalHours).toBe(40);
    expect(plan.criticalHours).toBe(40);
    expect(plan.blockedFromOperation).toBe(true);
  });

  it('200 hoursPerWeek param changes estimatedCompletionWeeks', async () => {
    const [r8, r20] = await Promise.all([
      request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ gaps: [gap], skillsCatalog: [skillDef], hoursPerWeek: 8 }),
      request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ gaps: [gap], skillsCatalog: [skillDef], hoursPerWeek: 20 }),
    ]);
    expect(r8.status).toBe(200);
    expect(r20.status).toBe(200);
    // 40h / 8 h/week = 5 weeks; 40h / 20 h/week = 2 weeks
    expect(r8.body.plan.estimatedCompletionWeeks).toBe(5);
    expect(r20.body.plan.estimatedCompletionWeeks).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/skills/polyvalence-matrix
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/skills/polyvalence-matrix', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/skills/polyvalence-matrix`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ crew: [crewMember], requiredSkills: [requirement] });
    expect(res.status).toBe(401);
  });

  it('400 when crew is missing — proves z.unknown bug is fixed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ requiredSkills: [requirement] }); // no crew
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when requiredSkills is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [crewMember] }); // no requiredSkills
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ crew: [], requiredSkills: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 empty crew → polyvalenceScore=100, no zeros/singles', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [], requiredSkills: [] });
    expect(res.status).toBe(200);
    const { matrix } = res.body as {
      matrix: { crewSize: number; polyvalenceScore: number; zeroCovered: unknown[]; singleCovered: unknown[] };
    };
    expect(matrix.crewSize).toBe(0);
    expect(matrix.polyvalenceScore).toBe(100);
    expect(matrix.zeroCovered).toEqual([]);
    expect(matrix.singleCovered).toEqual([]);
  });

  it('200 single crew member with one skill covers one requirement → singleCovered', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [crewMember], requiredSkills: [requirement] });
    expect(res.status).toBe(200);
    const { matrix } = res.body as {
      matrix: {
        crewSize: number;
        singleCovered: string[];
        zeroCovered: string[];
        coverageBySkill: Record<string, { count: number; ratio: number }>;
        polyvalenceScore: number;
      };
    };
    expect(matrix.crewSize).toBe(1);
    expect(matrix.singleCovered).toContain('izaje-basico');
    expect(matrix.zeroCovered).toHaveLength(0);
    expect(matrix.coverageBySkill['izaje-basico'].count).toBe(1);
    expect(matrix.coverageBySkill['izaje-basico'].ratio).toBe(1);
    // 1 single-covered → score = 100 - 10 = 90
    expect(matrix.polyvalenceScore).toBe(90);
  });

  it('200 crew of 2 both covering the skill → not in singleCovered', async () => {
    const crewMember2 = { ...crewMemberAlt, skills: [{ ...workerSkill, workerUid: 'uid-sg-alt' }] };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [crewMember, crewMember2], requiredSkills: [requirement] });
    expect(res.status).toBe(200);
    const { matrix } = res.body as {
      matrix: { singleCovered: string[]; zeroCovered: string[]; polyvalenceScore: number };
    };
    expect(matrix.singleCovered).toHaveLength(0);
    expect(matrix.zeroCovered).toHaveLength(0);
    expect(matrix.polyvalenceScore).toBe(100);
  });

  it('200 skill with 0 coverage → zeroCovered + recommendation', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [crewMemberAlt], requiredSkills: [requirement] });
    expect(res.status).toBe(200);
    const { matrix } = res.body as {
      matrix: { zeroCovered: string[]; recommendations: string[]; polyvalenceScore: number };
    };
    expect(matrix.zeroCovered).toContain('izaje-basico');
    // score = 100 - 25 = 75
    expect(matrix.polyvalenceScore).toBe(75);
    expect(matrix.recommendations.length).toBeGreaterThan(0);
    expect(matrix.recommendations[0]).toContain('izaje-basico');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/skills/find-substitutes
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/skills/find-substitutes', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/skills/find-substitutes`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ crew: [], absentUid: 'uid-absent', requirementsForRole: [] });
    expect(res.status).toBe(401);
  });

  it('400 when crew is missing — proves z.unknown bug is fixed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ absentUid: 'uid-absent', requirementsForRole: [requirement] }); // no crew
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when requirementsForRole is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [], absentUid: 'uid-absent' }); // no requirementsForRole
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when absentUid is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [], requirementsForRole: [] }); // no absentUid
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when absentUid exceeds max length (120)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [], absentUid: 'x'.repeat(121), requirementsForRole: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ crew: [], absentUid: 'uid-absent', requirementsForRole: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 empty crew after filtering absent → no candidates', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ crew: [crewMember], absentUid: CALLER_UID, requirementsForRole: [requirement] });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
  });

  it('200 qualified substitute identified with correct coverageScore=1', async () => {
    const crewMember2 = { ...crewMemberAlt, skills: [{ ...workerSkill, workerUid: 'uid-sg-alt' }] };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        crew: [crewMember, crewMember2],
        absentUid: CALLER_UID, // absent = crewMember
        requirementsForRole: [requirement],
      });
    expect(res.status).toBe(200);
    const { candidates } = res.body as {
      candidates: { candidateUid: string; coverageScore: number; canSubstituteSafely: boolean }[];
    };
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidateUid).toBe('uid-sg-alt');
    expect(candidates[0].coverageScore).toBe(1);
    expect(candidates[0].canSubstituteSafely).toBe(true);
  });

  it('200 unqualified substitute has missing skills + canSubstituteSafely=false for critical', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        crew: [crewMember, crewMemberAlt],
        absentUid: CALLER_UID,
        requirementsForRole: [requirementGap], // critical=true, need proficient, alt has nothing
      });
    expect(res.status).toBe(200);
    const { candidates } = res.body as {
      candidates: { candidateUid: string; missingSkills: string[]; canSubstituteSafely: boolean; coverageScore: number }[];
    };
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidateUid).toBe('uid-sg-alt');
    expect(candidates[0].missingSkills).toContain('izaje-basico');
    expect(candidates[0].canSubstituteSafely).toBe(false);
    expect(candidates[0].coverageScore).toBe(0);
  });

  it('200 safe substitutes ranked before unsafe ones', async () => {
    const safeAlt = {
      uid: 'uid-sg-safe',
      name: 'Safe Alt',
      skills: [{ ...workerSkill, workerUid: 'uid-sg-safe', level: 'proficient' }],
    };
    const unsafeAlt = { ...crewMemberAlt };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        crew: [crewMember, safeAlt, unsafeAlt],
        absentUid: CALLER_UID,
        requirementsForRole: [{ ...requirement, critical: true }],
      });
    expect(res.status).toBe(200);
    const { candidates } = res.body as {
      candidates: { candidateUid: string; canSubstituteSafely: boolean }[];
    };
    expect(candidates).toHaveLength(2);
    // safe substitute ranked first
    expect(candidates[0].canSubstituteSafely).toBe(true);
    expect(candidates[0].candidateUid).toBe('uid-sg-safe');
    expect(candidates[1].canSubstituteSafely).toBe(false);
  });
});
