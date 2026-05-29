// Real-router supertest for the admin privileged endpoints — the privilege-
// escalation surface. The security contract: the gate re-reads the caller's
// role from Firebase Auth custom claims (server-authoritative, NOT the client
// token claim), so a compromised/non-admin token can't escalate. This locks
// that in + covers set-role / revoke-access / quotas / sync. (The sibling
// admin.test.ts uses the parallel-copy harness; this mounts the real router.)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  roles: {} as Record<string, string | undefined>,
  setClaims: vi.fn(async (_uid: string, _claims: unknown) => {}),
  revoke: vi.fn(async (_uid: string) => {}),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const auth = {
    getUser: async (uid: string) => ({ uid, customClaims: { role: H.roles[uid] } }),
    setCustomUserClaims: (uid: string, claims: unknown) => H.setClaims(uid, claims),
    revokeRefreshTokens: (uid: string) => H.revoke(uid),
  };
  return adminMock(() => H.db!, auth);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    // NOTE: we deliberately set a CLIENT-claimed role here that differs from
    // the Auth record, to prove the route ignores it and re-reads from Auth.
    (req as Request & { user: Record<string, unknown> }).user = { uid, role: req.header('x-test-claim-role') ?? 'worker' };
    next();
  },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/analytics/serverAdapter.js', () => ({ serverAnalytics: { track: vi.fn(async () => {}) } }));
vi.mock('../../server/jobs/firestoreCriticalReplicate.js', () => ({ replicateCriticalData: vi.fn(async () => ({})) }));
vi.mock('../../server/jobs/weeklyDigest.js', () => ({ runWeeklyDigest: vi.fn(async () => ({})) }));
vi.mock('../../server/jobs/dailyClimateRiskScan.js', () => ({ runDailyClimateRiskScan: vi.fn(async () => ({})) }));
vi.mock('../../services/observability/quotaTracker.js', () => ({
  getUsage: vi.fn(async () => ({ tokensIn: 0, tokensOut: 0, usd: 0 })),
  resetQuota: vi.fn(async () => {}),
  topTenantsByUsage: vi.fn(async () => []),
  todayUtc: () => '2026-05-29',
}));
vi.mock('../../server/middleware/geminiCircuit.js', () => ({
  geminiCircuit: { THRESHOLD: 5, WINDOW_MS: 1000, OPEN_DURATION_MS: 1000, snapshot: () => ({ state: 'closed' }) },
}));

import adminRouter from '../../server/routes/admin.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}
// caller header helpers: x-test-uid is the uid; the Auth record's role comes
// from H.roles[uid]. x-test-claim-role is the (untrusted) client token claim.
const asUser = (uid: string) => ({ 'x-test-uid': uid });

beforeEach(() => {
  H.db = createFakeFirestore();
  H.roles = { admin1: 'admin', worker1: 'operario', gerente1: 'gerente' };
  H.setClaims.mockReset().mockResolvedValue(undefined as never);
  H.revoke.mockReset().mockResolvedValue(undefined as never);
});

describe('POST /api/admin/set-role — privilege escalation guard', () => {
  it('403 when a non-admin caller tries to set a role (no self-escalation)', async () => {
    const res = await request(buildApp())
      .post('/api/admin/set-role')
      .set(asUser('worker1'))
      // even claiming admin in the (untrusted) client token must not help:
      .set('x-test-claim-role', 'admin')
      .send({ uid: 'worker1', role: 'admin' });
    expect(res.status).toBe(403);
    expect(H.setClaims).not.toHaveBeenCalled(); // no mutation happened
  });

  it('200 for a real admin (claims set + tokens revoked + audit logged)', async () => {
    const res = await request(buildApp())
      .post('/api/admin/set-role')
      .set(asUser('admin1'))
      .send({ uid: 'u2', role: 'prevencionista' });
    expect(res.status).toBe(200);
    expect(H.setClaims).toHaveBeenCalledWith('u2', { role: 'prevencionista' });
    expect(H.revoke).toHaveBeenCalledWith('u2'); // force re-auth
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
  });

  it('400 invalid uid', async () => {
    const res = await request(buildApp())
      .post('/api/admin/set-role')
      .set(asUser('admin1'))
      .send({ uid: 'bad uid with spaces!', role: 'prevencionista' });
    expect(res.status).toBe(400);
  });

  it('400 invalid role (admin caller, bogus role) — and admin check runs first for non-admins', async () => {
    const adminBadRole = await request(buildApp())
      .post('/api/admin/set-role')
      .set(asUser('admin1'))
      .send({ uid: 'u2', role: 'supreme_overlord' });
    expect(adminBadRole.status).toBe(400);
    // a non-admin with a bogus role gets 403 (admin gate first), not 400 —
    // role validity is never leaked to non-admins.
    const workerBadRole = await request(buildApp())
      .post('/api/admin/set-role')
      .set(asUser('worker1'))
      .send({ uid: 'u2', role: 'supreme_overlord' });
    expect(workerBadRole.status).toBe(403);
  });
});

describe('POST /api/admin/revoke-access', () => {
  it('400 invalid uid; 403 non-admin; 200 admin (revokes + audits)', async () => {
    const bad = await request(buildApp()).post('/api/admin/revoke-access').set(asUser('admin1')).send({ targetUid: 'x y' });
    expect(bad.status).toBe(400);

    const forbidden = await request(buildApp()).post('/api/admin/revoke-access').set(asUser('worker1')).send({ targetUid: 'victim' });
    expect(forbidden.status).toBe(403);
    expect(H.revoke).not.toHaveBeenCalled();

    const ok = await request(buildApp()).post('/api/admin/revoke-access').set(asUser('admin1')).send({ targetUid: 'victim' });
    expect(ok.status).toBe(200);
    expect(H.revoke).toHaveBeenCalledWith('victim');
    expect(H.db!._store.has('user_sessions/victim')).toBe(true);
  });
});

describe('admin observability endpoints (assertAdminCaller gate)', () => {
  it('GET /sync/stats: 403 non-admin, 200 admin with aggregates', async () => {
    H.db!._seed('user_sync_state/a', { pendingCount: 3, state: 'online_failed' });
    H.db!._seed('user_sync_state/b', { pendingCount: 0, state: 'idle' });
    const forbidden = await request(buildApp()).get('/api/admin/sync/stats').set(asUser('worker1'));
    expect(forbidden.status).toBe(403);
    const ok = await request(buildApp()).get('/api/admin/sync/stats').set(asUser('gerente1'));
    expect(ok.status).toBe(200);
    expect(ok.body.totalPending).toBe(3);
    expect(ok.body.usersFailed).toBe(1);
    expect(ok.body.stuckUsers[0].uid).toBe('a');
  });

  it('GET /quotas: 400 invalid tenantId, 200 admin', async () => {
    const bad = await request(buildApp()).get('/api/admin/quotas?tenantId=bad%20id').set(asUser('admin1'));
    expect(bad.status).toBe(400);
    const ok = await request(buildApp()).get('/api/admin/quotas?tenantId=t1').set(asUser('admin1'));
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });
});
