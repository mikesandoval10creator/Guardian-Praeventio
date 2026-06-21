// Real-router supertest for the Mental Load (NASA-TLX) + Admin Burden HTTP
// surface (src/server/routes/mentalLoad.ts). Two stateless POST endpoints over
// the pure engine in src/services/mentalLoad/mentalLoadTracker.ts:
//
//   POST /:projectId/mental-load/score-survey
//   POST /:projectId/mental-load/build-admin-burden
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked so the response shapes are real compute —
// the expected scores below are recomputed by hand from the engine formula,
// never re-derived from the handler.

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

import mentalLoadRouter from '../../server/routes/mentalLoad.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', mentalLoadRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A valid NASA-TLX survey body (workerUid is forced server-side from the caller,
// so it is NOT part of the wire body).
function survey(overrides: Record<string, unknown> = {}) {
  return {
    mentalDemand: 30,
    physicalDemand: 30,
    temporalDemand: 30,
    effort: 30,
    frustration: 30,
    performance: 30,
    surveyedAt: '2026-05-01T08:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/mental-load/score-survey', () => {
  const url = '/api/p1/mental-load/score-survey';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(survey());
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine score with workerUid forced from the caller', async () => {
    // All six dims at 30 → overallLoad = 30 (round of 30) → level 'low'.
    // No dimension crosses its recommendation threshold → empty recommendations.
    const res = await request(buildApp()).post(url).set(uid).send(survey());
    expect(res.status).toBe(200);
    expect(res.body.score.workerUid).toBe('u1'); // forced from token, never the body
    expect(res.body.score.overallLoad).toBe(30);
    expect(res.body.score.level).toBe('low');
    expect(res.body.score.recommendations).toEqual([]);
  });

  it('200 critical level fires the dominant factor + critical recommendations', async () => {
    // mentalDemand 90, frustration 80, temporal 75, the rest 60.
    // mean = (90+60+75+60+80+60)/6 = 425/6 = 70.83 → round 71 → 'high'? no:
    // recompute carefully below.
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send(
        survey({
          mentalDemand: 90,
          physicalDemand: 80,
          temporalDemand: 85,
          effort: 80,
          frustration: 80,
          performance: 80,
        }),
      );
    expect(res.status).toBe(200);
    // mean = (90+80+85+80+80+80)/6 = 495/6 = 82.5 → round 83 → 'critical' (>=75).
    expect(res.body.score.overallLoad).toBe(83);
    expect(res.body.score.level).toBe('critical');
    // Highest dim is mentalDemand (90) → dominant.
    expect(res.body.score.dominantFactor).toBe('mentalDemand');
    // mentalDemand>75, frustration>60, temporal>70, physical>70, level critical
    // → five recommendation lines, last is the 1:1 critical line.
    expect(res.body.score.recommendations).toHaveLength(5);
    expect(res.body.score.recommendations[4]).toContain('1:1');
  });

  it('400 on out-of-range dimension (mentalDemand > 100)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send(survey({ mentalDemand: 150 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on missing required dimension', async () => {
    const body = survey();
    delete (body as Record<string, unknown>).effort;
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/mental-load/score-survey')
      .set(uid)
      .send(survey());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/mental-load/score-survey')
      .set(uid)
      .send(survey());
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/mental-load/build-admin-burden', () => {
  const url = '/api/p1/mental-load/build-admin-burden';

  function task(overrides: Record<string, unknown> = {}) {
    return { workerUid: 'w1', kind: 'form_filling', minutesPerWeek: 100, ...overrides };
  }

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ tasks: [], workerUid: 'w1' });
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine burden report (filtered to the target worker)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        workerUid: 'w1',
        tasks: [
          task({ kind: 'data_entry', minutesPerWeek: 600 }), // w1, saving round(600*0.85)=510
          task({ kind: 'form_filling', minutesPerWeek: 300 }), // w1, saving round(300*0.7)=210
          task({ kind: 'meeting', minutesPerWeek: 120 }), // w1, saving round(120*0.2)=24 → filtered (<30)
          task({ workerUid: 'other', kind: 'data_entry', minutesPerWeek: 9000 }), // NOT w1 → ignored
        ],
      });
    expect(res.status).toBe(200);
    const report = res.body.report as {
      workerUid: string;
      totalAdminMinutesPerWeek: number;
      adminLoadPercent: number;
      level: string;
      automationCandidates: Array<{ kind: string; minutesPerWeek: number; estimatedSaving: number }>;
    };
    expect(report.workerUid).toBe('w1');
    // Only w1's tasks: 600 + 300 + 120 = 1020 (the 9000 from 'other' is excluded).
    expect(report.totalAdminMinutesPerWeek).toBe(1020);
    // 1020 / 2700 = 0.3777… → round 38 → 'high' (>=25, <40).
    expect(report.adminLoadPercent).toBe(38);
    expect(report.level).toBe('high');
    // meeting (24) is below the 30-min floor → dropped; sorted by saving desc.
    expect(report.automationCandidates).toEqual([
      { kind: 'data_entry', minutesPerWeek: 600, estimatedSaving: 510 },
      { kind: 'form_filling', minutesPerWeek: 300, estimatedSaving: 210 },
    ]);
  });

  it('200 healthy when admin load is low + empty automation list', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ workerUid: 'w1', tasks: [task({ kind: 'meeting', minutesPerWeek: 60 })] });
    expect(res.status).toBe(200);
    const report = res.body.report;
    expect(report.totalAdminMinutesPerWeek).toBe(60);
    expect(report.adminLoadPercent).toBe(2); // round(60/2700*100)=2
    expect(report.level).toBe('healthy');
    // meeting saving = round(60*0.2)=12 < 30 → no candidates.
    expect(report.automationCandidates).toEqual([]);
  });

  it('400 when tasks is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tasks: 'nope', workerUid: 'w1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an invalid task kind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ workerUid: 'w1', tasks: [task({ kind: 'coffee_break' })] });
    expect(res.status).toBe(400);
  });

  it('400 on a negative minutesPerWeek', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ workerUid: 'w1', tasks: [task({ minutesPerWeek: -5 })] });
    expect(res.status).toBe(400);
  });

  it('400 when workerUid is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tasks: [task()] });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/mental-load/build-admin-burden')
      .set(uid)
      .send({ tasks: [task()], workerUid: 'w1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
