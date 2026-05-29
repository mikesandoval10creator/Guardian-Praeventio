// Real-router supertest for F.26 prevention-maturity index. Reads 8 canonical
// collections, derives deterministic signals, and runs computeMaturityLevel +
// recommendNextSteps. Mounts the actual router via fakeFirestore; covers the
// guard, the multi-source signal assembly, the response envelope, and 500.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  compute: vi.fn(),
  recommend: vi.fn(),
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
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
vi.mock('../../services/maturity/preventionMaturityIndex.js', () => ({
  computeMaturityLevel: (...a: unknown[]) => H.compute(...a),
  recommendNextSteps: (...a: unknown[]) => H.recommend(...a),
}));

import maturityRouter from '../../server/routes/maturity.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', maturityRouter);
  return app;
}
const get = () =>
  request(buildApp()).get('/api/sprint-k/p1/maturity-index').set('x-test-uid', 'u1');
const recentISO = new Date(Date.now() - 30 * 86400000).toISOString();
// Seed two populated feeds so the insufficient-data gate (feedsAvailable < 2) passes.
function seedTwoFeeds() {
  H.db!._seed('incidents/i1', { projectId: 'p1', rootCause: 'fatiga', occurredAt: recentISO });
  H.db!._seed('projects/p1/training_assignments/t1', { workerUid: 'w1', status: 'completed' });
}

beforeEach(() => {
  H.compute.mockReset().mockReturnValue({ level: 3, label: 'Proactivo', categories: {} });
  H.recommend.mockReset().mockReturnValue(['Formalizar IPER', 'Aumentar observaciones']);
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', name: 'Faena', createdAt: '2024-01-01T00:00:00.000Z' });
});

describe('GET /api/sprint-k/:projectId/maturity-index', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sprint-k/p1/maturity-index');
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    expect((await get()).status).toBe(403);
  });

  it('404 when the tenant cannot be resolved', async () => {
    H.db!._seed('projects/p1', { name: 'no-tenant' });
    expect((await get()).status).toBe(404);
  });

  it('returns insufficientData when fewer than 2 feeds are populated', async () => {
    const res = await get(); // only the project doc is seeded → 0 feeds
    expect(res.status).toBe(200);
    expect(res.body.insufficientData).toBe(true);
    expect(H.compute).not.toHaveBeenCalled();
  });

  it('200 returns the maturity report envelope and runs the engine over assembled signals', async () => {
    seedTwoFeeds();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({ level: 3, label: 'Proactivo' });
    expect(res.body.recommendations).toEqual(['Formalizar IPER', 'Aumentar observaciones']);
    expect(res.body.signals).toBeTruthy();
    expect(res.body.metadata).toHaveProperty('feedsAvailable');
    // The engine is fed the derived signal bundle.
    expect(H.compute).toHaveBeenCalledTimes(1);
    const signals = H.compute.mock.calls[0]![0] as Record<string, unknown>;
    expect(signals).toHaveProperty('leadingIndicatorsUsed');
    expect(signals).toHaveProperty('rootCauseAnalysisRate');
    expect(H.recommend).toHaveBeenCalledWith(res.body.report);
  });

  it('500 when the engine throws', async () => {
    seedTwoFeeds();
    H.compute.mockImplementation(() => {
      throw new Error('engine boom');
    });
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});
