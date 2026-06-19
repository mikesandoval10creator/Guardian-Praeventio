// Praeventio Guard — Driving telemetry router: real-router supertest (CLAUDE.md
// #22 behavioral-coverage ratchet). Boots the REAL `driving` router with
// admin.firestore() backed by the in-memory FakeFirestore, mocks ONLY
// infrastructure (firebase-admin, verifyAuth, captureRouteError, logger), and
// drives the three endpoints through their full lifecycle:
//   POST /:projectId/driving/haversine-meters
//   POST /:projectId/driving/accumulate-trip-mileage
//   POST /:projectId/driving/detect-aggressive-brake
//
// These handlers are PURE compute over `src/services/driving/speedTrigger.ts`
// (no Firestore writes by design — see the file header). The REAL engine runs
// unmocked, so we assert the exact deterministic math the handler returns, plus
// the auth (401) / membership (403) / Zod-validation (400) gates. The project
// doc IS seeded so `assertProjectMember` (which reads `projects/{id}`) passes.

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

import drivingRouter from './driving';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
import {
  haversineMeters,
  accumulateTripMileage,
  detectAggressiveBrake,
  AGGRESSIVE_BRAKE_G_THRESHOLD,
} from '../../services/driving/speedTrigger.js';

const PREFIX = '/api/driving';
const PROJECT = 'p1';
const MEMBER = 'member-1';
const OUTSIDER = 'outsider-9';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, drivingRouter);
  return app;
}

function seedProject(members: string[] = [MEMBER]) {
  H.db!._seed(`projects/${PROJECT}`, { members, createdBy: MEMBER });
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const url = (suffix: string) => `${PREFIX}/${PROJECT}/driving/${suffix}`;

// A geo pair ~111m apart on the equator (0.001° lat ≈ 111.2m) and an identical
// pair (distance 0) — both used to pin the haversine output exactly.
const POINT_A = { lat: -33.45, lng: -70.66 };
const POINT_B = { lat: -33.46, lng: -70.66 };

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

describe('driving router — auth + membership gates', () => {
  it('401 when no x-test-uid token is present', async () => {
    const res = await request(buildApp()).post(url('haversine-meters')).send({ a: POINT_A, b: POINT_B });
    expect(res.status).toBe(401);
  });

  it('403 for an authenticated caller who is not a project member', async () => {
    const res = await request(buildApp())
      .post(url('haversine-meters'))
      .set(asUser(OUTSIDER))
      .send({ a: POINT_A, b: POINT_B });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project doc does not exist at all', async () => {
    // assertProjectMember throws ProjectMembershipError when the project is
    // missing — the guard maps that to 403 regardless of caller.
    const res = await request(buildApp())
      .post(`${PREFIX}/ghost-project/driving/haversine-meters`)
      .set(asUser(MEMBER))
      .send({ a: POINT_A, b: POINT_B });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/driving/haversine-meters', () => {
  it('200 computes the real haversine distance for a member (matches the engine)', async () => {
    const res = await request(buildApp())
      .post(url('haversine-meters'))
      .set(asUser(MEMBER))
      .send({ a: POINT_A, b: POINT_B });
    expect(res.status).toBe(200);
    // The handler runs the REAL pure engine — pin to it exactly.
    expect(res.body.meters).toBeCloseTo(haversineMeters(POINT_A, POINT_B), 6);
    expect(res.body.meters).toBeGreaterThan(0);
  });

  it('200 returns 0 meters for identical points (no float ambiguity)', async () => {
    const res = await request(buildApp())
      .post(url('haversine-meters'))
      .set(asUser(MEMBER))
      .send({ a: POINT_A, b: POINT_A });
    expect(res.status).toBe(200);
    expect(res.body.meters).toBe(0);
  });

  it('400 on an out-of-range latitude (Zod geoSchema rejects lat > 90)', async () => {
    const res = await request(buildApp())
      .post(url('haversine-meters'))
      .set(asUser(MEMBER))
      .send({ a: { lat: 999, lng: 0 }, b: POINT_B });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a required point is missing', async () => {
    const res = await request(buildApp())
      .post(url('haversine-meters'))
      .set(asUser(MEMBER))
      .send({ a: POINT_A }); // no `b`
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

describe('POST /:projectId/driving/accumulate-trip-mileage', () => {
  it('200 accumulates a moving segment and matches the engine result', async () => {
    // 0.001° lat over 1s ≈ 111m → ~400 km/h is > 250 cap, so widen the window
    // to land inside the [3, 250] km/h band the engine accepts.
    const body = {
      prevTotalM: 1000,
      prev: POINT_A,
      next: POINT_B,
      prevTimestampMs: 0,
      nextTimestampMs: 30_000, // 30s → ~13 km/h, counted
    };
    const res = await request(buildApp())
      .post(url('accumulate-trip-mileage'))
      .set(asUser(MEMBER))
      .send(body);
    expect(res.status).toBe(200);
    const expected = accumulateTripMileage(
      body.prevTotalM,
      body.prev,
      body.next,
      body.prevTimestampMs,
      body.nextTimestampMs,
    );
    expect(res.body.result).toEqual(expected);
    expect(res.body.result.counted).toBe(true);
    expect(res.body.result.totalM).toBeGreaterThan(body.prevTotalM);
  });

  it('200 with prev=null returns the unchanged total, uncounted (first fix)', async () => {
    const res = await request(buildApp())
      .post(url('accumulate-trip-mileage'))
      .set(asUser(MEMBER))
      .send({
        prevTotalM: 500,
        prev: null,
        next: POINT_B,
        prevTimestampMs: 0,
        nextTimestampMs: 1000,
      });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ totalM: 500, counted: false, segmentM: 0 });
  });

  it('400 on a negative prevTotalM (Zod nonnegative)', async () => {
    const res = await request(buildApp())
      .post(url('accumulate-trip-mileage'))
      .set(asUser(MEMBER))
      .send({
        prevTotalM: -1,
        prev: POINT_A,
        next: POINT_B,
        prevTimestampMs: 0,
        nextTimestampMs: 1000,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

describe('POST /:projectId/driving/detect-aggressive-brake', () => {
  it('200 flags a sustained >=0.5g deceleration window (returns first timestamp)', async () => {
    // 0.5g ≈ 4.903 m/s². -5 m/s² sustained from t=0 to t=200ms qualifies.
    const samples = [
      { timestampMs: 0, longitudinalMs2: -5 },
      { timestampMs: 100, longitudinalMs2: -5 },
      { timestampMs: 200, longitudinalMs2: -5 },
    ];
    const res = await request(buildApp())
      .post(url('detect-aggressive-brake'))
      .set(asUser(MEMBER))
      .send({ samples });
    expect(res.status).toBe(200);
    expect(res.body.triggerAt).toBe(detectAggressiveBrake(samples));
    expect(res.body.triggerAt).toBe(0);
  });

  it('200 returns null when deceleration stays below the 0.5g threshold', async () => {
    // Keep magnitudes safely under AGGRESSIVE_BRAKE_G_THRESHOLD * 9.80665.
    const subThreshold = AGGRESSIVE_BRAKE_G_THRESHOLD * 9.80665 - 1;
    const samples = [
      { timestampMs: 0, longitudinalMs2: -subThreshold },
      { timestampMs: 250, longitudinalMs2: -subThreshold },
    ];
    const res = await request(buildApp())
      .post(url('detect-aggressive-brake'))
      .set(asUser(MEMBER))
      .send({ samples });
    expect(res.status).toBe(200);
    expect(res.body.triggerAt).toBeNull();
  });

  it('400 when samples is not an array (Zod z.array)', async () => {
    const res = await request(buildApp())
      .post(url('detect-aggressive-brake'))
      .set(asUser(MEMBER))
      .send({ samples: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when an IMU sample has an out-of-range longitudinalMs2', async () => {
    const res = await request(buildApp())
      .post(url('detect-aggressive-brake'))
      .set(asUser(MEMBER))
      .send({ samples: [{ timestampMs: 0, longitudinalMs2: 9999 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});
