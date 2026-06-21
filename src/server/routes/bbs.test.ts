// Praeventio Guard — bbs router behavioral tests (real router + supertest).
//
// Covers the BBS surface end-to-end against an in-memory Firestore fake:
//   - record-observation: 401 / 400 / 403 / 404 / 201 (+ persists + audit_log)
//   - build-profile:       401 / 400 / 200 (stateless compute)
//   - profile (GET):       401 / 403 / 200 (reads REAL persisted observations,
//                          honest zeroed empty-state)
//
// Anti-blame invariant: observerUid is server-stamped from the verified
// token, never the client. tenantId is server-resolved from the project doc.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore
  > | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@example.com`,
      role: req.header('x-test-role') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import bbsRouter from './bbs.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', bbsRouter);
  return app;
}

const PROJECT_ID = 'p-bbs-test';
const MEMBER_UID = 'uid-bbs-member';
const NON_MEMBER_UID = 'uid-bbs-stranger';
const TENANT_ID = 't-bbs-1';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'BBS Test Project',
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ── record-observation ───────────────────────────────────────────────────

describe('bbsRouter — record-observation (stateful)', () => {
  const path = `/api/sprint-k/${PROJECT_ID}/bbs/record-observation`;
  const goodBody = {
    observationId: 'obs-1',
    areaId: 'frente-norte',
    category: 'epp',
    outcome: 'at_risk',
    note: 'Casco no abrochado en zona de izaje.',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send(goodBody);
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (bad category)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...goodBody, category: 'not-a-category' });
    expect(res.status).toBe(400);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send(goodBody);
    expect(res.status).toBe(403);
  });

  it('404 when the project has no resolvable tenant', async () => {
    // Seed a project the caller belongs to but without a tenantId.
    H.db!._seed('projects/p-no-tenant', {
      name: 'No Tenant',
      members: [MEMBER_UID],
      createdBy: MEMBER_UID,
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p-no-tenant/bbs/record-observation')
      .set('x-test-uid', MEMBER_UID)
      .send(goodBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('201 persists the observation, server-stamps observerUid + tenantId, writes audit_log', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send(goodBody);
    expect(res.status).toBe(201);
    expect(res.body.observation.observerUid).toBe(MEMBER_UID); // server-stamped
    expect(res.body.observation.tenantId).toBe(TENANT_ID); // server-resolved, not client

    const saved = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/bbs_observations`)
      .doc('obs-1')
      .get();
    expect(saved.exists).toBe(true);
    expect(saved.data()!.observerUid).toBe(MEMBER_UID);
    expect(saved.data()!.category).toBe('epp');
    expect(saved.data()!.outcome).toBe('at_risk');

    const audits = await H.db!.collection('audit_logs').get();
    const actions = audits.docs.map((d) => d.data()?.action);
    expect(actions).toContain('bbs.recordObservation');
  });

  it('400 with engine validation code when the note carries PII (RUT)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...goodBody, note: 'Observado a 12.345.678-9 sin casco.' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NOTE_HAS_PII');
  });
});

// ── build-profile ─────────────────────────────────────────────────────────

describe('bbsRouter — build-profile (stateless)', () => {
  const path = `/api/sprint-k/${PROJECT_ID}/bbs/build-profile`;
  const obs = {
    observationId: 'o1',
    tenantId: TENANT_ID,
    areaId: 'a1',
    category: 'epp',
    outcome: 'safe',
    note: 'ok',
    observerUid: 'someone',
    observedAt: '2026-06-15T10:00:00.000Z',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(path).send({
      observations: [],
      windowStart: '2026-06-01T00:00:00.000Z',
      windowEnd: '2026-06-30T00:00:00.000Z',
    });
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (missing window)', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ observations: [] });
    expect(res.status).toBe(400);
  });

  it('200 computes the profile from the supplied observations', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({
        observations: [obs, { ...obs, observationId: 'o2', outcome: 'at_risk' }],
        windowStart: '2026-06-01T00:00:00.000Z',
        windowEnd: '2026-06-30T00:00:00.000Z',
      });
    expect(res.status).toBe(200);
    expect(res.body.profile.totalObservations).toBe(2);
    expect(res.body.profile.safePercentage).toBe(50);
    // tenantId is server-resolved, NOT taken from the client body.
    expect(res.body.profile.tenantId).toBe(TENANT_ID);
  });
});

// ── profile (GET — reads REAL persisted observations) ─────────────────────

describe('bbsRouter — GET profile (stateful, reads real observations)', () => {
  const path = `/api/sprint-k/${PROJECT_ID}/bbs/profile`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`${path}?days=30`);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .get(`${path}?days=30`)
      .set('x-test-uid', NON_MEMBER_UID);
    expect(res.status).toBe(403);
  });

  it('200 returns an honest zeroed profile when there are no observations', async () => {
    const res = await request(buildApp())
      .get(`${path}?days=30`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.profile.totalObservations).toBe(0);
    expect(res.body.profile.safePercentage).toBe(0);
    expect(res.body.profile.topRiskAreas).toEqual([]);
  });

  it('200 computes the profile from REAL persisted observations in the window', async () => {
    const base = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/bbs_observations`;
    const recentIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const staleIso = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    H.db!._seed(`${base}/o1`, {
      observationId: 'o1',
      tenantId: TENANT_ID,
      areaId: 'frente-norte',
      category: 'epp',
      outcome: 'at_risk',
      note: 'casco',
      observerUid: 'someone',
      observedAt: recentIso,
    });
    H.db!._seed(`${base}/o2`, {
      observationId: 'o2',
      tenantId: TENANT_ID,
      areaId: 'frente-norte',
      category: 'epp',
      outcome: 'safe',
      note: 'casco ok',
      observerUid: 'someone',
      observedAt: recentIso,
    });
    // Outside the 30-day window — must be excluded.
    H.db!._seed(`${base}/o3`, {
      observationId: 'o3',
      tenantId: TENANT_ID,
      areaId: 'frente-sur',
      category: 'procedures',
      outcome: 'at_risk',
      note: 'old',
      observerUid: 'someone',
      observedAt: staleIso,
    });

    const res = await request(buildApp())
      .get(`${path}?days=30`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.profile.totalObservations).toBe(2); // o3 excluded
    expect(res.body.profile.safePercentage).toBe(50);
    expect(res.body.profile.byCategory.epp.total).toBe(2);
    expect(res.body.profile.focusCategories).toContain('epp'); // 50% < 70
    expect(res.body.profile.topRiskAreas[0].areaId).toBe('frente-norte');
  });
});
