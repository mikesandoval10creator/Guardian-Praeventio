// Real-router supertest for F.6 offline-first inspections. Critical for the
// no-signal sync story: deferred writes from IndexedDB must be idempotent so a
// retry never double-counts. Covers the 3-way idempotency (dup→200,
// mismatch→409, completed→409) + transactional observation append. Mounted via
// fakeFirestore (its runTransaction backs the append).

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

import inspRouter from '../../server/routes/offlineInspections.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', inspRouter);
  return app;
}
const INSP = 'tenants/t1/projects/p1/inspections';
const uid = { 'x-test-uid': 'u1' };
const obs = (id: string) => `/api/sprint-k/p1/inspections/${id}/observations`;

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('GET list + start', () => {
  it('401 / 403 gates', async () => {
    expect((await request(buildApp()).get('/api/sprint-k/p1/inspections')).status).toBe(401);
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    expect((await request(buildApp()).get('/api/sprint-k/p1/inspections').set(uid)).status).toBe(403);
  });

  it('lists inspections filtered by status', async () => {
    H.db!._seed(`${INSP}/i1`, { status: 'in_progress', startedAt: '2026-05-02', observations: [] });
    H.db!._seed(`${INSP}/i2`, { status: 'completed', startedAt: '2026-05-01', observations: [] });
    const res = await request(buildApp()).get('/api/sprint-k/p1/inspections?status=completed').set(uid);
    expect(res.status).toBe(200);
    expect(res.body.inspections.map((i: { id: string }) => i.id)).toEqual(['i2']);
  });

  it('POST start creates a new inspection (201) and is idempotent on retry (200)', async () => {
    const body = { id: 'insp1', templateId: 'tpl', responsibleUid: 'r1' };
    const first = await request(buildApp()).post('/api/sprint-k/p1/inspections').set(uid).send(body);
    expect(first.status).toBe(201);
    expect(first.body.inspection.status).toBe('in_progress');
    const retry = await request(buildApp()).post('/api/sprint-k/p1/inspections').set(uid).send(body);
    expect(retry.status).toBe(200); // existing id → returns existing, no dup
  });
});

describe('POST observation — 3-way idempotency (transactional)', () => {
  beforeEach(() => {
    H.db!._seed(`${INSP}/i1`, {
      id: 'i1', templateId: 't', responsibleUid: 'r', status: 'in_progress',
      startedAt: '2026-05-01', startedBy: 'u1', observations: [],
    });
  });

  it('appends a new observation (201)', async () => {
    const res = await request(buildApp()).post(obs('i1')).set(uid).send({ observationId: 'o1', notes: 'grieta' });
    expect(res.status).toBe(201);
    const stored = H.db!._dump()[`${INSP}/i1`] as { observations: unknown[] };
    expect(stored.observations).toHaveLength(1);
  });

  it('same observationId + identical content → 200 duplicate (no double append)', async () => {
    H.db!._seed(`${INSP}/i1`, {
      id: 'i1', status: 'in_progress', startedAt: '2026-05-01', startedBy: 'u1',
      observations: [{ observationId: 'o1', notes: 'grieta', recordedAt: '2026-05-01', recordedBy: 'u1' }],
    });
    const res = await request(buildApp()).post(obs('i1')).set(uid).send({ observationId: 'o1', notes: 'grieta' });
    expect(res.status).toBe(200);
    const stored = H.db!._dump()[`${INSP}/i1`] as { observations: unknown[] };
    expect(stored.observations).toHaveLength(1); // not appended again
  });

  it('same observationId + different content → 409 id_conflict', async () => {
    H.db!._seed(`${INSP}/i1`, {
      id: 'i1', status: 'in_progress', startedAt: '2026-05-01', startedBy: 'u1',
      observations: [{ observationId: 'o1', notes: 'grieta', recordedAt: '2026-05-01', recordedBy: 'u1' }],
    });
    const res = await request(buildApp()).post(obs('i1')).set(uid).send({ observationId: 'o1', notes: 'OTRA COSA' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('observation_id_conflict');
  });

  it('404 for a missing inspection', async () => {
    const res = await request(buildApp()).post(obs('missing')).set(uid).send({ observationId: 'o1' });
    expect(res.status).toBe(404);
  });

  it('409 when adding a new observation to an already-completed inspection', async () => {
    H.db!._seed(`${INSP}/done`, { id: 'done', status: 'completed', startedAt: '2026-05-01', startedBy: 'u1', observations: [] });
    const res = await request(buildApp()).post(obs('done')).set(uid).send({ observationId: 'new1', notes: 'tarde' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('inspection_already_completed');
  });
});

describe('POST complete', () => {
  it('completes an in-progress inspection (200) and is idempotent', async () => {
    H.db!._seed(`${INSP}/i1`, { id: 'i1', status: 'in_progress', startedAt: '2026-05-01', startedBy: 'u1', observations: [] });
    const res = await request(buildApp()).post('/api/sprint-k/p1/inspections/i1/complete').set(uid).send({});
    expect(res.status).toBe(200);
    expect(res.body.inspection.status).toBe('completed');
    // idempotent retry
    const retry = await request(buildApp()).post('/api/sprint-k/p1/inspections/i1/complete').set(uid).send({});
    expect(retry.status).toBe(200);
  });

  it('404 completing a missing inspection', async () => {
    const res = await request(buildApp()).post('/api/sprint-k/p1/inspections/missing/complete').set(uid).send({});
    expect(res.status).toBe(404);
  });
});
