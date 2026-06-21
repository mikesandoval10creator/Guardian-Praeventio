// Real-router supertest for the Circadian Rhythm + Alertness HTTP surface
// (src/server/routes/circadian.ts). Three stateless POST endpoints over the
// pure engine in src/services/circadian/circadianRhythmService.ts:
//
//   POST /:projectId/circadian/classify-window         → { window }
//   POST /:projectId/circadian/assess-alertness         → { report }
//   POST /:projectId/circadian/recommend-shift-rotation → { recommendation }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real compute. The
// expected 200 bodies are re-derived by calling the real engine functions from
// the test (not copied from the handler), so the assertions pin actual output.

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

import circadianRouter from '../../server/routes/circadian.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  classifyCircadianWindow,
  assessAlertness,
  recommendShiftRotation,
  type CircadianInput,
  type ShiftWorker,
} from '../../services/circadian/circadianRhythmService.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', circadianRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/circadian/classify-window', () => {
  const url = '/api/p1/circadian/classify-window';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ localHour: 3 });
    expect(res.status).toBe(401);
  });

  it('200 classifies the low-alert window (2-6am) matching the real engine', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ localHour: 3 });
    expect(res.status).toBe(200);
    // Re-derive from the real engine — NIOSH 2-6am window is low_alert.
    expect(res.body.window).toBe(classifyCircadianWindow(3));
    expect(res.body.window).toBe('low_alert');
  });

  it('200 classifies the peak window (9-12) matching the real engine', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ localHour: 10 });
    expect(res.status).toBe(200);
    expect(res.body.window).toBe(classifyCircadianWindow(10));
    expect(res.body.window).toBe('peak');
  });

  it('200 classifies the boundary hour 0 (wrap-around low_alert)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ localHour: 0 });
    expect(res.status).toBe(200);
    expect(res.body.window).toBe(classifyCircadianWindow(0));
    expect(res.body.window).toBe('low_alert');
  });

  it('400 when localHour is out of range (>23)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ localHour: 24 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when localHour is not an integer', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ localHour: 3.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when localHour is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/circadian/classify-window')
      .set(uid)
      .send({ localHour: 3 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/circadian/classify-window')
      .set(uid)
      .send({ localHour: 3 });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/circadian/assess-alertness', () => {
  const url = '/api/p1/circadian/assess-alertness';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ localHour: 10, sleepHoursLast24h: 8, consecutiveNightShifts: 0 });
    expect(res.status).toBe(401);
  });

  it('200 returns a high-alertness report for a rested peak-window worker', async () => {
    const input: CircadianInput = {
      localHour: 10,
      sleepHoursLast24h: 8,
      consecutiveNightShifts: 0,
    };
    const res = await request(buildApp()).post(url).set(uid).send(input);
    expect(res.status).toBe(200);
    // Re-derive the WHOLE report from the real engine — peak baseline 90, no
    // penalties → high, no recommendations, ops not blocked.
    expect(res.body.report).toEqual(assessAlertness(input));
    expect(res.body.report.level).toBe('high');
    expect(res.body.report.alertnessScore).toBe(90);
    expect(res.body.report.blockCriticalOps).toBe(false);
    expect(res.body.report.recommendations).toEqual([]);
  });

  it('200 returns a critical report (score clamped to 0) for a fatigued night worker', async () => {
    const input: CircadianInput = {
      localHour: 3, // low_alert baseline 25
      sleepHoursLast24h: 3, // < 4 → -30
      consecutiveNightShifts: 6, // >= 5 → -20
      mentalLoadRating: 9, // >= 8 → -15
    };
    const res = await request(buildApp()).post(url).set(uid).send(input);
    expect(res.status).toBe(200);
    expect(res.body.report).toEqual(assessAlertness(input));
    // 25 - 30 - 20 - 15 = -40, clamped to 0 → critical.
    expect(res.body.report.alertnessScore).toBe(0);
    expect(res.body.report.level).toBe('critical');
    // Directive #2: recommends but the report only flags — it never auto-blocks
    // machinery itself; blockCriticalOps is the advisory flag, true at critical.
    expect(res.body.report.blockCriticalOps).toBe(true);
    // All four recommendation branches fire (low_alert, low sleep, >=5 nights, critical).
    expect(res.body.report.recommendations).toHaveLength(4);
  });

  it('200 accepts an omitted optional mentalLoadRating', async () => {
    const input: CircadianInput = {
      localHour: 15, // optimal baseline 80
      sleepHoursLast24h: 7,
      consecutiveNightShifts: 0,
    };
    const res = await request(buildApp()).post(url).set(uid).send(input);
    expect(res.status).toBe(200);
    expect(res.body.report).toEqual(assessAlertness(input));
    expect(res.body.report.window).toBe('optimal');
  });

  it('400 when sleepHoursLast24h exceeds 24', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ localHour: 10, sleepHoursLast24h: 25, consecutiveNightShifts: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when mentalLoadRating is below the 1-10 range', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ localHour: 10, sleepHoursLast24h: 8, consecutiveNightShifts: 0, mentalLoadRating: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when consecutiveNightShifts is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ localHour: 10, sleepHoursLast24h: 8 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/circadian/assess-alertness')
      .set(uid)
      .send({ localHour: 10, sleepHoursLast24h: 8, consecutiveNightShifts: 0 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/circadian/recommend-shift-rotation', () => {
  const url = '/api/p1/circadian/recommend-shift-rotation';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ workerUid: 'w1', currentShiftDays: 2, currentShiftKind: 'day', hoursWorkedWeek: 40 });
    expect(res.status).toBe(401);
  });

  it('200 recommends no rotation for a worker within limits', async () => {
    const worker: ShiftWorker = {
      workerUid: 'w1',
      currentShiftDays: 2,
      currentShiftKind: 'day',
      hoursWorkedWeek: 40,
    };
    const res = await request(buildApp()).post(url).set(uid).send(worker);
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toEqual(recommendShiftRotation(worker));
    expect(res.body.recommendation.needsRotation).toBe(false);
    expect(res.body.recommendation.reasons).toEqual([]);
    // max(0, 7 - 2) = 5 days until forced rotation.
    expect(res.body.recommendation.daysUntilForceRotation).toBe(5);
  });

  it('200 flags rotation for excessive night shifts AND illegal weekly hours', async () => {
    const worker: ShiftWorker = {
      workerUid: 'w9',
      currentShiftDays: 8, // > 7 consecutive night shifts
      currentShiftKind: 'night',
      hoursWorkedWeek: 50, // > 45 legal max (Ley 21.561)
    };
    const res = await request(buildApp()).post(url).set(uid).send(worker);
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toEqual(recommendShiftRotation(worker));
    expect(res.body.recommendation.needsRotation).toBe(true);
    expect(res.body.recommendation.reasons).toHaveLength(2);
    // currentShiftDays already exceeds the cap → clamped to 0.
    expect(res.body.recommendation.daysUntilForceRotation).toBe(0);
    expect(res.body.recommendation.workerUid).toBe('w9');
  });

  it('400 when currentShiftKind is not one of day/night/rotative', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ workerUid: 'w1', currentShiftDays: 2, currentShiftKind: 'swing', hoursWorkedWeek: 40 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when workerUid is empty', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ workerUid: '', currentShiftDays: 2, currentShiftKind: 'day', hoursWorkedWeek: 40 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when hoursWorkedWeek exceeds the 200h cap', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ workerUid: 'w1', currentShiftDays: 2, currentShiftKind: 'day', hoursWorkedWeek: 201 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/circadian/recommend-shift-rotation')
      .set(uid)
      .send({ workerUid: 'w1', currentShiftDays: 2, currentShiftKind: 'day', hoursWorkedWeek: 40 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
