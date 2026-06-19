// Praeventio Guard — Mountain Refuges router: real-router supertest (B-Fase5,
// CLAUDE.md #22). Boots the REAL refuges router with admin.firestore() backed by
// the in-memory FakeFirestore and drives the three stateless endpoints over HTTP
// via supertest. This is a LIFE-CRITICAL surface (offline mountain emergency
// catalog), so the assertions exercise the REAL handler + REAL pure engine
// (findNearestRefuges / refugeAvailability / catalog filtering), not stubs.
//
// The router is READ-ONLY: it performs no Firestore writes and emits no
// audit_logs (pure-engine reads). So the only persistence the test seeds is the
// project doc that `assertProjectMember` reads to authorize the caller; the
// behavioral assertions target status codes + response bodies computed by the
// real catalog/engine, plus the 401/403/400 gates.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = { uid, email: req.header('x-test-email') ?? null } as import('express').Request['user'];
    next();
  },
}));

vi.mock('../middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import refugesRouter from './refuges';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
// Import the REAL catalog/engine so expected values are derived from the same
// source the router uses — no hard-coded magic numbers that could drift.
import {
  MOUNTAIN_REFUGES_CHILE,
  findNearestRefuges,
} from '../../services/refuges/mountainRefuges.js';

const PREFIX = '/api/sprint-c';
const PROJECT = 'p1';
const MEMBER = 'member-1';
const CREATOR = 'creator-0';
const OUTSIDER = 'outsider-9';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, refugesRouter);
  return app;
}

function seedProject(members: string[] = [MEMBER]) {
  H.db!._seed(`projects/${PROJECT}`, { members, createdBy: CREATOR });
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const base = `${PREFIX}/${PROJECT}/refuges`;

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

describe('POST /:projectId/refuges/list-catalog', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${base}/list-catalog`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('403 for a non-member (assertProjectMember reads the seeded project doc)', async () => {
    const res = await request(buildApp())
      .post(`${base}/list-catalog`)
      .set(asUser(OUTSIDER))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist (membership cannot be verified)', async () => {
    H.db = createFakeFirestore(); // no project doc seeded
    const res = await request(buildApp())
      .post(`${PREFIX}/ghost/refuges/list-catalog`)
      .set(asUser(MEMBER))
      .send({});
    expect(res.status).toBe(403);
  });

  it('400 on an invalid body (region not in the enum)', async () => {
    const res = await request(buildApp())
      .post(`${base}/list-catalog`)
      .set(asUser(MEMBER))
      .send({ region: 'mars' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns the full curated catalog for a member', async () => {
    const res = await request(buildApp())
      .post(`${base}/list-catalog`)
      .set(asUser(MEMBER))
      .send({});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.refuges)).toBe(true);
    // Derived from the REAL catalog the router serves (no magic number).
    expect(res.body.refuges).toHaveLength(MOUNTAIN_REFUGES_CHILE.length);
    expect(res.body.refuges[0]).toMatchObject({ id: MOUNTAIN_REFUGES_CHILE[0]!.id });
  });

  it('200 filters by region (austral) for a member — and the creator also passes the guard', async () => {
    const expected = MOUNTAIN_REFUGES_CHILE.filter((r) => r.region === 'austral');
    const res = await request(buildApp())
      .post(`${base}/list-catalog`)
      .set(asUser(CREATOR)) // createdBy path of assertProjectMember
      .send({ region: 'austral' });
    expect(res.status).toBe(200);
    expect(res.body.refuges).toHaveLength(expected.length);
    expect(res.body.refuges.every((r: { region: string }) => r.region === 'austral')).toBe(true);
  });

  it('200 filters by requireYearRound for a member', async () => {
    const expected = MOUNTAIN_REFUGES_CHILE.filter((r) => r.season === 'year_round');
    const res = await request(buildApp())
      .post(`${base}/list-catalog`)
      .set(asUser(MEMBER))
      .send({ requireYearRound: true });
    expect(res.status).toBe(200);
    expect(res.body.refuges).toHaveLength(expected.length);
    expect(res.body.refuges.every((r: { season: string }) => r.season === 'year_round')).toBe(true);
  });
});

describe('POST /:projectId/refuges/find-nearest', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${base}/find-nearest`)
      .send({ lat: -50.98, lng: -73.08 });
    expect(res.status).toBe(401);
  });

  it('400 when lat/lng are missing (schema requires them)', async () => {
    const res = await request(buildApp())
      .post(`${base}/find-nearest`)
      .set(asUser(MEMBER))
      .send({ count: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when lat is out of range (> 90)', async () => {
    const res = await request(buildApp())
      .post(`${base}/find-nearest`)
      .set(asUser(MEMBER))
      .send({ lat: 1000, lng: 0 });
    expect(res.status).toBe(400);
  });

  it('200 returns the nearest refuges sorted by distance, matching the real engine', async () => {
    // Near Torres del Paine (austral). Expected output is computed by the SAME
    // pure engine the router calls, so the assertion tracks real behavior.
    const lat = -50.98;
    const lng = -73.08;
    const expected = findNearestRefuges(lat, lng, { count: 3 });

    const res = await request(buildApp())
      .post(`${base}/find-nearest`)
      .set(asUser(MEMBER))
      .send({ lat, lng, count: 3 });
    expect(res.status).toBe(200);
    expect(res.body.refuges).toHaveLength(expected.length);
    // Same ordering + ids as the engine.
    expect(res.body.refuges.map((r: { id: string }) => r.id)).toEqual(
      expected.map((r) => r.id),
    );
    // Each result carries a numeric distance, ascending.
    const distances: number[] = res.body.refuges.map((r: { distanceKm: number }) => r.distanceKm);
    expect(distances.every((d) => typeof d === 'number')).toBe(true);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
    }
  });

  it('200 honors the region filter (default count caps results)', async () => {
    const res = await request(buildApp())
      .post(`${base}/find-nearest`)
      .set(asUser(MEMBER))
      .send({ lat: -33.45, lng: -70.66, region: 'central' });
    expect(res.status).toBe(200);
    expect(res.body.refuges.every((r: { region: string }) => r.region === 'central')).toBe(true);
    // Default count is 3 → never more than 3 results.
    expect(res.body.refuges.length).toBeLessThanOrEqual(3);
  });
});

describe('POST /:projectId/refuges/availability', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${base}/availability`)
      .send({ season: 'year_round' });
    expect(res.status).toBe(401);
  });

  it('400 on an invalid season (not in the enum)', async () => {
    const res = await request(buildApp())
      .post(`${base}/availability`)
      .set(asUser(MEMBER))
      .send({ season: 'monsoon' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when season is missing', async () => {
    const res = await request(buildApp())
      .post(`${base}/availability`)
      .set(asUser(MEMBER))
      .send({});
    expect(res.status).toBe(400);
  });

  it('200 → "open" for a year_round refuge (date-independent branch)', async () => {
    const res = await request(buildApp())
      .post(`${base}/availability`)
      .set(asUser(MEMBER))
      .send({ season: 'year_round' });
    expect(res.status).toBe(200);
    expect(res.body.availability).toBe('open');
  });

  it('200 → "closed" for a closed refuge (date-independent branch)', async () => {
    const res = await request(buildApp())
      .post(`${base}/availability`)
      .set(asUser(MEMBER))
      .send({ season: 'closed' });
    expect(res.status).toBe(200);
    expect(res.body.availability).toBe('closed');
  });

  it('200 → a valid classification for a seasonal refuge (value depends on current month)', async () => {
    // summer_only resolves to 'open' or 'closed' depending on the month the
    // suite runs; assert it is one of the documented outcomes rather than
    // hard-coding a date-sensitive value.
    const res = await request(buildApp())
      .post(`${base}/availability`)
      .set(asUser(MEMBER))
      .send({ season: 'summer_only' });
    expect(res.status).toBe(200);
    expect(['open', 'check', 'closed']).toContain(res.body.availability);
  });
});
