// Real-router supertest for §104 Data Confidence panel (3 endpoints). Tells
// the prevencionista how much to trust the data feeding AI suggestions — so it
// must itself be trustworthy. Covers: snapshot assembly + persistence, the
// admin-only dismiss with issue-id hardening, and the recommendations feed.

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
    const role = req.header('x-test-role');
    (req as Request & { user: Record<string, unknown> }).user = { uid, ...(role ? { role } : {}) };
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
vi.mock('../../services/dataConfidence/dataConfidencePanel.js', () => ({
  buildDataConfidenceReport: vi.fn(() => ({ overallScore: 72, dimensions: {} })),
}));

import dcRouter from '../../server/routes/dataConfidence.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', dcRouter);
  return app;
}
const BASE = 'tenants/t1/projects/p1';

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('GET /:projectId/data-confidence (snapshot)', () => {
  it('401 / 403 / 404 gates', async () => {
    expect((await request(buildApp()).get('/api/sprint-k/p1/data-confidence')).status).toBe(401);

    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    expect(
      (await request(buildApp()).get('/api/sprint-k/p1/data-confidence').set('x-test-uid', 'u1')).status,
    ).toBe(403);

    H.db!._seed('projects/p1', { name: 'no-tenant' });
    expect(
      (await request(buildApp()).get('/api/sprint-k/p1/data-confidence').set('x-test-uid', 'u1')).status,
    ).toBe(404);
  });

  it('200 assembles the snapshot, scores domains, and persists today\'s point', async () => {
    H.db!._seed(`${BASE}/workers/w1`, { name: 'Juan', role: 'op', crewId: 'c1', updatedAt: '2026-05-01' });
    H.db!._seed(`${BASE}/workers/w2`, { name: 'Ana' }); // incomplete → drags the score
    H.db!._seed(`${BASE}/incidents/i1`, { rootCause: 'fatiga' });

    const res = await request(buildApp()).get('/api/sprint-k/p1/data-confidence').set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({ overallScore: 72 });
    expect(Array.isArray(res.body.domains)).toBe(true);
    expect(res.body.domains.find((d: { name: string }) => d.name === 'workers').expected).toBe(2);
    // today's snapshot persisted under data_confidence_snapshots/<YYYY-MM-DD>
    const todayKey = new Date().toISOString().slice(0, 10);
    expect(H.db!._store.has(`${BASE}/data_confidence_snapshots/${todayKey}`)).toBe(true);
  });
});

describe('POST /:projectId/data-confidence/dismiss/:issueId', () => {
  it('403 when the caller lacks a dismiss role', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/data-confidence/dismiss/workers.score')
      .set('x-test-uid', 'u1') // no role
      .send({});
    expect(res.status).toBe(403);
  });

  it('400 for a malformed issueId (doc-id injection guard)', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/data-confidence/dismiss/..%2Fevil')
      .set('x-test-uid', 'u1')
      .set('x-test-role', 'admin')
      .send({});
    expect(res.status).toBe(400);
  });

  it('200 records the dismissal for an admin', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/data-confidence/dismiss/workers.score')
      .set('x-test-uid', 'admin1')
      .set('x-test-role', 'admin')
      .send({ reason: 'conocido y aceptado' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(H.db!._store.has(`${BASE}/data_confidence_dismissals/workers.score`)).toBe(true);
  });
});

describe('GET /:projectId/data-confidence/recommendations', () => {
  it('surfaces actionable recommendations for flagged data', async () => {
    H.db!._seed(`${BASE}/workers/w1`, { name: 'Sin Cargo' }); // role missing → flagged
    H.db!._seed(`${BASE}/incidents/i1`, { description: 'algo' }); // no rootCause → flagged
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/data-confidence/recommendations')
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const ids = (res.body.recommendations as { id: string }[]).map((r) => r.id);
    expect(ids).toContain('reco_workers_role');
    expect(ids).toContain('reco_incidents_root_cause');
  });
});
