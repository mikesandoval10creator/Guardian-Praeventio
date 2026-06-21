// Real-router supertest for the Behavior-Based Safety (BBS) HTTP surface
// (src/server/routes/bbs.ts). Two stateless POST endpoints over the pure
// engine in src/services/behaviorObservation/bbsObservationEngine.ts:
//
//   POST /:projectId/bbs/record-observation → { observation }
//   POST /:projectId/bbs/build-profile      → { profile }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the
// project (never by mocking the gate). verifyAuth + logger + observability
// are mocked; the engine itself runs UNMOCKED so every 200 asserts real
// aggregation output (re-derived here, never copied from the handler).
//
// Life-safety note: BBS is anti-blaming — observerUid + tenantId are
// server-controlled. These tests pin that the server forces observerUid =
// caller uid and tenantId = path projectId (a client-claimed body.tenantId
// in build-profile is structurally ignored), and that the engine's own
// PII/anti-blame guard (NOTE_HAS_PII) and window/tenant filtering survive
// the HTTP layer.

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

import bbsRouter from '../../server/routes/bbs.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  buildProfile,
  type BbsObservation,
} from '../../services/behaviorObservation/bbsObservationEngine.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', bbsRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  // record-observation/build-profile are now STATEFUL (persist to
  // tenants/{tenantId}/projects/{projectId}/bbs_observations); the handler
  // resolves tenantId from the project doc, so seed it (else 404 tenant_not_found).
  // Seed tenantId === projectId so the existing assertions (tenantId:'p1') hold.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner', tenantId: 'p1' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner', tenantId: 'p2' });
});

// ────────────────────────────────────────────────────────────────────────
// record-observation
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/bbs/record-observation', () => {
  const url = '/api/p1/bbs/record-observation';
  const validBody = {
    observationId: 'obs-1',
    areaId: 'area-norte',
    category: 'epp',
    outcome: 'at_risk',
    note: 'Trabajador sin casco en zona de izaje',
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(validBody);
    expect(res.status).toBe(401);
  });

  it('200 returns the observation with server-stamped observer + tenant', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(validBody);
    // record-observation now PERSISTS (stateful) → 201 Created.
    expect(res.status).toBe(201);
    expect(res.body.observation).toMatchObject({
      observationId: 'obs-1',
      // tenantId is server-controlled: forced from the path projectId.
      tenantId: 'p1',
      areaId: 'area-norte',
      category: 'epp',
      outcome: 'at_risk',
      note: 'Trabajador sin casco en zona de izaje',
      // observerUid is the caller uid (anti-blame: observador es el caller).
      observerUid: 'u1',
    });
    // observedAt is a real ISO-8601 timestamp produced by the engine.
    expect(typeof res.body.observation.observedAt).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.observation.observedAt))).toBe(false);
  });

  it('200 trims the note (engine output, not the raw wire value)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBody, observationId: 'obs-trim', note: '   casco mal puesto   ' });
    expect(res.status).toBe(201);
    expect(res.body.observation.note).toBe('casco mal puesto');
  });

  it('400 on invalid body (unknown category rejected by Zod)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBody, category: 'not-a-category' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body (note shorter than 5 chars rejected by Zod)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBody, note: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 (engine NOTE_HAS_PII) when the note carries a RUT — anti-blame survives HTTP', async () => {
    // Passes Zod (>=5 chars, valid enums) but the REAL engine rejects PII.
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...validBody, observationId: 'obs-pii', note: 'observado 12.345.678-9 sin epp' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NOTE_HAS_PII');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/bbs/record-observation')
      .set(uid)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/bbs/record-observation')
      .set(uid)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// build-profile
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/bbs/build-profile', () => {
  const url = '/api/p1/bbs/build-profile';

  // A fixed observation set: 3 inside (tenant p1, in-window), 1 cross-tenant,
  // 1 out-of-window. The router forces tenantId = path projectId (p1).
  const windowStart = '2026-05-01T00:00:00.000Z';
  const windowEnd = '2026-05-31T23:59:59.000Z';

  function makeObs(over: Partial<BbsObservation>): BbsObservation {
    return {
      observationId: 'o',
      tenantId: 'p1',
      areaId: 'area-A',
      category: 'epp',
      outcome: 'safe',
      note: 'nota',
      observerUid: 'obs1',
      observedAt: '2026-05-10T00:00:00.000Z',
      ...over,
    };
  }

  const observations: BbsObservation[] = [
    makeObs({ observationId: 'i1', areaId: 'area-A', category: 'epp', outcome: 'safe' }),
    makeObs({ observationId: 'i2', areaId: 'area-A', category: 'epp', outcome: 'at_risk' }),
    makeObs({ observationId: 'i3', areaId: 'area-B', category: 'procedures', outcome: 'safe' }),
    // Cross-tenant: must be filtered out by the engine's tenant isolation.
    makeObs({ observationId: 'x-tenant', tenantId: 'p2', outcome: 'at_risk' }),
    // Out-of-window (before windowStart): must be filtered out.
    makeObs({ observationId: 'x-window', observedAt: '2026-01-01T00:00:00.000Z', outcome: 'at_risk' }),
  ];

  const profileBody = { observations, windowStart, windowEnd };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(profileBody);
    expect(res.status).toBe(401);
  });

  it('200 returns the REAL engine profile (tenant + window filtering applied)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(profileBody);
    expect(res.status).toBe(200);

    // Re-derive the expected profile from the UNMOCKED engine with the same
    // server-controlled tenantId (p1) the router injects — never copy the
    // handler. This proves the engine ran on the real (filtered) input.
    const expected = buildProfile({
      tenantId: 'p1',
      observations,
      windowStart: new Date(windowStart),
      windowEnd: new Date(windowEnd),
    });
    expect(res.body.profile).toEqual(expected);

    // Spot-check the load-bearing numbers so a mutated engine can't pass by
    // matching itself: 3 in-scope obs (cross-tenant + out-of-window dropped),
    // 2 safe of 3 → 66.7%, epp is a focus category (50% < 70%), area-A is the
    // top risk area (1 at_risk of 2 → 50%).
    expect(res.body.profile.tenantId).toBe('p1');
    expect(res.body.profile.totalObservations).toBe(3);
    expect(res.body.profile.safePercentage).toBe(66.7);
    expect(res.body.profile.byCategory.epp).toEqual({
      total: 2,
      safe: 1,
      atRisk: 1,
      safePercentage: 50,
    });
    expect(res.body.profile.focusCategories).toEqual(['epp']);
    expect(res.body.profile.topRiskAreas[0]).toEqual({
      areaId: 'area-A',
      atRiskPct: 50,
      total: 2,
    });
  });

  it('200 with an empty observation set yields a zeroed profile', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ observations: [], windowStart, windowEnd });
    expect(res.status).toBe(200);
    expect(res.body.profile.totalObservations).toBe(0);
    expect(res.body.profile.safePercentage).toBe(0);
    expect(res.body.profile.focusCategories).toEqual([]);
    expect(res.body.profile.topRiskAreas).toEqual([]);
  });

  it('400 on invalid body (windowStart missing)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ observations: [], windowEnd });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body (observation missing required observedAt)', async () => {
    const badObs = [{ ...observations[0], observedAt: undefined }];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ observations: badObs, windowStart, windowEnd });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 (engine BAD_WINDOW) when windowEnd precedes windowStart', async () => {
    // Both pass Zod (>=10 chars) but the engine rejects the inverted window.
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ observations: [], windowStart: windowEnd, windowEnd: windowStart });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('BAD_WINDOW');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/bbs/build-profile')
      .set(uid)
      .send(profileBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
