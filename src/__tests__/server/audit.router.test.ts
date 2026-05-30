// Real-router supertest for the audit-trail endpoints (ISO 45001 §10.2 — a real
// compliance trail). Mounts the ACTUAL router (src/server/routes/audit.ts)
// through the reusable fakeFirestore; the route had no real-router coverage.
//
// Two security properties are load-bearing and explicitly asserted:
//   1. POST /audit-log with a projectId requires membership — otherwise a
//      worker on project A could pollute project B's compliance trail.
//   2. GET /audit-log WITHOUT a projectId returns only the caller's OWN logs
//      (userId == caller) — you cannot read another user's trail. WITH a
//      projectId, membership is required.
// Also: the stored userId is server-stamped from the token, never the body.

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
    (req as Request & { user: { uid: string; email: string } }).user = { uid, email: `${uid}@t.cl` };
    next();
  },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import auditRouter from '../../server/routes/audit.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', auditRouter);
  return app;
}

const URL = '/api/audit-log';

function seedLog(id: string, fields: Record<string, unknown>) {
  H.db!._seed(`audit_logs/${id}`, fields);
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['w1'] });
});

describe('POST /api/audit-log (write trail)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send({ action: 'x', module: 'm' });
    expect(res.status).toBe(401);
  });

  it('400 when action is missing/empty', async () => {
    const res = await request(buildApp()).post(URL).set('x-test-uid', 'w1').send({ module: 'm' });
    expect(res.status).toBe(400);
  });

  it('400 when module is missing/empty', async () => {
    const res = await request(buildApp()).post(URL).set('x-test-uid', 'w1').send({ action: 'a' });
    expect(res.status).toBe(400);
  });

  it('403 SECURITY: a non-member cannot tag a log to another project', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'intruder')
      .send({ action: 'download', module: 'reports', projectId: 'p1' });
    expect(res.status).toBe(403);
  });

  it('200 + userId is server-stamped from the token, NOT the body', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'w1')
      .send({ action: 'sign_in', module: 'auth', userId: 'attacker-spoof' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const all = await H.db!.collection('audit_logs').get();
    const stored = (all.docs[0]?.data() ?? {}) as Record<string, unknown>;
    expect(stored.userId).toBe('w1'); // not 'attacker-spoof'
    expect(stored.action).toBe('sign_in');
  });
});

describe('GET /api/audit-log (read trail)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when reading a project trail the caller is not a member of', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp()).get(`${URL}?projectId=p1`).set('x-test-uid', 'intruder');
    expect(res.status).toBe(403);
  });

  it('200 SECURITY: without a projectId, returns ONLY the caller\'s own logs', async () => {
    seedLog('a1', { action: 'mine', module: 'm', userId: 'w1', projectId: null, timestamp: 2000 });
    seedLog('a2', { action: 'theirs', module: 'm', userId: 'someone-else', projectId: null, timestamp: 1000 });
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const actions = (res.body.entries as Array<{ userId: string; action: string }>).map((e) => e.action);
    expect(actions).toContain('mine');
    expect(actions).not.toContain('theirs');
    expect(res.body.entries.every((e: { userId: string }) => e.userId === 'w1')).toBe(true);
  });

  it('200 with a projectId (member) returns that project trail', async () => {
    seedLog('b1', { action: 'p1-evt', module: 'm', userId: 'x', projectId: 'p1', timestamp: 1000 });
    seedLog('b2', { action: 'p2-evt', module: 'm', userId: 'y', projectId: 'p2', timestamp: 2000 });
    const res = await request(buildApp()).get(`${URL}?projectId=p1`).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const actions = (res.body.entries as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('p1-evt');
    expect(actions).not.toContain('p2-evt');
  });

  it('caps limit at 100 and defaults sanely', async () => {
    const res = await request(buildApp()).get(`${URL}?limit=99999`).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
  });
});
