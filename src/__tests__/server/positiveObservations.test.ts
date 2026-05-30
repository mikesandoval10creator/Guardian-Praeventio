// Real-router supertest for src/server/routes/positiveObservations.ts
// (Plan v3 Fase 1 — §214-215 BBS — positive safety observations).
//
// The route is mounted at /api/sprint-k in server.ts. Four endpoints:
//   GET  /:projectId/positive-observations/worker/:workerUid
//   POST /:projectId/positive-observations
//   GET  /:projectId/positive-observations[?period&startAfter]
//   GET  /:projectId/positive-observations/balance[?period]
//
// We seed `projects/<id>` with members[]+createdBy so assertProjectMember
// passes, plus tenantId so resolveTenantId succeeds, then drive every status
// code: 401, 400, 403, 404, 200/201.
//
// DIRECTIVE: positive observations ONLY award non-negative points/XP.
// The route has NO gamification writes — it records cultural observations.
// The computeBalance service is called via dynamic import in the balance
// endpoint — we exercise the REAL service (deterministic, pure function).

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
      role: req.header('x-test-role') || undefined,
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

import positiveObservationsRouter from '../../server/routes/positiveObservations.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ID = 'p-pos-obs-test';
const TENANT_ID = 'tenant-pos-obs-test';
const CALLER_UID = 'uid-pos-obs-member';
const WORKER_UID = 'uid-pos-obs-worker';

// ── App factory ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', positiveObservationsRouter);
  return app;
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedMemberProject(db: NonNullable<typeof H.db>) {
  // assertProjectMember checks members[] OR createdBy
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Test Project',
    tenantId: TENANT_ID,
    members: [CALLER_UID, WORKER_UID],
    createdBy: CALLER_UID,
  });
}

function seedObservation(
  db: NonNullable<typeof H.db>,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const colPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/positive_observations`;
  db._seed(`${colPath}/${id}`, {
    id,
    observedWorkerUid: WORKER_UID,
    observerUid: CALLER_UID,
    observerRole: 'supervisor',
    kind: 'safe_behavior',
    description: 'Worker verified EPP before entering confined space.',
    observedAt: '2026-05-01T10:00:00.000Z',
    location: 'Faena Norte — Pique 3',
    shared: false,
    ...overrides,
  });
}

function seedCorrectiveAction(
  db: NonNullable<typeof H.db>,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const colPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/corrective_actions`;
  db._seed(`${colPath}/${id}`, {
    id,
    dueDate: '2026-05-10T00:00:00.000Z',
    ...overrides,
  });
}

// ── Minimal valid POST body ───────────────────────────────────────────────────

const minValidBody = {
  id: 'obs-001',
  observedWorkerUid: WORKER_UID,
  kind: 'safe_behavior' as const,
  description: 'Worker verified EPP before entering confined space.',
  observedAt: '2026-05-01T10:00:00.000Z',
  location: 'Faena Norte — Pique 3',
};

// ─────────────────────────────────────────────────────────────────────────────
// beforeEach: fresh fakeFirestore
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
  seedMemberProject(H.db);
});

// =============================================================================
// 1. GET /:projectId/positive-observations/worker/:workerUid
// =============================================================================

describe('GET /:projectId/positive-observations/worker/:workerUid', () => {
  const url = (workerUid = WORKER_UID) =>
    `/api/sprint-k/${PROJECT_ID}/positive-observations/worker/${workerUid}`;

  it('401 when no token is provided', async () => {
    const res = await request(buildApp()).get(url());
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when tenantId cannot be resolved (no tenantId on project doc)', async () => {
    // Overwrite project without tenantId and without members sub-collection
    H.db!._seed(`projects/${PROJECT_ID}`, {
      name: 'No-Tenant Project',
      members: [CALLER_UID],
      createdBy: CALLER_UID,
      // tenantId intentionally absent
    });
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 returns empty observations array when worker has none', async () => {
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.observations)).toBe(true);
    expect(res.body.observations).toHaveLength(0);
  });

  it('200 returns seeded observation for the correct worker', async () => {
    seedObservation(H.db!, 'obs-w1', { observedWorkerUid: WORKER_UID });
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.observations).toHaveLength(1);
    expect(res.body.observations[0].id).toBe('obs-w1');
    expect(res.body.observations[0].observedWorkerUid).toBe(WORKER_UID);
  });

  it('200 does NOT return observations for a different worker', async () => {
    seedObservation(H.db!, 'obs-other', { observedWorkerUid: 'other-worker-uid' });
    const res = await request(buildApp())
      .get(url(WORKER_UID))
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.observations).toHaveLength(0);
  });
});

// =============================================================================
// 2. POST /:projectId/positive-observations
// =============================================================================

describe('POST /:projectId/positive-observations', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/positive-observations`;

  it('401 when no token is provided', async () => {
    const res = await request(buildApp()).post(url).send(minValidBody);
    expect(res.status).toBe(401);
  });

  it('400 when id is missing', async () => {
    const { id: _id, ...noId } = minValidBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(noId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when description is too short (< 5 chars)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minValidBody, description: 'No' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when kind is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minValidBody, kind: 'bad_kind' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when observedAt is missing', async () => {
    const { observedAt: _oa, ...noDate } = minValidBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(noDate);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when location is missing', async () => {
    const { location: _loc, ...noLoc } = minValidBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(noLoc);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send(minValidBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('201 creates observation and writes to Firestore', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'supervisor')
      .send(minValidBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    // Verify Firestore side-effect: doc was actually written
    const colPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/positive_observations`;
    const stored = H.db!._dump()[`${colPath}/${minValidBody.id}`];
    expect(stored).toBeDefined();
    expect(stored.observerUid).toBe(CALLER_UID);
    expect(stored.observerRole).toBe('supervisor');
    expect(stored.kind).toBe('safe_behavior');
    // shared defaults to false when omitted
    expect(stored.shared).toBe(false);
  });

  it('201 respects the optional shared flag', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minValidBody, id: 'obs-shared', shared: true });
    expect(res.status).toBe(201);

    const colPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/positive_observations`;
    const stored = H.db!._dump()[`${colPath}/obs-shared`];
    expect(stored.shared).toBe(true);
  });

  it('201 forces observerUid to caller uid (not client-supplied)', async () => {
    // Body cannot override observerUid — route always uses req.user.uid
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minValidBody, id: 'obs-uid-check', observerUid: 'SPOOFED' });
    expect(res.status).toBe(201);

    const colPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/positive_observations`;
    const stored = H.db!._dump()[`${colPath}/obs-uid-check`];
    // observerUid must come from the verified token, never from the body
    expect(stored.observerUid).toBe(CALLER_UID);
    expect(stored.observerUid).not.toBe('SPOOFED');
  });

  it('201 all five valid kind values are accepted', async () => {
    const kinds = [
      'safe_behavior',
      'improvement_idea',
      'helpful_intervention',
      'creative_workaround',
      'mentoring_action',
    ] as const;

    for (const kind of kinds) {
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ ...minValidBody, id: `obs-kind-${kind}`, kind });
      expect(res.status).toBe(201);
    }
  });

  // DIRECTIVE: positive observations NEVER award negative XP. This route has
  // no gamification writes (no awardPoints call). Assert the written document
  // contains no negative numeric fields that could represent XP or points loss.
  it('DIRECTIVE: written observation document contains no negative numeric values (no negative XP)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minValidBody, id: 'obs-xp-check' });
    expect(res.status).toBe(201);

    const colPath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/positive_observations`;
    const stored = H.db!._dump()[`${colPath}/obs-xp-check`];
    for (const value of Object.values(stored)) {
      if (typeof value === 'number') {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// =============================================================================
// 3. GET /:projectId/positive-observations (listing global)
// =============================================================================

describe('GET /:projectId/positive-observations', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/positive-observations`;

  it('401 when no token is provided', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns empty list when no observations exist', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.observations)).toBe(true);
    expect(res.body.observations).toHaveLength(0);
    expect(res.body.period).toBe('30d'); // default period
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.hasMore).toBe(false);
    expect(res.body.pagination.nextStartAfter).toBeNull();
    expect(res.body.pagination.limit).toBe(500);
  });

  it('200 returns seeded observations sorted newest-first (default 30d)', async () => {
    // Seed two observations — one recent, one older
    const recentIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
    const olderIso = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(); // 25 days ago
    seedObservation(H.db!, 'obs-recent', { observedAt: recentIso });
    seedObservation(H.db!, 'obs-older', { observedAt: olderIso });

    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.observations.length).toBeGreaterThanOrEqual(2);
    // Both should appear within 30d
    const ids = (res.body.observations as { id: string }[]).map((o) => o.id);
    expect(ids).toContain('obs-recent');
    expect(ids).toContain('obs-older');
    // Sorted newest-first: obs-recent before obs-older
    expect(ids.indexOf('obs-recent')).toBeLessThan(ids.indexOf('obs-older'));
  });

  it('200 with period=all includes observations older than 30 days', async () => {
    const veryOldIso = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    seedObservation(H.db!, 'obs-old', { observedAt: veryOldIso });

    const res = await request(buildApp())
      .get(`${url}?period=all`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('all');
    const ids = (res.body.observations as { id: string }[]).map((o) => o.id);
    expect(ids).toContain('obs-old');
  });

  it('200 with period=90d accepts 90d query param', async () => {
    const res = await request(buildApp())
      .get(`${url}?period=90d`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('90d');
  });

  it('200 unknown period value defaults to 30d', async () => {
    const res = await request(buildApp())
      .get(`${url}?period=bad_value`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('30d');
  });

  it('200 startAfter with existing doc id paginates correctly', async () => {
    // Seed two docs
    const iso1 = '2026-05-10T10:00:00.000Z';
    const iso2 = '2026-05-05T10:00:00.000Z';
    seedObservation(H.db!, 'obs-page1', { observedAt: iso1 });
    seedObservation(H.db!, 'obs-page2', { observedAt: iso2 });

    // Request with startAfter=obs-page1 (skip the newest)
    const res = await request(buildApp())
      .get(`${url}?period=all&startAfter=obs-page1`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    // obs-page1 is the cursor so it should NOT appear in results
    const ids = (res.body.observations as { id: string }[]).map((o) => o.id);
    expect(ids).not.toContain('obs-page1');
  });

  it('200 startAfter with non-existent doc id still returns results (cursor not found warning)', async () => {
    seedObservation(H.db!, 'obs-some', {});
    const res = await request(buildApp())
      .get(`${url}?period=all&startAfter=nonexistent-cursor-id`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    // Non-existent cursor is ignored: still returns available data
    expect(Array.isArray(res.body.observations)).toBe(true);
  });

  it('200 pagination.hasMore is false when results <= 500', async () => {
    seedObservation(H.db!, 'obs-single', {});
    const res = await request(buildApp())
      .get(`${url}?period=all`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.pagination.hasMore).toBe(false);
    expect(res.body.pagination.nextStartAfter).toBeNull();
  });
});

// =============================================================================
// 4. GET /:projectId/positive-observations/balance
// =============================================================================

describe('GET /:projectId/positive-observations/balance', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/positive-observations/balance`;

  it('401 when no token is provided', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns balance shape with all required fields', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(typeof res.body.positive).toBe('number');
    expect(typeof res.body.corrective).toBe('number');
    expect(typeof res.body.ratio).toBe('number');
    expect(typeof res.body.period).toBe('string');
    expect(typeof res.body.positivePeriod).toBe('string');
    expect(typeof res.body.correctivePeriod).toBe('string');
    expect(typeof res.body.correctivePeriodBasis).toBe('string');
    expect(res.body.balance).toBeDefined();
    expect(typeof res.body.balance.level).toBe('string');
    expect(typeof res.body.balance.message).toBe('string');
  });

  it('200 with no data → positive=0, corrective=0, ratio=0', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.positive).toBe(0);
    expect(res.body.corrective).toBe(0);
    // When both are 0: ratio = positiveCount (0) per the route's formula
    expect(res.body.ratio).toBe(0);
    expect(res.body.balance.level).toBe('imbalanced');
  });

  it('200 with only positive observations → level=positive_skew', async () => {
    // Seed 3 positive observations within the 30d default period
    const recentIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    seedObservation(H.db!, 'obs-bal-1', { observedAt: recentIso });
    seedObservation(H.db!, 'obs-bal-2', { observedAt: recentIso });
    seedObservation(H.db!, 'obs-bal-3', { observedAt: recentIso });

    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.positive).toBe(3);
    expect(res.body.corrective).toBe(0);
    // ratio = positiveCount when correctiveCount = 0
    expect(res.body.ratio).toBe(3);
    // computeBalance: positiveCount=3, correctiveCount=0 → positiveRatio=1 → positive_skew
    expect(res.body.balance.level).toBe('positive_skew');
  });

  it('200 with only corrective actions → level=punitive', async () => {
    const recentDue = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    seedCorrectiveAction(H.db!, 'corr-1', { dueDate: recentDue });

    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.positive).toBe(0);
    expect(res.body.corrective).toBe(1);
    expect(res.body.balance.level).toBe('punitive');
  });

  it('200 balanced ratio (equal positive and corrective) → level=balanced', async () => {
    const recentIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    // 3 positives + 3 correctives → positiveRatio=0.5 → balanced
    seedObservation(H.db!, 'obs-bal-a', { observedAt: recentIso });
    seedObservation(H.db!, 'obs-bal-b', { observedAt: recentIso });
    seedObservation(H.db!, 'obs-bal-c', { observedAt: recentIso });
    seedCorrectiveAction(H.db!, 'corr-a', { dueDate: recentIso });
    seedCorrectiveAction(H.db!, 'corr-b', { dueDate: recentIso });
    seedCorrectiveAction(H.db!, 'corr-c', { dueDate: recentIso });

    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.positive).toBe(3);
    expect(res.body.corrective).toBe(3);
    // positiveRatio = 3/6 = 0.5 → between 0.4 and 0.75 → 'balanced'
    expect(res.body.balance.level).toBe('balanced');
  });

  it('200 accepts period=all query param and reflects it in response', async () => {
    const res = await request(buildApp())
      .get(`${url}?period=all`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('all');
    expect(res.body.positivePeriod).toBe('all');
    // When period=all: correctivePeriodBasis='all'
    expect(res.body.correctivePeriodBasis).toBe('all');
    expect(res.body.correctivePeriod).toBe('all');
  });

  it('200 ratio field is never negative (DIRECTIVE: no negative scoring)', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.ratio).toBeGreaterThanOrEqual(0);
    expect(res.body.positive).toBeGreaterThanOrEqual(0);
    expect(res.body.corrective).toBeGreaterThanOrEqual(0);
    // balance.positiveRatio is computed by computeBalance and must be 0-1
    if (res.body.balance && typeof res.body.balance.positiveRatio === 'number') {
      expect(res.body.balance.positiveRatio).toBeGreaterThanOrEqual(0);
      expect(res.body.balance.positiveRatio).toBeLessThanOrEqual(1);
    }
  });

  it('200 correctivePeriodBasis is dueDate when period is not all', async () => {
    const res = await request(buildApp())
      .get(`${url}?period=30d`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    // When sinceIso is non-null (30d/90d): correctivePeriodBasis starts as 'dueDate'
    expect(res.body.correctivePeriodBasis).toBe('dueDate');
  });
});
