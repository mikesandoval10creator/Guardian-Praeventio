// Real-router supertest for the Climate-Aware Scheduling HTTP surface
// (src/server/routes/climateAwareScheduling.ts). Two stateless POST endpoints
// over the pure engine in
// src/services/climateAwareScheduling/climateAwareScheduling.ts:
//
//   POST /:projectId/climate-scheduling/assess-task       → { assessment }
//   POST /:projectId/climate-scheduling/build-daily-plan  → { plan }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the
// project (never by mocking the gate). verifyAuth + logger + observability are
// mocked; the engine, the Zod `validate` middleware and `assertProjectMember`
// run UNMOCKED, so every 200 asserts real decision-engine output and every
// 400 exercises the real schema.
//
// The expected assessment/plan shapes below are RE-DERIVED from the engine's
// documented rules (izaje wind ≥11 m/s → suspend; pintura_exterior + rain
// >0.7 → reschedule with suggestedHour; clear weather indoor → proceed), not
// copied from the handler — the engine is pure and deterministic.

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

import climateRouter from '../../server/routes/climateAwareScheduling.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', climateRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// Clear, benign weather: every threshold in the engine is below trigger, so a
// well-placed indoor/low-risk task assesses to 'proceed' with no reasons.
const clearWeather = {
  temperatureC: 20,
  humidityPercent: 50,
  windSpeedMs: 2,
  rainProbability: 0.1,
  uvIndex: 3,
  visibilityKm: 20,
};

const officeTask = {
  id: 't-office',
  category: 'oficina' as const,
  scheduledHour: 9,
  outdoor: false,
  workerUids: ['w1'],
};

// izaje at ≥11 m/s wind → engine hard-blocks (suspend).
const craneTask = {
  id: 't-crane',
  category: 'izaje' as const,
  scheduledHour: 10,
  outdoor: true,
  workerUids: ['w1', 'w2'],
};

// pintura_exterior + rainProbability>0.7 (outdoor) → reschedule, morning →
// suggestedHour 6.
const paintTask = {
  id: 't-paint',
  category: 'pintura_exterior' as const,
  scheduledHour: 9,
  outdoor: true,
  workerUids: ['w1'],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/climate-scheduling/assess-task', () => {
  const url = '/api/p1/climate-scheduling/assess-task';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ task: officeTask, weather: clearWeather });
    expect(res.status).toBe(401);
  });

  it('200 proceed for an indoor task under clear weather (real engine output)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ task: officeTask, weather: clearWeather });
    expect(res.status).toBe(200);
    expect(res.body.assessment).toEqual({
      taskId: 't-office',
      category: 'oficina',
      decision: 'proceed',
      reasons: [],
      additionalControls: [],
    });
    // suggestedHour is undefined → omitted from JSON for non-reschedule.
    expect(res.body.assessment).not.toHaveProperty('suggestedHour');
  });

  it('200 suspend for izaje at ≥11 m/s wind (hard block)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ task: craneTask, weather: { ...clearWeather, windSpeedMs: 15 } });
    expect(res.status).toBe(200);
    expect(res.body.assessment.decision).toBe('suspend');
    expect(res.body.assessment.taskId).toBe('t-crane');
    expect(res.body.assessment.reasons).toEqual([
      'Viento 15.0 m/s ≥ 11 m/s — bloqueo izaje.',
    ]);
  });

  it('200 reschedule for exterior painting under high rain (suggestedHour set)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ task: paintTask, weather: { ...clearWeather, rainProbability: 0.9 } });
    expect(res.status).toBe(200);
    expect(res.body.assessment.decision).toBe('reschedule');
    // scheduledHour 9 < 11 → engine suggests the early 6:00 slot.
    expect(res.body.assessment.suggestedHour).toBe(6);
    expect(res.body.assessment.reasons).toContain(
      'Pintura exterior + lluvia → resultado defectuoso.',
    );
  });

  it('400 on invalid body (missing weather)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ task: officeTask });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a task category outside the enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        task: { ...officeTask, category: 'not-a-category' },
        weather: clearWeather,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on out-of-range weather (rainProbability > 1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ task: officeTask, weather: { ...clearWeather, rainProbability: 2 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/climate-scheduling/assess-task')
      .set(uid)
      .send({ task: officeTask, weather: clearWeather });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/climate-scheduling/assess-task')
      .set(uid)
      .send({ task: officeTask, weather: clearWeather });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/climate-scheduling/build-daily-plan', () => {
  const url = '/api/p1/climate-scheduling/build-daily-plan';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ tasks: [], weather: clearWeather });
    expect(res.status).toBe(401);
  });

  it('200 aggregates per-task decisions into real counts', async () => {
    // Under high rain + high wind: office(indoor)→proceed, crane(izaje)→suspend,
    // paint(exterior rain)→reschedule. Counts re-derived from the engine rules.
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        tasks: [officeTask, craneTask, paintTask],
        weather: { ...clearWeather, rainProbability: 0.9, windSpeedMs: 15 },
      });
    expect(res.status).toBe(200);
    expect(res.body.plan.assessments).toHaveLength(3);
    expect(res.body.plan.proceed).toBe(1);
    expect(res.body.plan.suspend).toBe(1);
    expect(res.body.plan.reschedule).toBe(1);
    expect(res.body.plan.addControls).toBe(0);
    // counts must sum to the task count — no task uncounted.
    const { proceed, suspend, reschedule, addControls } = res.body.plan;
    expect(proceed + suspend + reschedule + addControls).toBe(3);
  });

  it('200 returns all-zero counts for an empty task list', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tasks: [], weather: clearWeather });
    expect(res.status).toBe(200);
    expect(res.body.plan).toEqual({
      proceed: 0,
      addControls: 0,
      reschedule: 0,
      suspend: 0,
      assessments: [],
    });
  });

  it('400 when tasks is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tasks: 'nope', weather: clearWeather });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a task in the array is malformed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        tasks: [officeTask, { ...craneTask, scheduledHour: 99 }],
        weather: clearWeather,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/climate-scheduling/build-daily-plan')
      .set(uid)
      .send({ tasks: [], weather: clearWeather });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
