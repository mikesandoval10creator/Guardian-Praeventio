// Real-router supertest for the Wisdom Capsule endpoints.
// Covers all 3 routes (GET /stats, GET /today, POST /ack) — auth, validation,
// happy paths, 403, 400, cache/idempotency, and Firestore side-effects.
// Zettelkasten nodes written internally are verified to STAY inside Firestore
// (never returned to the caller) and to remain scoped to the tenant/project.
//
// Mounts REAL wisdomCapsuleRouter under /api (same prefix as server.ts L855).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ---- vi.hoisted + firebase-admin mock (must be first) ----------------------
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ---- Other module mocks (verifyAuth, logger, observability, GoogleGenAI) ---
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized: No token provided' });
      return;
    }
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

// Mock @google/genai — always return the fallback path (no GEMINI_API_KEY
// in the test env, so the real code short-circuits before constructing
// GoogleGenAI; but we mock it defensively in case env leaks).
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: null }),
    },
  })),
}));

// assertProjectMember: default pass-through; individual tests can override.
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

// ---- Imports (after mocks) --------------------------------------------------
import wisdomCapsuleRouter, { _clearCapsuleStatsCacheForTests } from '../../server/routes/wisdomCapsule.js';
import { createFakeFirestore } from '../helpers/fakeFirestore.js';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

// ---- App factory -----------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', wisdomCapsuleRouter);
  return app;
}

const TODAY = '/api/wisdom-capsule/today';
const ACK = '/api/wisdom-capsule/ack';
const STATS = '/api/wisdom-capsule/stats';

const PROJECT_ID = 'proj-alpha';
const DATE = '2026-05-29';
const CAP_DOC = `${PROJECT_ID}_${DATE}`;

// ---- Helpers ---------------------------------------------------------------
function seedProject(over: Record<string, unknown> = {}) {
  H.db!._seed(`projects/${PROJECT_ID}`, { members: ['uid-member'], createdBy: 'uid-owner', ...over });
}

function seedCapsule(over: Record<string, unknown> = {}) {
  H.db!._seed(`wisdom_capsules/${CAP_DOC}`, {
    projectId: PROJECT_ID,
    date: DATE,
    capsule: {
      title: `Cápsula de Sabiduría — ${DATE}`,
      body: 'Día tranquilo en obra.',
      durationSeconds: 30,
      sourceNodes: [],
      xpReward: 5,
    },
    ackedBy: [],
    ...over,
  });
}

// ---- beforeEach/afterEach --------------------------------------------------
beforeEach(() => {
  H.db = createFakeFirestore();
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  _clearCapsuleStatsCacheForTests();
  // Ensure no GEMINI_API_KEY leaks from a real env
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  _clearCapsuleStatsCacheForTests();
});

// ===========================================================================
// GET /api/wisdom-capsule/today
// ===========================================================================
describe('GET /wisdom-capsule/today', () => {
  it('401 when no Authorization token is supplied', async () => {
    const res = await request(buildApp()).get(TODAY).query({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(401);
  });

  it('400 when projectId is missing', async () => {
    const res = await request(buildApp()).get(TODAY).set('x-test-uid', 'uid-member').query({ date: DATE });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it('400 when date format is invalid', async () => {
    const res = await request(buildApp())
      .get(TODAY)
      .set('x-test-uid', 'uid-member')
      .query({ projectId: PROJECT_ID, date: '29-05-2026' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .get(TODAY)
      .set('x-test-uid', 'uid-stranger')
      .query({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns cached capsule when Firestore doc already exists (cached: true)', async () => {
    seedProject();
    seedCapsule();
    const res = await request(buildApp())
      .get(TODAY)
      .set('x-test-uid', 'uid-member')
      .query({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cached).toBe(true);
    expect(res.body.capsule).toBeDefined();
    expect(res.body.capsule.body).toContain('Día tranquilo');
    // xpReward from seeded doc
    expect(res.body.capsule.xpReward).toBe(5);
  });

  it('200 computes fresh capsule (no cache) with local fallback (cached: false)', async () => {
    seedProject();
    // Seed some hallazgos for yesterday relative to DATE (2026-05-28)
    H.db!._seed('hallazgos/h1', {
      projectId: PROJECT_ID, date: '2026-05-28',
      title: 'Riesgo eléctrico tablero', description: 'Tablero sin tapa',
    });
    const res = await request(buildApp())
      .get(TODAY)
      .set('x-test-uid', 'uid-member')
      .query({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cached).toBe(false);
    expect(res.body.capsule).toBeDefined();
    expect(typeof res.body.capsule.body).toBe('string');
    expect(res.body.capsule.xpReward).toBe(5);
  });

  it('fresh capsule persists to Firestore (wisdom_capsules doc created)', async () => {
    seedProject();
    await request(buildApp())
      .get(TODAY)
      .set('x-test-uid', 'uid-member')
      .query({ projectId: PROJECT_ID, date: DATE });
    const snap = await H.db!.collection('wisdom_capsules').doc(CAP_DOC).get();
    expect(snap.exists).toBe(true);
    const data = snap.data() as Record<string, unknown>;
    expect(data.projectId).toBe(PROJECT_ID);
    expect(data.date).toBe(DATE);
    expect((data.capsule as Record<string, unknown>).body).toBeTruthy();
    // ackedBy starts empty
    expect(data.ackedBy).toEqual([]);
  });

  it('fresh capsule emits a zettelkasten_nodes safety-learning node (internal only)', async () => {
    seedProject();
    H.db!._seed('hallazgos/h2', {
      projectId: PROJECT_ID, date: '2026-05-28',
      title: 'Caída de altura', description: 'Sin arnés',
    });
    const res = await request(buildApp())
      .get(TODAY)
      .set('x-test-uid', 'uid-member')
      .query({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(200);

    // INTERNAL: The Zettelkasten node must be written to Firestore internally…
    const zkId = `safety-learning_${PROJECT_ID}_${DATE}`;
    const zkSnap = await H.db!.collection('zettelkasten_nodes').doc(zkId).get();
    expect(zkSnap.exists).toBe(true);
    const zk = zkSnap.data() as Record<string, unknown>;
    expect(zk.type).toBe('safety-learning');
    expect(zk.projectId).toBe(PROJECT_ID);
    // …but the Zettelkasten node MUST NOT be surfaced in the HTTP response.
    expect(JSON.stringify(res.body)).not.toContain('zettelkasten');
    expect(JSON.stringify(res.body)).not.toContain('safety-learning_');
    // Raw internal node ID must never be exposed to the API consumer.
    expect(JSON.stringify(res.body)).not.toContain(zkId);
  });

  it('Zettelkasten node is scoped to the project — does NOT contain other project data', async () => {
    seedProject();
    // Seed a different project's doc — should not bleed into this call
    H.db!._seed(`projects/proj-other`, { members: ['uid-other'] });
    H.db!._seed('hallazgos/h-other', {
      projectId: 'proj-other', date: '2026-05-28', title: 'Foreign finding',
    });
    await request(buildApp())
      .get(TODAY)
      .set('x-test-uid', 'uid-member')
      .query({ projectId: PROJECT_ID, date: DATE });
    const zkId = `safety-learning_${PROJECT_ID}_${DATE}`;
    const zkSnap = await H.db!.collection('zettelkasten_nodes').doc(zkId).get();
    const zk = zkSnap.data() as Record<string, unknown>;
    // The node for proj-alpha must NOT reference the other project
    expect(JSON.stringify(zk)).not.toContain('proj-other');
    expect(JSON.stringify(zk)).not.toContain('Foreign finding');
  });
});

// ===========================================================================
// POST /api/wisdom-capsule/ack
// ===========================================================================
describe('POST /wisdom-capsule/ack', () => {
  it('401 when no Authorization token is supplied', async () => {
    const res = await request(buildApp()).post(ACK).send({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(401);
  });

  it('400 when projectId is missing', async () => {
    const res = await request(buildApp())
      .post(ACK)
      .set('x-test-uid', 'uid-member')
      .send({ date: DATE });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it('400 when date format is invalid', async () => {
    const res = await request(buildApp())
      .post(ACK)
      .set('x-test-uid', 'uid-member')
      .send({ projectId: PROJECT_ID, date: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .post(ACK)
      .set('x-test-uid', 'uid-stranger')
      .send({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 awards 5 XP on first ack and adds uid to ackedBy', async () => {
    seedProject();
    seedCapsule({ ackedBy: [] });
    const res = await request(buildApp())
      .post(ACK)
      .set('x-test-uid', 'uid-member')
      .send({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.xpAwarded).toBe(5);
    expect(res.body.reason).toBe('wisdom_capsule_completed');

    // Verify Firestore side-effect: uid is in ackedBy
    const snap = await H.db!.collection('wisdom_capsules').doc(CAP_DOC).get();
    const data = snap.data() as Record<string, unknown>;
    expect((data.ackedBy as string[])).toContain('uid-member');
  });

  it('200 awards 0 XP (idempotent) when uid already acked', async () => {
    seedProject();
    seedCapsule({ ackedBy: ['uid-member'] });
    const res = await request(buildApp())
      .post(ACK)
      .set('x-test-uid', 'uid-member')
      .send({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(200);
    expect(res.body.xpAwarded).toBe(0);
  });

  it('200 creates capsule doc when none exists yet (ack before GET /today)', async () => {
    seedProject();
    // No capsule pre-seeded — the ack endpoint should still write
    const res = await request(buildApp())
      .post(ACK)
      .set('x-test-uid', 'uid-member')
      .send({ projectId: PROJECT_ID, date: DATE });
    expect(res.status).toBe(200);
    expect(res.body.xpAwarded).toBe(5);
    const snap = await H.db!.collection('wisdom_capsules').doc(CAP_DOC).get();
    expect(snap.exists).toBe(true);
    const data = snap.data() as Record<string, unknown>;
    expect((data.ackedBy as string[])).toContain('uid-member');
  });

  it('two different users can both ack independently', async () => {
    seedProject({ members: ['uid-alpha', 'uid-beta'] });
    seedCapsule({ ackedBy: [] });
    await request(buildApp()).post(ACK).set('x-test-uid', 'uid-alpha').send({ projectId: PROJECT_ID, date: DATE });
    await request(buildApp()).post(ACK).set('x-test-uid', 'uid-beta').send({ projectId: PROJECT_ID, date: DATE });
    const snap = await H.db!.collection('wisdom_capsules').doc(CAP_DOC).get();
    const ackedBy = (snap.data() as Record<string, unknown>).ackedBy as string[];
    expect(ackedBy).toContain('uid-alpha');
    expect(ackedBy).toContain('uid-beta');
  });
});

// ===========================================================================
// GET /api/wisdom-capsule/stats
// ===========================================================================
describe('GET /wisdom-capsule/stats', () => {
  const DATE_FROM = '2026-05-01';
  const DATE_TO = '2026-05-29';

  function statsUrl(params: Record<string, string>) {
    const q = new URLSearchParams(params).toString();
    return `${STATS}?${q}`;
  }

  it('401 when no Authorization token is supplied', async () => {
    const res = await request(buildApp()).get(
      statsUrl({ projectId: PROJECT_ID, dateFrom: DATE_FROM, dateTo: DATE_TO }),
    );
    expect(res.status).toBe(401);
  });

  it('400 when projectId is missing', async () => {
    const res = await request(buildApp())
      .get(statsUrl({ dateFrom: DATE_FROM, dateTo: DATE_TO }))
      .set('x-test-uid', 'uid-member');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it('400 when dateFrom is not YYYY-MM-DD', async () => {
    const res = await request(buildApp())
      .get(statsUrl({ projectId: PROJECT_ID, dateFrom: '01-05-2026', dateTo: DATE_TO }))
      .set('x-test-uid', 'uid-member');
    expect(res.status).toBe(400);
  });

  it('400 when dateFrom > dateTo', async () => {
    const res = await request(buildApp())
      .get(statsUrl({ projectId: PROJECT_ID, dateFrom: DATE_TO, dateTo: DATE_FROM }))
      .set('x-test-uid', 'uid-member');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dateFrom/i);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .get(statsUrl({ projectId: PROJECT_ID, dateFrom: DATE_FROM, dateTo: DATE_TO }))
      .set('x-test-uid', 'uid-stranger');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns byDate series + topCrew from seeded capsules', async () => {
    seedProject({ members: ['uid-a', 'uid-b'] });
    // Two capsule docs with acks
    H.db!._seed(`wisdom_capsules/${PROJECT_ID}_2026-05-10`, {
      projectId: PROJECT_ID, date: '2026-05-10', ackedBy: ['uid-a', 'uid-b'],
    });
    H.db!._seed(`wisdom_capsules/${PROJECT_ID}_2026-05-11`, {
      projectId: PROJECT_ID, date: '2026-05-11', ackedBy: ['uid-a'],
    });
    // One crew whose members are uid-a + uid-b
    H.db!._seed('crews/crew-1', { projectId: PROJECT_ID, name: 'Cuadrilla Norte', memberUids: ['uid-a', 'uid-b'] });

    const res = await request(buildApp())
      .get(statsUrl({ projectId: PROJECT_ID, dateFrom: '2026-05-01', dateTo: '2026-05-29' }))
      .set('x-test-uid', 'uid-a');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.byDate)).toBe(true);
    expect(res.body.byDate.length).toBe(2);
    // Row for 2026-05-10 should have ackedCount = 2
    const row10 = res.body.byDate.find((r: { date: string }) => r.date === '2026-05-10');
    expect(row10).toBeDefined();
    expect(row10.ackedCount).toBe(2);
    expect(row10.ackRate).toBe(1); // 2/2 = 1
    // Top crew should be Cuadrilla Norte (highest total acks)
    expect(res.body.topCrew).toBe('Cuadrilla Norte');
    expect(res.body.cached).toBe(false);
  });

  it('200 returns empty byDate + null topCrew when no capsules exist', async () => {
    seedProject({ members: ['uid-a'] });
    const res = await request(buildApp())
      .get(statsUrl({ projectId: PROJECT_ID, dateFrom: DATE_FROM, dateTo: DATE_TO }))
      .set('x-test-uid', 'uid-a');
    expect(res.status).toBe(200);
    expect(res.body.byDate).toEqual([]);
    expect(res.body.topCrew).toBeNull();
  });

  it('200 second call hits in-memory cache (cached: true)', async () => {
    seedProject({ members: ['uid-a'] });
    const params = { projectId: PROJECT_ID, dateFrom: DATE_FROM, dateTo: DATE_TO };
    const app = buildApp();
    await request(app).get(statsUrl(params)).set('x-test-uid', 'uid-a');
    const res2 = await request(app).get(statsUrl(params)).set('x-test-uid', 'uid-a');
    expect(res2.status).toBe(200);
    expect(res2.body.cached).toBe(true);
  });

  it('stats response NEVER exposes raw zettelkasten_nodes or internal graph IDs', async () => {
    seedProject({ members: ['uid-a'] });
    // Seed an internal ZK node that should never surface
    H.db!._seed(`zettelkasten_nodes/safety-learning_${PROJECT_ID}_${DATE}`, {
      type: 'safety-learning', projectId: PROJECT_ID, date: DATE,
      title: 'Internal ZK', description: 'Should be invisible',
    });
    const res = await request(buildApp())
      .get(statsUrl({ projectId: PROJECT_ID, dateFrom: DATE_FROM, dateTo: DATE_TO }))
      .set('x-test-uid', 'uid-a');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('zettelkasten');
    expect(body).not.toContain('safety-learning_');
    expect(body).not.toContain('Internal ZK');
  });
});
