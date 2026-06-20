// Real-router supertest for the Organic structure (Crew/Process/Task) writers
// — the server is the single writer for the positive-XP economy so it can't be
// tampered with from a client. 8 endpoints. Mounted via fakeFirestore (its
// runTransaction + FieldValue.increment back the XP awards). processService +
// sentry mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  closeXp: vi.fn(),
  baseXp: vi.fn(),
  transition: vi.fn(),
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
vi.mock('../../server/middleware/assertProjectMemberMiddleware.js', () => ({
  assertProjectMemberFromBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
vi.mock('../../services/organic/processService.js', () => ({
  computeProcessCloseXp: (...a: unknown[]) => H.closeXp(...a),
  baseXpForProcessType: (...a: unknown[]) => H.baseXp(...a),
  checkStatusTransition: (...a: unknown[]) => H.transition(...a),
}));
vi.mock('../../services/observability/sentryAdapter.js', () => ({
  sentryAdapter: { addBreadcrumb: vi.fn() },
}));

import organicRouter from '../../server/routes/organic.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', organicRouter);
  return app;
}
const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.closeXp.mockReset().mockReturnValue(75);
  H.baseXp.mockReset().mockReturnValue(40);
  H.transition.mockReset().mockReturnValue({ ok: true });
  H.db = createFakeFirestore();
});

describe('crews', () => {
  it('POST /crews creates a crew (201) and dedupes memberUids', async () => {
    const res = await request(buildApp())
      .post('/api/crews')
      .set(uid)
      .send({ projectId: 'p1', name: 'Cuadrilla A', memberUids: ['m1', 'm1', 'm2'] });
    expect(res.status).toBe(201);
    const stored = H.db!._dump()[`crews/${res.body.id}`] as { memberUids: string[]; xp: number };
    expect(stored.memberUids.sort()).toEqual(['m1', 'm2']);
    expect(stored.xp).toBe(0); // economy starts at 0, never negative
  });

  it('POST /crews writes a crew.created audit_log (CLAUDE.md #3)', async () => {
    const res = await request(buildApp())
      .post('/api/crews')
      .set(uid)
      .send({ projectId: 'p1', name: 'Cuadrilla A', memberUids: ['m1'] });
    expect(res.status).toBe(201);
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
    const log = H.db!._store.get(auditKeys[0]) as {
      action: string; module: string; userId: string; projectId: string | null;
      details: { crewId: string; projectId: string };
    };
    expect(log.action).toBe('crew.created');
    expect(log.module).toBe('organic');
    expect(log.userId).toBe('u1'); // stamped from token, not body
    expect(log.projectId).toBe('p1');
    expect(log.details.crewId).toBe(res.body.id);
  });

  it('POST /crews 400 on missing name', async () => {
    const res = await request(buildApp()).post('/api/crews').set(uid).send({ projectId: 'p1', memberUids: [] });
    expect(res.status).toBe(400);
  });

  it('POST /crews/:id/members adds a member; 404 for missing crew', async () => {
    H.db!._seed('crews/c1', { projectId: 'p1', memberUids: ['m1'] });
    const ok = await request(buildApp()).post('/api/crews/c1/members').set(uid).send({ memberUid: 'm2' });
    expect(ok.status).toBe(200);
    expect((H.db!._dump()['crews/c1'] as { memberUids: string[] }).memberUids).toContain('m2');
    const missing = await request(buildApp()).post('/api/crews/nope/members').set(uid).send({ memberUid: 'm2' });
    expect(missing.status).toBe(404);
  });
});

describe('processes + XP economy', () => {
  it('POST /processes 201 valid; 400 invalid type', async () => {
    const ok = await request(buildApp())
      .post('/api/processes')
      .set(uid)
      .send({ crewId: 'c1', projectId: 'p1', type: 'soldadura', name: 'Soldar viga' });
    expect(ok.status).toBe(201);
    const bad = await request(buildApp())
      .post('/api/processes')
      .set(uid)
      .send({ crewId: 'c1', projectId: 'p1', type: 'NOPE', name: 'x' });
    expect(bad.status).toBe(400);
  });

  it('POST /processes writes a process.started audit_log (CLAUDE.md #3)', async () => {
    const res = await request(buildApp())
      .post('/api/processes')
      .set(uid)
      .send({ crewId: 'c1', projectId: 'p1', type: 'soldadura', name: 'Soldar viga' });
    expect(res.status).toBe(201);
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
    const log = H.db!._store.get(auditKeys[0]) as {
      action: string; module: string; userId: string; projectId: string | null;
      details: { processId: string; crewId: string; projectId: string; type: string };
    };
    expect(log.action).toBe('process.started');
    expect(log.module).toBe('organic');
    expect(log.userId).toBe('u1'); // stamped from token, not body
    expect(log.projectId).toBe('p1');
    expect(log.details.processId).toBe(res.body.id);
    expect(log.details.crewId).toBe('c1');
    expect(log.details.type).toBe('soldadura');
  });

  it('POST /processes/:id/close awards crew XP atomically (positive economy)', async () => {
    H.db!._seed('processes/pr1', { projectId: 'p1', crewId: 'c1', type: 'soldadura', alertsResponded: 0, status: 'active' });
    H.db!._seed('crews/c1', { xp: 10, totalProcessesCompleted: 2 });
    const res = await request(buildApp()).post('/api/processes/pr1/close').set(uid).send({ complianceScore: 90 });
    expect(res.status).toBe(200);
    expect(res.body.xpAwarded).toBe(75);
    const crew = H.db!._dump()['crews/c1'] as { xp: number; totalProcessesCompleted: number };
    expect(crew.xp).toBe(85); // 10 + 75
    expect(crew.totalProcessesCompleted).toBe(3);
  });

  it('POST /processes/:id/close 409 when already terminal', async () => {
    H.db!._seed('processes/pr1', { projectId: 'p1', crewId: 'c1', type: 'soldadura', status: 'completed' });
    const res = await request(buildApp()).post('/api/processes/pr1/close').set(uid).send({ complianceScore: 90 });
    expect(res.status).toBe(409);
  });

  it('POST /processes/:id/status pauses + writes an audit log', async () => {
    H.db!._seed('processes/pr1', { projectId: 'p1', status: 'active' });
    const res = await request(buildApp()).post('/api/processes/pr1/status').set(uid).send({ status: 'paused' });
    expect(res.status).toBe(200);
    expect((H.db!._dump()['processes/pr1'] as { status: string }).status).toBe('paused');
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
  });

  it('POST /processes/:id/tasks 201 valid; 400 on bad date', async () => {
    H.db!._seed('processes/pr1', { projectId: 'p1', crewId: 'c1' });
    const ok = await request(buildApp())
      .post('/api/processes/pr1/tasks')
      .set(uid)
      .send({ description: 'Revisar arnés', date: '2026-05-29', assignedUids: ['m1'] });
    expect(ok.status).toBe(201);
    const bad = await request(buildApp())
      .post('/api/processes/pr1/tasks')
      .set(uid)
      .send({ description: 'x', date: 'ayer' });
    expect(bad.status).toBe(400);
  });
});

describe('predictive-alerts ack + tasks done', () => {
  it('POST /predictive-alerts/ack awards +30 XP (never negative)', async () => {
    H.db!._seed('crews/c1', { xp: 0, projectId: 'p1' });
    const res = await request(buildApp())
      .post('/api/predictive-alerts/ack')
      .set(uid)
      .send({ projectId: 'p1', crewId: 'c1', generatorId: 'gen1' });
    expect(res.status).toBe(200);
    expect(res.body.xpAwarded).toBe(30);
    expect((H.db!._dump()['crews/c1'] as { xp: number }).xp).toBe(30);
  });

  it('POST /tasks/:id/done marks done; 404 for missing task', async () => {
    H.db!._seed('tasks/t1', { projectId: 'p1', status: 'pending' });
    const ok = await request(buildApp()).post('/api/tasks/t1/done').set(uid).send({});
    expect(ok.status).toBe(200);
    expect((H.db!._dump()['tasks/t1'] as { status: string }).status).toBe('done');
    const missing = await request(buildApp()).post('/api/tasks/nope/done').set(uid).send({});
    expect(missing.status).toBe(404);
  });

  it('propagates 403 from project-membership checks', async () => {
    H.db!._seed('tasks/t1', { projectId: 'p1', status: 'pending' });
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await request(buildApp()).post('/api/tasks/t1/done').set(uid).send({});
    expect(res.status).toBe(403);
  });
});

describe('roster (GET /projects/:projectId/roster)', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp()).get('/api/projects/p1/roster');
    expect(res.status).toBe(401);
  });

  it('200 returns deduped, name-resolved, sorted roster from the project crews', async () => {
    H.db!._seed('crews/c1', { projectId: 'p1', memberUids: ['m2', 'm1'] });
    H.db!._seed('crews/c2', { projectId: 'p1', memberUids: ['m1', 'm3'] }); // m1 deduped across crews
    H.db!._seed('crews/cX', { projectId: 'other', memberUids: ['z9'] }); // other project excluded
    H.db!._seed('users/m1', { displayName: 'Ana' });
    H.db!._seed('users/m2', { displayName: 'Bruno' });
    // m3 has no users doc → fullName falls back to the uid (honest, not fabricated)
    const res = await request(buildApp()).get('/api/projects/p1/roster').set(uid);
    expect(res.status).toBe(200);
    expect(res.body.roster).toEqual([
      { uid: 'm1', fullName: 'Ana' },
      { uid: 'm2', fullName: 'Bruno' },
      { uid: 'm3', fullName: 'm3' },
    ]);
  });

  it('200 empty roster when the project has no crews (honest empty, not fabricated)', async () => {
    const res = await request(buildApp()).get('/api/projects/p1/roster').set(uid);
    expect(res.status).toBe(200);
    expect(res.body.roster).toEqual([]);
  });

  it('propagates 403 from project-membership checks', async () => {
    H.db!._seed('crews/c1', { projectId: 'p1', memberUids: ['m1'] });
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await request(buildApp()).get('/api/projects/p1/roster').set(uid);
    expect(res.status).toBe(403);
  });
});
