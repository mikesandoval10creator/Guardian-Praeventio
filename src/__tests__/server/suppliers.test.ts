// Real-router supertest for §90-91 supplier quality + risk ranking. 5
// endpoints. Mounted via fakeFirestore; supplierScoring mocked so risk levels
// are deterministic. Covers list (+riskLevel filter, invalid query), create,
// embedded incident/audit append (404), and ranking.

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
// score: "Riesgosa" → 30 (high), otherwise 80 (low). Deterministic risk levels.
vi.mock('../../services/suppliers/supplierScoring.js', () => {
  const score = (r: { id: string; legalName: string }) => ({
    id: r.id,
    legalName: r.legalName,
    score: r.legalName.includes('Riesgosa') ? 30 : 80,
    breakdown: { safetyPerformance: 1, documentCompliance: 1, responsiveness: 1, reputation: 1 },
  });
  return {
    scoreSupplier: vi.fn(score),
    rankSuppliersByScore: vi.fn((records: { id: string; legalName: string }[]) =>
      records.map(score).sort((a, b) => b.score - a.score),
    ),
  };
});

import suppliersRouter from '../../server/routes/suppliers.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', suppliersRouter);
  return app;
}
const SUP = 'tenants/t1/projects/p1/suppliers';
const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('GET suppliers', () => {
  it('401 / 403 gates', async () => {
    expect((await request(buildApp()).get('/api/sprint-k/p1/suppliers')).status).toBe(401);
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    expect((await request(buildApp()).get('/api/sprint-k/p1/suppliers').set(uid)).status).toBe(403);
  });

  it('400 on an invalid riskLevel query', async () => {
    const res = await request(buildApp()).get('/api/sprint-k/p1/suppliers?riskLevel=bogus').set(uid);
    expect(res.status).toBe(400);
  });

  it('lists suppliers and filters by derived risk level', async () => {
    H.db!._seed(`${SUP}/s1`, { legalName: 'Constructora Segura', taxId: '1-1', services: ['obra'], incidents: [], audits: [] });
    H.db!._seed(`${SUP}/s2`, { legalName: 'Demoliciones Riesgosa', taxId: '2-2', services: ['demo'], incidents: [], audits: [] });
    const all = await request(buildApp()).get('/api/sprint-k/p1/suppliers').set(uid);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    const high = await request(buildApp()).get('/api/sprint-k/p1/suppliers?riskLevel=high').set(uid);
    expect(high.body.suppliers.map((s: { id: string }) => s.id)).toEqual(['s2']);
  });
});

describe('mutations', () => {
  it('POST creates a supplier (201)', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/suppliers')
      .set(uid)
      .send({ id: 's1', name: 'Proveedor X', taxId: '9-9', services: ['soldadura'] });
    expect(res.status).toBe(201);
    expect(res.body.supplier.legalName).toBe('Proveedor X');
    expect(H.db!._store.has(`${SUP}/s1`)).toBe(true);
  });

  it('POST incident appends to the supplier; 404 when missing', async () => {
    H.db!._seed(`${SUP}/s1`, { legalName: 'X', taxId: '1', services: [], incidents: [], audits: [] });
    const ok = await request(buildApp())
      .post('/api/sprint-k/p1/suppliers/s1/incidents')
      .set(uid)
      .send({ id: 'inc1', occurredAt: '2026-05-01T00:00:00Z', severity: 'incident', description: 'Caída de material' });
    expect(ok.status).toBe(201);
    const stored = H.db!._dump()[`${SUP}/s1`] as { incidents: unknown[] };
    expect(stored.incidents).toHaveLength(1);

    const missing = await request(buildApp())
      .post('/api/sprint-k/p1/suppliers/nope/incidents')
      .set(uid)
      .send({ id: 'inc2', occurredAt: '2026-05-01T00:00:00Z', severity: 'near_miss', description: 'casi' });
    expect(missing.status).toBe(404);
  });

  it('POST audit appends to the supplier', async () => {
    H.db!._seed(`${SUP}/s1`, { legalName: 'X', taxId: '1', services: [], incidents: [], audits: [] });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/suppliers/s1/audits')
      .set(uid)
      .send({ id: 'a1', auditedAt: '2026-05-01T00:00:00Z', documentComplianceRatio: 0.9, avgResponseHours: 4, reputationScore: 0.8 });
    expect(res.status).toBe(201);
    expect((H.db!._dump()[`${SUP}/s1`] as { audits: unknown[] }).audits).toHaveLength(1);
  });

  it('GET ranking returns scored + ranked suppliers', async () => {
    H.db!._seed(`${SUP}/s1`, { legalName: 'Constructora Segura', taxId: '1', services: [], incidents: [], audits: [] });
    H.db!._seed(`${SUP}/s2`, { legalName: 'Demoliciones Riesgosa', taxId: '2', services: [], incidents: [], audits: [] });
    const res = await request(buildApp()).get('/api/sprint-k/p1/suppliers/ranking').set(uid);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.ranking[0].rank).toBe(1);
    // higher score ranks first → the safe one
    expect(res.body.ranking[0].legalName).toBe('Constructora Segura');
  });
});
