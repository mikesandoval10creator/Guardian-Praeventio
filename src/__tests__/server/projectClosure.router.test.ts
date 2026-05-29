// Real-router supertest for the project-closure lifecycle (6 endpoints). The
// critical safety logic: a project with OPEN incidents/actions/permits CANNOT
// be finalized (422 blockers_present) — closing a faena with unresolved safety
// items would erase accountability. Mounted via fakeFirestore (with .count()
// aggregation support); LessonsAdapter + buildSummary mocked. (Sibling
// projectClosure.test.ts covers the pure service; this covers the real router.)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  save: vi.fn(),
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
vi.mock('../../server/middleware/validate.js', () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
vi.mock('../../services/lessonsLearned/lessonsFirestoreAdapter.js', () => ({
  LessonsAdapter: class {
    save = (...a: unknown[]) => H.save(...a);
  },
}));
vi.mock('../../services/projectClosure/projectClosureService.js', () => ({
  buildSummary: vi.fn((audience: string) => ({ headline: `Resumen ${audience}`, sections: [] })),
}));

import closureRouter from '../../server/routes/projectClosure.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', closureRouter);
  return app;
}
const STATE = 'tenants/t1/projects/p1/closure/state';
const uid = { 'x-test-uid': 'u1' };
const ep = (p: string) => `/api/sprint-k/p1/closure/${p}`;

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.save.mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('GET status', () => {
  it('401 / 403 gates', async () => {
    expect((await request(buildApp()).get(ep('status'))).status).toBe(401);
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    expect((await request(buildApp()).get(ep('status')).set(uid)).status).toBe(403);
  });

  it('canClose=false with blockers (open incident drags readiness)', async () => {
    H.db!._seed('incidents/i1', { projectId: 'p1', status: 'open' });
    const res = await request(buildApp()).get(ep('status')).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.canClose).toBe(false);
    expect(res.body.blockers.length).toBeGreaterThan(0);
    expect(res.body.readinessPercent).toBeLessThan(100);
  });

  it('canClose=true when there are no blockers', async () => {
    expect((await request(buildApp()).get(ep('status')).set(uid)).body.canClose).toBe(true);
  });
});

describe('lifecycle state machine', () => {
  it('initiate sets status=initiated; 409 once finalized', async () => {
    const ok = await request(buildApp()).post(ep('initiate')).set(uid).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.state.status).toBe('initiated');
    H.db!._seed(STATE, { status: 'finalized' });
    expect((await request(buildApp()).post(ep('initiate')).set(uid).send({})).status).toBe(409);
  });

  it('lessons capture publishes via LessonsAdapter; 409 once finalized', async () => {
    const ok = await request(buildApp()).post(ep('lessons')).set(uid)
      .send({ summary: 'Usar línea de vida', preventiveAction: 'Inspección diaria', industry: 'construccion' });
    expect(ok.status).toBe(201);
    expect(H.save).toHaveBeenCalledTimes(1);
    H.db!._seed(STATE, { status: 'finalized' });
    expect((await request(buildApp()).post(ep('lessons')).set(uid)
      .send({ summary: 'x'.repeat(5), preventiveAction: 'y'.repeat(5), industry: 'mineria' })).status).toBe(409);
  });

  it('decisions logs a critical decision (201)', async () => {
    const res = await request(buildApp()).post(ep('decisions')).set(uid)
      .send({ decidedAt: '2026-05-01', context: 'Parar faena por viento', decision: 'Suspender', outcome: 'positive' });
    expect(res.status).toBe(201);
    const keys = [...H.db!._store.keys()].filter((k) => k.includes('/closure/decisions/items/'));
    expect(keys.length).toBe(1);
  });
});

describe('finalize — the safety gate', () => {
  it('422 blockers_present when an incident is still open (cannot close unsafe)', async () => {
    H.db!._seed('incidents/i1', { projectId: 'p1', status: 'open' });
    const res = await request(buildApp()).post(ep('finalize')).set(uid).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('blockers_present');
    expect(H.db!._store.has(STATE)).toBe(false); // NOT finalized
  });

  it('422 when a corrective action is still in progress', async () => {
    H.db!._seed('tenants/t1/projects/p1/corrective_actions/a1', { status: 'in_progress' });
    expect((await request(buildApp()).post(ep('finalize')).set(uid).send({})).status).toBe(422);
  });

  it('200 finalizes when there are no blockers', async () => {
    const res = await request(buildApp()).post(ep('finalize')).set(uid).send({});
    expect(res.status).toBe(200);
    expect(res.body.state.status).toBe('finalized');
    expect((H.db!._dump()[STATE] as { finalizedByUid: string }).finalizedByUid).toBe('u1');
  });

  it('409 when already finalized', async () => {
    H.db!._seed(STATE, { status: 'finalized' });
    expect((await request(buildApp()).post(ep('finalize')).set(uid).send({})).status).toBe(409);
  });
});

describe('GET summary', () => {
  it('200 builds an audience-tailored summary with counts', async () => {
    H.db!._seed('incidents/i1', { projectId: 'p1', status: 'closed', severity: 'critical' });
    const res = await request(buildApp()).get(ep('summary?role=gerencia')).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.audience).toBe('management');
    expect(res.body.summary.headline).toContain('management');
    expect(res.body.counts.incidents).toBe(1);
    expect(res.body.counts.criticalIncidents).toBe(1);
  });
});
