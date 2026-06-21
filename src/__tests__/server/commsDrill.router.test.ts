// Real-router supertest for the Emergency Comms Drill HTTP surface
// (src/server/routes/commsDrill.ts). Four stateless POST endpoints over the
// pure engine in src/services/commsDrill/commsDrillEngine.ts:
//
//   POST /:projectId/comms-drills/list-scripts   → { scripts }
//   POST /:projectId/comms-drills/get-by-id       → { scenario }
//   POST /:projectId/comms-drills/score           → { report }
//   POST /:projectId/comms-drills/plan-schedule    → { schedule }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real engine output —
// the happy-path expectations re-derive the score/schedule from the same
// deterministic formula the engine uses, rather than copying the handler.

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

import commsDrillRouter from '../../server/routes/commsDrill.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  listDrillScripts,
  getDrillById,
  scoreDrill,
  planDrillSchedule,
  type DrillExecutionInput,
} from '../../services/commsDrill/commsDrillEngine.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', commsDrillRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/comms-drills/list-scripts', () => {
  const url = '/api/p1/comms-drills/list-scripts';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({});
    expect(res.status).toBe(401);
  });

  it('200 returns the real drill library', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(200);
    // Re-derive from the real engine, not a literal copy of the handler.
    const expected = listDrillScripts();
    expect(res.body.scripts).toEqual(expected);
    // Sanity: the canonical monthly-primary drill is present with its real shape.
    const monthly = res.body.scripts.find(
      (s: { id: string }) => s.id === 'drill_monthly_primary',
    );
    expect(monthly).toBeDefined();
    expect(monthly.objective).toBe('verify_primary_channels');
    expect(monthly.recommendedIntervalDays).toBe(30);
    expect(monthly.channelChain).toEqual(['radio_vhf', 'phone_cell', 'app_push']);
  });

  it('400 on a non-empty body (strict schema rejects extra keys)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ rogue: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/comms-drills/list-scripts')
      .set(uid)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/comms-drills/list-scripts')
      .set(uid)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/comms-drills/get-by-id', () => {
  const url = '/api/p1/comms-drills/get-by-id';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ id: 'drill_evacuation' });
    expect(res.status).toBe(401);
  });

  it('200 returns the real scenario for a known id', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ id: 'drill_evacuation' });
    expect(res.status).toBe(200);
    expect(res.body.scenario).toEqual(getDrillById('drill_evacuation'));
    expect(res.body.scenario.objective).toBe('evacuation_announcement');
  });

  it('200 returns null for an unknown id (engine miss, not 404)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ id: 'does-not-exist' });
    expect(res.status).toBe(200);
    expect(res.body.scenario).toBeNull();
  });

  it('400 on invalid body (empty id violates min(1))', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ id: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body (missing id)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/comms-drills/get-by-id')
      .set(uid)
      .send({ id: 'drill_evacuation' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/comms-drills/score', () => {
  const url = '/api/p1/comms-drills/score';

  // A real, fully-confirmed, on-time drill with no outages → perfect score.
  const perfectBody: DrillExecutionInput = {
    scenarioId: 'drill_monthly_primary',
    targets: [
      { uid: 'w1', role: 'operator', expectedChannels: ['radio_vhf'] },
      { uid: 'w2', role: 'supervisor', expectedChannels: ['phone_cell'] },
    ],
    confirmations: [
      { targetUid: 'w1', channelUsed: 'radio_vhf', receivedAtSeconds: 30, onTime: true },
      { targetUid: 'w2', channelUsed: 'phone_cell', receivedAtSeconds: 90, onTime: true },
    ],
    executedAt: '2026-05-01T12:00:00.000Z',
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(perfectBody);
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine report for a perfect drill', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(perfectBody);
    expect(res.status).toBe(200);
    // Re-derive the expected report from the real engine (no handler copy).
    const expected = scoreDrill(perfectBody);
    expect(res.body.report).toEqual(expected);
    // Pin the meaningful properties so a silent engine regression is caught.
    expect(res.body.report.score).toBe(100);
    expect(res.body.report.verdict).toBe('excellent');
    expect(res.body.report.confirmationRatio).toBe(1);
    expect(res.body.report.nonResponders).toEqual([]);
    expect(res.body.report.failedChannels).toEqual([]);
  });

  it('200 flags non-responders and a channel outage (deficient path)', async () => {
    const partial: DrillExecutionInput = {
      scenarioId: 'drill_monthly_primary',
      targets: [
        { uid: 'w1', role: 'operator', expectedChannels: ['radio_vhf'] },
        { uid: 'w2', role: 'supervisor', expectedChannels: ['phone_cell'] },
      ],
      confirmations: [
        { targetUid: 'w1', channelUsed: 'radio_vhf', receivedAtSeconds: 40, onTime: false },
      ],
      channelOutages: [{ channel: 'app_push', from: 0, to: 60 }],
      executedAt: '2026-05-01T12:00:00.000Z',
    };
    const res = await request(buildApp()).post(url).set(uid).send(partial);
    expect(res.status).toBe(200);
    const expected = scoreDrill(partial);
    expect(res.body.report).toEqual(expected);
    expect(res.body.report.nonResponders).toEqual(['w2']);
    expect(res.body.report.failedChannels).toEqual(['app_push']);
    // 1/2 confirmed * 60 + 0 on-time * 30 + 0 (outage) = 30 → failed.
    expect(res.body.report.score).toBe(30);
    expect(res.body.report.verdict).toBe('failed');
  });

  it('200 returns a failed verdict for an unknown scenario', async () => {
    const body: DrillExecutionInput = {
      scenarioId: 'unknown-scenario',
      targets: [],
      confirmations: [],
      executedAt: '2026-05-01T12:00:00.000Z',
    };
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.report.verdict).toBe('failed');
    expect(res.body.report.score).toBe(0);
    expect(res.body.report.findings).toContain(
      'Drill scenario unknown-scenario no encontrado.',
    );
  });

  it('400 on invalid body (unknown channel enum)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        scenarioId: 'drill_monthly_primary',
        targets: [{ uid: 'w1', role: 'operator', expectedChannels: ['carrier_pigeon'] }],
        confirmations: [],
        executedAt: '2026-05-01T12:00:00.000Z',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body (executedAt too short)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...perfectBody, executedAt: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body (negative receivedAtSeconds)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...perfectBody,
        confirmations: [
          { targetUid: 'w1', channelUsed: 'radio_vhf', receivedAtSeconds: -1, onTime: true },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/comms-drills/score')
      .set(uid)
      .send(perfectBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/comms-drills/plan-schedule', () => {
  const url = '/api/p1/comms-drills/plan-schedule';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ pastExecutions: [] });
    expect(res.status).toBe(401);
  });

  it('200 marks every drill overdue when there are no past executions', async () => {
    const now = '2026-05-01T00:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ pastExecutions: [], now });
    expect(res.status).toBe(200);
    // Re-derive from the real engine with the same `now`.
    const expected = planDrillSchedule([], new Date(now));
    expect(res.body.schedule).toEqual(expected);
    expect(res.body.schedule.every((e: { overdue: boolean }) => e.overdue)).toBe(true);
    expect(res.body.schedule).toHaveLength(listDrillScripts().length);
  });

  it('200 computes nextRecommendedAt from the last execution', async () => {
    const now = '2026-06-01T00:00:00.000Z';
    const past = [
      {
        scenarioId: 'drill_monthly_primary',
        executedAt: '2026-05-20T00:00:00.000Z',
        verdict: 'excellent' as const,
      },
    ];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ pastExecutions: past, now });
    expect(res.status).toBe(200);
    const expected = planDrillSchedule(past, new Date(now));
    expect(res.body.schedule).toEqual(expected);
    const monthly = res.body.schedule.find(
      (e: { scenarioId: string }) => e.scenarioId === 'drill_monthly_primary',
    );
    // 30-day interval from 2026-05-20 → 2026-06-19, not yet overdue at 2026-06-01.
    expect(monthly.lastExecutedAt).toBe('2026-05-20T00:00:00.000Z');
    expect(monthly.nextRecommendedAt).toBe('2026-06-19T00:00:00.000Z');
    expect(monthly.overdue).toBe(false);
  });

  it('200 halves the interval after a failed verdict', async () => {
    const now = '2026-07-01T00:00:00.000Z';
    const past = [
      {
        scenarioId: 'drill_monthly_primary',
        executedAt: '2026-05-20T00:00:00.000Z',
        verdict: 'failed' as const,
      },
    ];
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ pastExecutions: past, now });
    expect(res.status).toBe(200);
    expect(res.body.schedule).toEqual(planDrillSchedule(past, new Date(now)));
    const monthly = res.body.schedule.find(
      (e: { scenarioId: string }) => e.scenarioId === 'drill_monthly_primary',
    );
    // 30 → 15 days from 2026-05-20 → 2026-06-04; overdue at 2026-07-01.
    expect(monthly.nextRecommendedAt).toBe('2026-06-04T00:00:00.000Z');
    expect(monthly.overdue).toBe(true);
    expect(monthly.daysOverdue).toBe(27);
  });

  it('400 on invalid body (bad verdict enum)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        pastExecutions: [
          {
            scenarioId: 'drill_monthly_primary',
            executedAt: '2026-05-20T00:00:00.000Z',
            verdict: 'mediocre',
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body (pastExecutions not an array)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ pastExecutions: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/comms-drills/plan-schedule')
      .set(uid)
      .send({ pastExecutions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
