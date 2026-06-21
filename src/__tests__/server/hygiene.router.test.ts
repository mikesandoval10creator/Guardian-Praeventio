// Real-router supertest for the Industrial Hygiene HTTP surface
// (src/server/routes/hygiene.ts). Two stateless POST endpoints over the pure
// Mifflin-St Jeor engine in src/services/hygiene/metabolicRate.ts:
//
//   POST /:projectId/hygiene/bmr           → { bmr: number | null }
//   POST /:projectId/hygiene/current-burn  → { burn: number | null }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + captureRouteError are
// mocked; the engine itself runs unmocked so the response numbers are real
// compute (the BMR formula, not a reimplementation).

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
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import hygieneRouter from '../../server/routes/hygiene.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', hygieneRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/hygiene/bmr', () => {
  const url = '/api/p1/hygiene/bmr';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(res.status).toBe(401);
  });

  it('200 returns the real Mifflin-St Jeor BMR for a complete male profile', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(res.status).toBe(200);
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(res.body).toEqual({ bmr: 1780 });
  });

  it('200 applies the female -161 offset (engine branch, not reimplemented)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ weightKg: 60, heightCm: 165, ageYears: 40, sex: 'female' });
    expect(res.status).toBe(200);
    // 10*60 + 6.25*165 - 5*40 - 161 = 600 + 1031.25 - 200 - 161 = 1270.25 → round → 1270
    expect(res.body).toEqual({ bmr: 1270 });
  });

  it('200 returns bmr:null when the profile is incomplete (honest refusal)', async () => {
    // All bmr fields are optional in the schema, so an empty body validates;
    // the engine intentionally returns null rather than a fabricated number.
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bmr: null });
  });

  it('400 when sex is not in the enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'other' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when weightKg exceeds the schema max', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ weightKg: 600, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(res.status).toBe(400);
  });

  it('400 when weightKg is not positive', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ weightKg: -1, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/hygiene/bmr')
      .set(uid)
      .send({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/hygiene/bmr')
      .set(uid)
      .send({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/hygiene/current-burn', () => {
  const url = '/api/p1/hygiene/current-burn';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ bmr: 1780, hourOfDay: 12 });
    expect(res.status).toBe(401);
  });

  it('200 linearly distributes the daily BMR across the day', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ bmr: 1780, hourOfDay: 12 });
    expect(res.status).toBe(200);
    // floor((12/24) * 1780) = floor(890) = 890
    expect(res.body).toEqual({ burn: 890 });
  });

  it('200 floors fractional burns (no fabricated precision)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ bmr: 2000, hourOfDay: 1 });
    expect(res.status).toBe(200);
    // floor((1/24) * 2000) = floor(83.33...) = 83
    expect(res.body).toEqual({ burn: 83 });
  });

  it('200 returns burn:null when bmr is null (honest refusal propagates)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ bmr: null, hourOfDay: 12 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ burn: null });
  });

  it('400 when hourOfDay is out of range', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ bmr: 1780, hourOfDay: 25 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when bmr is missing (required, not optional like the bmr route)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ hourOfDay: 12 });
    expect(res.status).toBe(400);
  });

  it('400 when bmr is not positive', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ bmr: 0, hourOfDay: 12 });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/hygiene/current-burn')
      .set(uid)
      .send({ bmr: 1780, hourOfDay: 12 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
