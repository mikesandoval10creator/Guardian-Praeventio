// Real-router supertest for the gamification + AI safety-coach endpoints
// (src/server/routes/gamification.ts). The sibling gamification.test.ts exercises
// the LEGACY parallel-copy test-server mirror (tenant-isolation only); this one
// mounts the ACTUAL production router so the real handler code is covered. The
// domain services (gamificationBackend, coachBackend) + audit are mocked, so this
// covers the HTTP contract: auth, per-endpoint orchestration, the tenant-scoping
// gate on /coach/chat, and the 500 error translation.

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
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));
vi.mock('../../server/middleware/assertProjectMemberMiddleware.js', () => ({
  assertProjectMemberFromBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => undefined),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../services/gamificationBackend.js', () => ({
  awardPoints: vi.fn(async () => undefined),
  getLeaderboard: vi.fn(async () => [{ uid: 'w1', points: 100 }]),
  checkMedalEligibility: vi.fn(async () => ['first_report']),
}));
vi.mock('../../services/coachBackend.js', () => ({
  getSafetyCoachResponse: vi.fn(async () => 'Mantén el orden y limpieza.'),
}));

import gamificationRouter from '../../server/routes/gamification.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { awardPoints, getLeaderboard } from '../../services/gamificationBackend.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', gamificationRouter);
  return app;
}

beforeEach(() => {
  vi.mocked(awardPoints).mockClear().mockResolvedValue(undefined);
  vi.mocked(getLeaderboard).mockClear().mockResolvedValue([{ uid: 'w1', points: 100 }] as never);
  H.db = createFakeFirestore();
});

describe('POST /gamification/points', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/gamification/points').send({ amount: 10 });
    expect(res.status).toBe(401);
  });

  it('200 awards the SERVER-defined points for a whitelisted reason (ignores client amount)', async () => {
    const res = await request(buildApp())
      .post('/api/gamification/points')
      .set('x-test-uid', 'w1')
      // Attacker tries to grant 999999 — the server must ignore it and use the
      // canonical value for 'training_completed' (50).
      .send({ amount: 999999, reason: 'training_completed' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, awarded: 50 });
    // The forged amount is NOT passed through; the server value (50) is.
    expect(vi.mocked(awardPoints)).toHaveBeenCalledWith('w1', 50, 'training_completed');
  });

  it('400 invalid_reason for a non-whitelisted reason (no self-grant)', async () => {
    const res = await request(buildApp())
      .post('/api/gamification/points')
      .set('x-test-uid', 'w1')
      .send({ amount: 10, reason: 'reported_hazard' }); // not in POINT_VALUES
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_reason');
    expect(vi.mocked(awardPoints)).not.toHaveBeenCalled();
  });

  it('400 invalid_reason for a server-only reason (stoppage_justified cannot be self-claimed)', async () => {
    const res = await request(buildApp())
      .post('/api/gamification/points')
      .set('x-test-uid', 'w1')
      // In POINT_VALUES, but only the stoppage-resolution flow may award it —
      // and to the DECLARER, not the caller. Self-claim must be rejected.
      .send({ reason: 'stoppage_justified' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_reason');
    expect(vi.mocked(awardPoints)).not.toHaveBeenCalled();
  });

  it('400 invalid_reason when no reason is supplied', async () => {
    const res = await request(buildApp())
      .post('/api/gamification/points')
      .set('x-test-uid', 'w1')
      .send({ amount: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_reason');
  });

  it('500 when the award service throws', async () => {
    vi.mocked(awardPoints).mockRejectedValueOnce(new Error('store down'));
    const res = await request(buildApp())
      .post('/api/gamification/points')
      .set('x-test-uid', 'w1')
      .send({ reason: 'quiz_passed' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('store down');
  });
});

describe('GET /gamification/leaderboard', () => {
  it('200 returns the leaderboard', async () => {
    const res = await request(buildApp())
      .get('/api/gamification/leaderboard')
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.leaderboard[0].points).toBe(100);
  });
});

describe('POST /gamification/check-medals', () => {
  it('200 returns newly-eligible medals', async () => {
    const res = await request(buildApp())
      .post('/api/gamification/check-medals')
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newMedals).toEqual(['first_report']);
  });
});

describe('POST /coach/chat (tenant-scoped)', () => {
  it('400 when projectId is missing (must be tenant-scoped)', async () => {
    const res = await request(buildApp())
      .post('/api/coach/chat')
      .set('x-test-uid', 'w1')
      .send({ message: '¿Cómo reporto un casi-accidente?' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('projectId is required');
  });

  it('200 returns the coach response when scoped to a project', async () => {
    H.db!._seed('user_stats/w1', { points: 50, medals: [], loginStreak: 2 });
    const res = await request(buildApp())
      .post('/api/coach/chat')
      .set('x-test-uid', 'w1')
      .send({ message: '¿Cómo reporto un casi-accidente?', projectId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.response).toMatch(/orden y limpieza/i);
  });
});
