// Real-router supertest for src/server/routes/apprenticeship.ts
// (§244-250 Aprendices + Mentoría + Autorización Progresiva — Sprint K).
//
// Mounts the ACTUAL router via fakeFirestore. Covers all 5 endpoints:
//   GET  /:projectId/apprentices
//   POST /:projectId/apprentices
//   POST /:projectId/apprentices/:uid/authorize
//   POST /:projectId/apprentices/:uid/expose
//   GET  /:projectId/mentors/availability
//
// authorize endpoint (CLAUDE.md rule #19): the get() of the apprentice + the
// two set()s (authorizations subcollection + parent doc) are now wrapped in
// db.runTransaction(...), so a concurrent authorize+authorize on the same
// apprentice can't race to an inconsistent taskAuthorizations/progress/
// currentLevel. fakeFirestore is single-threaded in-memory (it can't model a
// real race), but the tests below verify the authorize path through the
// transaction — including repeated authorizes accumulating correctly.

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

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import apprenticeshipRouter from '../../server/routes/apprenticeship.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', apprenticeshipRouter);
  return app;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const PROJECT_ID = 'p1';
const TENANT_ID = 't1';
const MENTOR_UID = 'mentor-1';
const WORKER_UID = 'worker-1';

/** Collection path for apprentices under the seeded tenant+project */
const apprenticeCol = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/apprentices`;

function seedProject() {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    name: 'Faena Norte',
    members: [MENTOR_UID, WORKER_UID],
    createdBy: MENTOR_UID,
  });
}

function seedApprentice(uid = WORKER_UID, overrides: Record<string, unknown> = {}) {
  H.db!._seed(`${apprenticeCol}/${uid}`, {
    workerUid: uid,
    mentorUid: MENTOR_UID,
    role: 'aprendiz',
    startDate: '2026-01-10',
    currentLevel: 'none',
    taskAuthorizations: {},
    progress: 0,
    recentExposures: [],
    createdAt: '2026-01-10T08:00:00.000Z',
    createdBy: MENTOR_UID,
    ...overrides,
  });
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  seedProject();
});

// ── GET /:projectId/apprentices ───────────────────────────────────────────────

describe('GET /api/sprint-k/:projectId/apprentices', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`/api/sprint-k/${PROJECT_ID}/apprentices`);
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', 'outsider');
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('404 when the project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { name: 'No Tenant' });
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID);
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_not_found');
  });

  it('200 returns empty list when no apprentices exist', async () => {
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID);
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).apprentices).toEqual([]);
  });

  it('200 returns seeded apprentices with workerUid from doc id', async () => {
    seedApprentice('worker-a');
    seedApprentice('worker-b', { role: 'practicante' });

    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID);
    expect(res.status).toBe(200);
    const body = res.body as { apprentices: Record<string, unknown>[] };
    expect(body.apprentices).toHaveLength(2);
    const uids = body.apprentices.map((a) => a.workerUid);
    expect(uids).toContain('worker-a');
    expect(uids).toContain('worker-b');
  });
});

// ── POST /:projectId/apprentices ──────────────────────────────────────────────

describe('POST /api/sprint-k/:projectId/apprentices', () => {
  const validBody = {
    uid: 'new-worker-1',
    mentorUid: MENTOR_UID,
    role: 'aprendiz',
    startDate: '2026-01-15',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 on missing required field (uid missing)', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID)
      .send({ mentorUid: MENTOR_UID, startDate: '2026-01-15' });
    expect(res.status).toBe(400);
  });

  it('400 on invalid role enum', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID)
      .send({ ...validBody, role: 'invalid_role' });
    expect(res.status).toBe(400);
  });

  it('403 for a non-member caller', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', 'outsider')
      .send(validBody);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('201 registers a new apprentice with correct defaults', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID)
      .send(validBody);
    expect(res.status).toBe(201);
    const body = res.body as { ok: boolean; apprentice: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.apprentice.workerUid).toBe('new-worker-1');
    expect(body.apprentice.currentLevel).toBe('none');
    expect(body.apprentice.progress).toBe(0);
    expect(body.apprentice.taskAuthorizations).toEqual({});
    expect(body.apprentice.createdBy).toBe(MENTOR_UID);

    // Verify persisted to fakeFirestore.
    const stored = (
      await H.db!.collection(apprenticeCol).doc('new-worker-1').get()
    ).data() as Record<string, unknown>;
    expect(stored.mentorUid).toBe(MENTOR_UID);
    expect(stored.role).toBe('aprendiz');
  });

  it('201 succeeds when role is omitted (zod default "aprendiz" flows via req.validated; req.body.role may be undefined but ok is true)', async () => {
    // NOTE: the route reads req.body (not req.validated) so the zod .default('aprendiz')
    // does NOT automatically populate req.body.role. The cleaned payload skips undefined
    // so role is absent in the stored doc — this is an existing behavioural quirk.
    // The test asserts the endpoint returns 201 (not rejected) and ok:true.
    const { role: _r, ...noRole } = validBody;
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID)
      .send(noRole);
    expect(res.status).toBe(201);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it('201 accepts all valid roles', async () => {
    const roles = ['nuevo_ingreso', 'practicante', 'trabajador_general'] as const;
    for (const role of roles) {
      const res = await request(buildApp())
        .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
        .set('x-test-uid', MENTOR_UID)
        .send({ uid: `worker-${role}`, mentorUid: MENTOR_UID, role, startDate: '2026-01-15' });
      expect(res.status).toBe(201);
    }
  });

  it('409 mentor_at_capacity when mentor already has 3 different apprentices', async () => {
    // Seed 3 apprentices all under MENTOR_UID.
    seedApprentice('w-cap-1');
    seedApprentice('w-cap-2');
    seedApprentice('w-cap-3');

    // Try to add a 4th (different uid).
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID)
      .send({ uid: 'w-cap-4', mentorUid: MENTOR_UID, role: 'aprendiz', startDate: '2026-01-15' });
    expect(res.status).toBe(409);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('mentor_at_capacity');
    expect(body.mentorUid).toBe(MENTOR_UID);
    expect(body.currentLoad).toBe(3);
  });

  it('201 allows re-registering an already-assigned apprentice even at cap', async () => {
    // Mentor has 3 apprentices; one of them is being re-registered (merge).
    seedApprentice('w-cap-1');
    seedApprentice('w-cap-2');
    seedApprentice(WORKER_UID);

    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID)
      .send({ uid: WORKER_UID, mentorUid: MENTOR_UID, role: 'practicante', startDate: '2026-02-01' });
    expect(res.status).toBe(201);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it('500 (fail-closed) when the mentor-load read fails — never silently skips the cap', async () => {
    // A transient Firestore error on the load read must NOT fall through to a
    // successful registration (that would bypass the 3-mentee cap). It must
    // 500, and the apprentice doc must NOT be written.
    H.db!._failReads(apprenticeCol);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices`)
      .set('x-test-uid', MENTOR_UID)
      .send({ uid: 'w-readfail', mentorUid: MENTOR_UID, role: 'aprendiz', startDate: '2026-01-15' });
    expect(res.status).toBe(500);
    expect(H.db!._dump()[`${apprenticeCol}/w-readfail`]).toBeUndefined();
  });
});

// ── POST /:projectId/apprentices/:uid/authorize ───────────────────────────────

describe('POST /api/sprint-k/:projectId/apprentices/:uid/authorize', () => {
  const authBody = {
    taskKind: 'operacion_grua',
    toLevel: 'supervised' as const,
    signedByUid: MENTOR_UID,
    evidence: 'Evaluación práctica superada con nota 6.0',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .send(authBody);
    expect(res.status).toBe(401);
  });

  it('400 on missing required field (evidence missing)', async () => {
    seedApprentice();
    const { evidence: _, ...noEvidence } = authBody;
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send(noEvidence);
    expect(res.status).toBe(400);
  });

  it('400 on invalid toLevel enum', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send({ ...authBody, toLevel: 'none' }); // 'none' is not in the schema
    expect(res.status).toBe(400);
  });

  it('403 for a non-member caller', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', 'outsider')
      .send(authBody);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('404 when the apprentice doc does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/nonexistent/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send(authBody);
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('apprentice_not_found');
  });

  it('403 signer_not_assigned_mentor when signedByUid does not match stored mentorUid', async () => {
    seedApprentice(); // mentorUid = MENTOR_UID
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send({ ...authBody, signedByUid: 'other-mentor' });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('signer_not_assigned_mentor');
  });

  it('200 authorizes a task and updates progress + currentLevel', async () => {
    seedApprentice();

    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send(authBody);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.workerUid).toBe(WORKER_UID);
    expect(body.taskKind).toBe('operacion_grua');
    expect(body.toLevel).toBe('supervised');
    expect(body.currentLevel).toBe('supervised');
    expect(typeof body.progress).toBe('number');
    expect(body.progress).toBeGreaterThanOrEqual(0);
    expect(body.progress).toBeLessThanOrEqual(100);

    // Verify parent doc updated.
    const stored = (
      await H.db!.collection(apprenticeCol).doc(WORKER_UID).get()
    ).data() as Record<string, unknown>;
    expect((stored.taskAuthorizations as Record<string, string>).operacion_grua).toBe('supervised');
    expect(stored.currentLevel).toBe('supervised');

    // Verify authorization subcollection written.
    const authSnap = await H.db!
      .collection(`${apprenticeCol}/${WORKER_UID}/authorizations`)
      .get();
    expect(authSnap.size).toBe(1);
    const authDoc = authSnap.docs[0].data() as Record<string, unknown>;
    expect(authDoc.taskKind).toBe('operacion_grua');
    expect(authDoc.toLevel).toBe('supervised');
    expect(authDoc.signedByUid).toBe(MENTOR_UID);
    expect(authDoc.evidence).toBe('Evaluación práctica superada con nota 6.0');
    expect(authDoc.recordedBy).toBe(MENTOR_UID);
  });

  it('200 currentLevel is the MAX across all authorizations (not the latest)', async () => {
    // Seed an apprentice already at autonomous for one task.
    seedApprentice(WORKER_UID, {
      taskAuthorizations: { operacion_explosivos: 'autonomous' },
      currentLevel: 'autonomous',
      progress: 20,
    });

    // Authorize a NEW task at observer (lower level).
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send({ ...authBody, taskKind: 'uso_epp_basico', toLevel: 'observer', signedByUid: MENTOR_UID });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    // Codex P2 fix: currentLevel must remain 'autonomous', not regress.
    expect(body.currentLevel).toBe('autonomous');
  });

  it('200 a second authorize accumulates atomically through the transaction', async () => {
    seedApprentice();
    // First authorize: task A → supervised.
    const r1 = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send({ ...authBody, taskKind: 'operacion_grua', toLevel: 'supervised' });
    expect(r1.status).toBe(200);
    // Second authorize (different task) → autonomous. The transaction reads the
    // post-first state, so both authorizations accumulate (no lost update) and
    // currentLevel is the max of the two.
    const r2 = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send({ ...authBody, taskKind: 'izaje_cargas', toLevel: 'autonomous' });
    expect(r2.status).toBe(200);
    expect((r2.body as Record<string, unknown>).currentLevel).toBe('autonomous');
    // Parent doc reflects BOTH authorizations.
    const stored = (
      await H.db!.collection(apprenticeCol).doc(WORKER_UID).get()
    ).data() as Record<string, unknown>;
    const auths = stored.taskAuthorizations as Record<string, string>;
    expect(auths.operacion_grua).toBe('supervised');
    expect(auths.izaje_cargas).toBe('autonomous');
    expect(stored.currentLevel).toBe('autonomous');
    // One authorization subdoc was written per call.
    const authSnap = await H.db!
      .collection(`${apprenticeCol}/${WORKER_UID}/authorizations`)
      .get();
    expect(authSnap.size).toBe(2);
  });

  it('200 progress caps at 100 with ≥5 supervised/autonomous tasks', async () => {
    seedApprentice(WORKER_UID, {
      taskAuthorizations: {
        task1: 'autonomous',
        task2: 'supervised',
        task3: 'autonomous',
        task4: 'supervised',
      },
      currentLevel: 'autonomous',
      progress: 80,
    });

    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/authorize`)
      .set('x-test-uid', MENTOR_UID)
      .send({ ...authBody, taskKind: 'task5', toLevel: 'autonomous' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).progress).toBe(100);
  });
});

// ── POST /:projectId/apprentices/:uid/expose ──────────────────────────────────

describe('POST /api/sprint-k/:projectId/apprentices/:uid/expose', () => {
  const exposeBody = {
    taskKind: 'instalacion_andamios',
    supervisedBy: MENTOR_UID,
    outcome: 'success' as const,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/expose`)
      .send(exposeBody);
    expect(res.status).toBe(401);
  });

  it('400 on missing required field (taskKind missing)', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/expose`)
      .set('x-test-uid', MENTOR_UID)
      .send({ supervisedBy: MENTOR_UID, outcome: 'success' });
    expect(res.status).toBe(400);
  });

  it('400 on invalid outcome enum', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/expose`)
      .set('x-test-uid', MENTOR_UID)
      .send({ ...exposeBody, outcome: 'perfect' });
    expect(res.status).toBe(400);
  });

  it('403 for a non-member caller', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/expose`)
      .set('x-test-uid', 'outsider')
      .send(exposeBody);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('404 when the apprentice doc does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/ghost/expose`)
      .set('x-test-uid', MENTOR_UID)
      .send(exposeBody);
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('apprentice_not_found');
  });

  it('201 records exposure and writes to subcollection', async () => {
    seedApprentice();

    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/expose`)
      .set('x-test-uid', MENTOR_UID)
      .send(exposeBody);
    expect(res.status).toBe(201);
    const body = res.body as { ok: boolean; exposure: Record<string, unknown> };
    expect(body.ok).toBe(true);
    const exp = body.exposure;
    expect(exp.workerUid).toBe(WORKER_UID);
    expect(exp.taskKind).toBe('instalacion_andamios');
    expect(exp.supervisedBy).toBe(MENTOR_UID);
    expect(exp.outcome).toBe('success');
    expect(typeof exp.id).toBe('string');
    expect(exp.id).toMatch(/^exp_\d+_/);
    expect(exp.createdBy).toBe(MENTOR_UID);

    // Verify exposure subcollection written.
    const expSnap = await H.db!
      .collection(`${apprenticeCol}/${WORKER_UID}/exposures`)
      .get();
    expect(expSnap.size).toBe(1);
    const stored = expSnap.docs[0].data() as Record<string, unknown>;
    expect(stored.outcome).toBe('success');
    expect(stored.taskKind).toBe('instalacion_andamios');

    // Verify parent doc touched (updatedAt stamped).
    const parent = (
      await H.db!.collection(apprenticeCol).doc(WORKER_UID).get()
    ).data() as Record<string, unknown>;
    expect(typeof parent.updatedAt).toBe('string');
  });

  it('201 accepts all valid outcome values', async () => {
    const outcomes = ['partial', 'unsafe'] as const;
    for (const outcome of outcomes) {
      seedApprentice(`worker-${outcome}`);
      const res = await request(buildApp())
        .post(`/api/sprint-k/${PROJECT_ID}/apprentices/worker-${outcome}/expose`)
        .set('x-test-uid', MENTOR_UID)
        .send({ ...exposeBody, outcome });
      expect(res.status).toBe(201);
    }
  });

  it('201 accepts optional fields (recordedAt + notes)', async () => {
    seedApprentice();
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/expose`)
      .set('x-test-uid', MENTOR_UID)
      .send({
        ...exposeBody,
        recordedAt: '2026-01-20T09:00:00.000Z',
        notes: 'Completó el procedimiento sin asistencia.',
      });
    expect(res.status).toBe(201);
    const body = res.body as { exposure: Record<string, unknown> };
    expect(body.exposure.recordedAt).toBe('2026-01-20T09:00:00.000Z');
    expect(body.exposure.notes).toBe('Completó el procedimiento sin asistencia.');
  });

  it('201 uses server-side recordedAt when not provided in body', async () => {
    seedApprentice();
    const before = Date.now();
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/apprentices/${WORKER_UID}/expose`)
      .set('x-test-uid', MENTOR_UID)
      .send(exposeBody);
    const after = Date.now();
    expect(res.status).toBe(201);
    const recordedAt = new Date((res.body as { exposure: Record<string, unknown> }).exposure.recordedAt as string).getTime();
    expect(recordedAt).toBeGreaterThanOrEqual(before);
    expect(recordedAt).toBeLessThanOrEqual(after);
  });
});

// ── GET /:projectId/mentors/availability ──────────────────────────────────────

describe('GET /api/sprint-k/:projectId/mentors/availability', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get(
      `/api/sprint-k/${PROJECT_ID}/mentors/availability`,
    );
    expect(res.status).toBe(401);
  });

  it('403 for a non-member caller', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/mentors/availability`)
      .set('x-test-uid', 'outsider');
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('404 when the project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { name: 'No Tenant' });
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/mentors/availability`)
      .set('x-test-uid', MENTOR_UID);
    expect(res.status).toBe(404);
  });

  it('200 returns empty mentors list when no apprentices exist', async () => {
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/mentors/availability`)
      .set('x-test-uid', MENTOR_UID);
    expect(res.status).toBe(200);
    const body = res.body as { mentors: unknown[]; maxLoad: number };
    expect(body.mentors).toEqual([]);
    expect(body.maxLoad).toBe(3);
  });

  it('500 (fail-closed) when the apprentices read fails — does not fabricate "all available"', async () => {
    // A read error must surface as 500, not a fabricated empty list that would
    // report every mentor as available (load 0) and invite over-the-cap assigns.
    H.db!._failReads(apprenticeCol);
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/mentors/availability`)
      .set('x-test-uid', MENTOR_UID);
    expect(res.status).toBe(500);
  });

  it('200 returns availability sorted: available first, then by load ascending', async () => {
    // mentor-a has 2 apprentices (available, slots=1)
    seedApprentice('w-a1', { mentorUid: 'mentor-a' });
    seedApprentice('w-a2', { mentorUid: 'mentor-a' });
    // mentor-b has 3 apprentices (at capacity)
    seedApprentice('w-b1', { mentorUid: 'mentor-b' });
    seedApprentice('w-b2', { mentorUid: 'mentor-b' });
    seedApprentice('w-b3', { mentorUid: 'mentor-b' });
    // mentor-c has 1 apprentice (available, slots=2)
    seedApprentice('w-c1', { mentorUid: 'mentor-c' });

    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/mentors/availability`)
      .set('x-test-uid', MENTOR_UID);
    expect(res.status).toBe(200);
    const body = res.body as {
      mentors: Array<{
        mentorUid: string;
        currentLoad: number;
        maxLoad: number;
        available: boolean;
        availableSlots: number;
        apprenticeUids: string[];
      }>;
      maxLoad: number;
    };

    expect(body.maxLoad).toBe(3);
    const mentors = body.mentors;
    expect(mentors).toHaveLength(3);

    // Available mentors come first.
    const availableOnes = mentors.filter((m) => m.available);
    const atCapacity = mentors.filter((m) => !m.available);
    expect(availableOnes).toHaveLength(2);
    expect(atCapacity).toHaveLength(1);
    expect(atCapacity[0].mentorUid).toBe('mentor-b');

    // Among available: sorted by load ascending (mentor-c load=1 before mentor-a load=2).
    expect(availableOnes[0].currentLoad).toBeLessThanOrEqual(availableOnes[1].currentLoad);
    expect(availableOnes[0].mentorUid).toBe('mentor-c');
    expect(availableOnes[1].mentorUid).toBe('mentor-a');

    // Field shapes.
    for (const m of mentors) {
      expect(typeof m.mentorUid).toBe('string');
      expect(Array.isArray(m.apprenticeUids)).toBe(true);
      expect(typeof m.currentLoad).toBe('number');
      expect(m.maxLoad).toBe(3);
      expect(typeof m.available).toBe('boolean');
      expect(typeof m.availableSlots).toBe('number');
      expect(m.availableSlots).toBe(Math.max(0, 3 - m.currentLoad));
    }
  });

  it('200 correctly marks a mentor at exactly 3 as not available (slots=0)', async () => {
    seedApprentice('w1', { mentorUid: 'mentor-full' });
    seedApprentice('w2', { mentorUid: 'mentor-full' });
    seedApprentice('w3', { mentorUid: 'mentor-full' });

    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/mentors/availability`)
      .set('x-test-uid', MENTOR_UID);
    expect(res.status).toBe(200);
    const body = res.body as {
      mentors: Array<{ mentorUid: string; available: boolean; availableSlots: number; currentLoad: number }>;
    };
    const mentor = body.mentors.find((m) => m.mentorUid === 'mentor-full');
    expect(mentor).toBeDefined();
    expect(mentor!.available).toBe(false);
    expect(mentor!.availableSlots).toBe(0);
    expect(mentor!.currentLoad).toBe(3);
  });
});
