// Real-router supertest for the B17 admin role gate on externalAuditPortal.
//
// The 4 admin endpoints (create / admin/list / :id/revoke / :id/access-log)
// manage external-auditor portals (a portal grants an outside party scoped read
// access to a tenant's compliance data). They had verifyAuth but NO role gate,
// so any authenticated tenant user could operate them (privilege escalation).
// This exercises the REAL router and asserts the admin-role gate
// (assertAdminCaller → isAdminRole(customClaims.role)).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  roles: {} as Record<string, string | undefined>,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  // Server-authoritative role comes from Firebase Auth custom claims.
  const auth = {
    getUser: async (uid: string) => ({ uid, customClaims: { role: H.roles[uid] } }),
  };
  return adminMock(() => H.db!, auth);
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => {}),
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import auditPortalRouter from '../../server/routes/externalAuditPortal.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', auditPortalRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const TENANT = 'tenant-x';
const ADMIN = 'admin1';
const WORKER = 'worker1';

const validCreateBody = {
  id: 'portal-1',
  auditorName: 'Auditor SUSESO',
  auditorAffiliation: 'suseso',
  scopeProjectIds: ['p1'],
  scopeModules: ['documents'],
  ttlDays: 30,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.roles = { admin1: 'admin', worker1: 'operario' };
  // tenantId resolution falls back to users/{uid}.tenantId.
  H.db._seed(`users/${ADMIN}`, { tenantId: TENANT });
  H.db._seed(`users/${WORKER}`, { tenantId: TENANT });
});

describe('externalAuditPortal — admin role gate (B17)', () => {
  it('401 when no token is provided', async () => {
    const res = await request(buildApp()).get('/api/audit-portal/admin/list');
    expect(res.status).toBe(401);
  });

  it('403 — non-admin cannot LIST portals', async () => {
    const res = await request(buildApp())
      .get('/api/audit-portal/admin/list')
      .set(asUser(WORKER));
    expect(res.status).toBe(403);
    expect((res.body as { error?: string }).error).toBe('forbidden_requires_admin');
  });

  it('403 — non-admin cannot CREATE a portal (even with a valid body)', async () => {
    const res = await request(buildApp())
      .post('/api/audit-portal/create')
      .set(asUser(WORKER))
      .send(validCreateBody);
    expect(res.status).toBe(403);
  });

  it('403 — non-admin cannot REVOKE a portal', async () => {
    const res = await request(buildApp())
      .post('/api/audit-portal/portal-1/revoke')
      .set(asUser(WORKER))
      .send({ reason: 'token comprometido por canal inseguro' });
    expect(res.status).toBe(403);
  });

  it('403 — non-admin cannot read the ACCESS-LOG', async () => {
    const res = await request(buildApp())
      .get('/api/audit-portal/portal-1/access-log')
      .set(asUser(WORKER));
    expect(res.status).toBe(403);
  });

  it('admin passes the gate — list returns 200', async () => {
    const res = await request(buildApp())
      .get('/api/audit-portal/admin/list')
      .set(asUser(ADMIN));
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { portals?: unknown[] }).portals)).toBe(true);
  });

  it('admin can create a portal (gate passes → 201, one-time token returned)', async () => {
    const res = await request(buildApp())
      .post('/api/audit-portal/create')
      .set(asUser(ADMIN))
      .send(validCreateBody);
    expect(res.status).toBe(201);
    expect((res.body as { portal: { oneTimeAccessToken?: string } }).portal.oneTimeAccessToken).toBeTruthy();
  });
});
