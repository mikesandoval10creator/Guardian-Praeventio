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
  // M-1: full custom-claim objects per uid (overrides `roles` when set) so
  // tests can pin that set-role PRESERVES non-role claims (tenantId, ...).
  claims: {} as Record<string, Record<string, unknown> | undefined>,
  // [P0][seguridad] Admin ops on a target uid now require caller + target to
  // share a tenant. Any uid not pinned in `claims` gets this default tenant, so
  // the standard "admin operates on a peer" cases stay same-tenant; cross-tenant
  // cases pin a target in a DIFFERENT tenant via `claims`.
  defaultTenant: 'tenant-A',
  setClaims: vi.fn(async (_uid: string, _claims: unknown) => {}),
  revoke: vi.fn(async (_uid: string) => {}),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const auth = {
    getUser: async (uid: string) => ({
      uid,
      customClaims: H.claims[uid] ?? { role: H.roles[uid], tenantId: H.defaultTenant },
    }),
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
import { replicateCriticalData } from '../../server/jobs/firestoreCriticalReplicate.js';
import { runWeeklyDigest } from '../../server/jobs/weeklyDigest.js';
import { runDailyClimateRiskScan } from '../../server/jobs/dailyClimateRiskScan.js';
import { resetQuota, topTenantsByUsage } from '../../services/observability/quotaTracker.js';

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
  H.claims = {};
  H.revoke.mockReset().mockResolvedValue(undefined as never);
  vi.mocked(replicateCriticalData).mockClear();
  vi.mocked(runWeeklyDigest).mockClear();
  vi.mocked(runDailyClimateRiskScan).mockClear();
  vi.mocked(resetQuota).mockClear();
  vi.mocked(topTenantsByUsage).mockClear();
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
    // set-role preserves the target's existing claims (incl. the default
    // tenant the getUser mock returns) and layers the new role on top.
    expect(H.setClaims).toHaveBeenCalledWith('u2', { role: 'prevencionista', tenantId: 'tenant-A' });
    expect(H.revoke).toHaveBeenCalledWith('u2'); // force re-auth
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
  });

  it('M-1: set-role PRESERVES existing custom claims (tenantId survives a role change)', async () => {
    // setCustomUserClaims OVERWRITES the whole claim object server-side; a bare
    // { role } here would silently drop the tenant binding and re-break the 61
    // tenant-guarded routers (audit 2026-07-02 §2). Pin the merge.
    // Same tenant as the admin caller (tenant-A) so the tenant guard allows the
    // op; the point of this test is that assignedSiteIds + tenantId SURVIVE.
    H.claims['u9'] = { role: 'worker', tenantId: 'tenant-A', assignedSiteIds: ['site-1'] };
    const res = await request(buildApp())
      .post('/api/admin/set-role')
      .set(asUser('admin1'))
      .send({ uid: 'u9', role: 'prevencionista' });
    expect(res.status).toBe(200);
    expect(H.setClaims).toHaveBeenCalledWith('u9', {
      role: 'prevencionista',
      tenantId: 'tenant-A',
      assignedSiteIds: ['site-1'],
    });
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

// ===========================================================================
// [P0][seguridad] Tenant intersection — an admin/gerente is a COMPANY admin,
// not a platform operator. Every op on a TARGET uid must stay in the caller's
// tenant, so admin-of-A cannot revoke/escalate/wipe-MFA a user in tenant B.
// ===========================================================================
describe('admin ops enforce tenant intersection on the target uid', () => {
  it('set-role: 403 when the target belongs to a different tenant (no claim mutation)', async () => {
    H.claims['victim-b'] = { role: 'operario', tenantId: 'tenant-B' };
    const res = await request(buildApp())
      .post('/api/admin/set-role')
      .set(asUser('admin1')) // admin1 → tenant-A (default)
      .send({ uid: 'victim-b', role: 'admin' });
    expect(res.status).toBe(403);
    expect(H.setClaims).not.toHaveBeenCalled();
    expect(H.revoke).not.toHaveBeenCalled();
  });

  it('revoke-access: 403 when the target belongs to a different tenant (no revoke)', async () => {
    H.claims['victim-b'] = { role: 'operario', tenantId: 'tenant-B' };
    const res = await request(buildApp())
      .post('/api/admin/revoke-access')
      .set(asUser('admin1'))
      .send({ targetUid: 'victim-b' });
    expect(res.status).toBe(403);
    expect(H.revoke).not.toHaveBeenCalled();
    expect(H.db!._store.has('user_sessions/victim-b')).toBe(false);
  });

  it('webauthn/revoke: 403 when the target belongs to a different tenant (keys untouched)', async () => {
    H.claims['victim-b'] = { role: 'operario', tenantId: 'tenant-B' };
    H.db!._seed('webauthn_credentials/b-key', {
      credentialId: 'b-key', uid: 'victim-b', publicKey: 'cHVi', counter: 0,
      transports: ['internal'], registeredAt: 1, lastUsedAt: null,
    });
    const res = await request(buildApp())
      .post('/api/admin/webauthn/revoke')
      .set(asUser('admin1'))
      .send({ targetUid: 'victim-b' });
    expect(res.status).toBe(403);
    expect(H.db!._store.has('webauthn_credentials/b-key')).toBe(true);
    expect(H.revoke).not.toHaveBeenCalled();
  });

  it('set-role: 403 when the CALLER has no tenant claim (no global platform admin yet)', async () => {
    // An admin whose claims OMIT tenantId cannot act on anyone — there is no
    // global platform_admin role, so a tenant-less admin is not a super-operator.
    H.claims['rootless-admin'] = { role: 'admin' };
    H.claims['u2'] = { role: 'worker', tenantId: 'tenant-A' };
    const res = await request(buildApp())
      .post('/api/admin/set-role')
      .set(asUser('rootless-admin'))
      .send({ uid: 'u2', role: 'admin' });
    expect(res.status).toBe(403);
    expect(H.setClaims).not.toHaveBeenCalled();
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

  it('200 even when the audit_logs write fails — audit is non-blocking (directive #14)', async () => {
    // Make ONLY the audit_logs write throw; everything else succeeds.
    const realCollection = H.db!.collection.bind(H.db!);
    const spy = vi
      .spyOn(H.db!, 'collection')
      .mockImplementation((path: string) =>
        path === 'audit_logs'
          ? ({ add: async () => { throw new Error('audit write boom'); } } as unknown as ReturnType<typeof realCollection>)
          : realCollection(path),
      );
    try {
      const res = await request(buildApp())
        .post('/api/admin/revoke-access')
        .set(asUser('admin1'))
        .send({ targetUid: 'victim2' });
      // The completed operation must NOT 500 just because the audit row failed.
      expect(res.status).toBe(200);
      expect(H.revoke).toHaveBeenCalledWith('victim2');
    } finally {
      spy.mockRestore();
    }
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

// ===========================================================================
// POST /api/admin/replicate-critical
// ===========================================================================
describe('POST /api/admin/replicate-critical', () => {
  it('401 without token', async () => {
    const res = await request(buildApp()).post('/api/admin/replicate-critical');
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller', async () => {
    const res = await request(buildApp())
      .post('/api/admin/replicate-critical')
      .set(asUser('worker1'));
    expect(res.status).toBe(403);
    expect(vi.mocked(replicateCriticalData)).not.toHaveBeenCalled();
  });

  it('200 admin: replicateCriticalData called + audit_logs row written', async () => {
    vi.mocked(replicateCriticalData).mockResolvedValueOnce({
      collections: [{ collection: 'audit_logs', docs: 2, path: 'gs://bucket/audit_logs.jsonl' }],
      window: '2026-05-31T00:00:00Z',
    } as never);
    const res = await request(buildApp())
      .post('/api/admin/replicate-critical')
      .set(asUser('admin1'));
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect(vi.mocked(replicateCriticalData)).toHaveBeenCalledTimes(1);
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
    const auditDoc = H.db!._store.get(auditKeys[0])!;
    expect(auditDoc.action).toBe('replicate_critical');
    expect(auditDoc.actor).toBe('admin1');
  });

  // AUDIT-2026-06 B19 — Cloud Scheduler reaches this WITHOUT a human Firebase
  // token. Before the fix the route used plain verifyAuth, so the scheduler
  // OIDC/secret call got 401 and the hourly DR replica never ran. Now the
  // scheduler credential is accepted and the machine actor is audited.
  it('200 scheduler (shared secret): runs as cloud-scheduler actor, no human token', async () => {
    const prev = process.env.SCHEDULER_SHARED_SECRET;
    process.env.SCHEDULER_SHARED_SECRET = 'cron-secret';
    try {
      vi.mocked(replicateCriticalData).mockResolvedValueOnce({
        collections: [],
        window: '2026-05-31T00:00:00Z',
      } as never);
      const res = await request(buildApp())
        .post('/api/admin/replicate-critical')
        .set('Authorization', 'Bearer cron-secret');
      expect(res.status).toBe(200);
      expect(vi.mocked(replicateCriticalData)).toHaveBeenCalledTimes(1);
      const auditDoc = [...H.db!._store.values()].find((d) => d.action === 'replicate_critical');
      expect(auditDoc?.actor).toBe('cloud-scheduler');
    } finally {
      if (prev === undefined) delete process.env.SCHEDULER_SHARED_SECRET;
      else process.env.SCHEDULER_SHARED_SECRET = prev;
    }
  });

  it('401 scheduler with wrong shared secret', async () => {
    const prev = process.env.SCHEDULER_SHARED_SECRET;
    process.env.SCHEDULER_SHARED_SECRET = 'cron-secret';
    try {
      const res = await request(buildApp())
        .post('/api/admin/replicate-critical')
        .set('Authorization', 'Bearer wrong');
      expect(res.status).toBe(401);
      expect(vi.mocked(replicateCriticalData)).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.SCHEDULER_SHARED_SECRET;
      else process.env.SCHEDULER_SHARED_SECRET = prev;
    }
  });
});

// ===========================================================================
// POST /api/admin/jobs/weekly-digest
// ===========================================================================
describe('POST /api/admin/jobs/weekly-digest', () => {
  it('401 without token', async () => {
    const res = await request(buildApp()).post('/api/admin/jobs/weekly-digest');
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller', async () => {
    const res = await request(buildApp())
      .post('/api/admin/jobs/weekly-digest')
      .set(asUser('worker1'));
    expect(res.status).toBe(403);
    expect(vi.mocked(runWeeklyDigest)).not.toHaveBeenCalled();
  });

  it('200 full run (no projectIds): calls runWeeklyDigest with undefined + audit logged', async () => {
    vi.mocked(runWeeklyDigest).mockResolvedValueOnce({
      windowStart: '2026-05-25T00:00:00Z',
      windowEnd: '2026-05-31T23:59:59Z',
      projectsProcessed: 5,
      projectsSent: 4,
      totalEmailsSent: 10,
      totalEmailErrors: 0,
    } as never);
    const res = await request(buildApp())
      .post('/api/admin/jobs/weekly-digest')
      .set(asUser('admin1'))
      .send({});
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect(vi.mocked(runWeeklyDigest)).toHaveBeenCalledWith({ projectIds: undefined });
    const auditDoc = [...H.db!._store.values()].find((d) => d.action === 'weekly_digest_run');
    expect(auditDoc?.actor).toBe('admin1');
  });

  it('200 ad-hoc replay: non-string items filtered, string slice forwarded', async () => {
    vi.mocked(runWeeklyDigest).mockResolvedValueOnce({} as never);
    const res = await request(buildApp())
      .post('/api/admin/jobs/weekly-digest')
      .set(asUser('admin1'))
      .send({ projectIds: ['p1', 99, null, 'p2'] });
    expect(res.status).toBe(200);
    expect(vi.mocked(runWeeklyDigest)).toHaveBeenCalledWith({ projectIds: ['p1', 'p2'] });
  });
});

// ===========================================================================
// POST /api/admin/jobs/climate-scan
// ===========================================================================
describe('POST /api/admin/jobs/climate-scan', () => {
  it('401 without token', async () => {
    const res = await request(buildApp()).post('/api/admin/jobs/climate-scan');
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller', async () => {
    const res = await request(buildApp())
      .post('/api/admin/jobs/climate-scan')
      .set(asUser('worker1'));
    expect(res.status).toBe(403);
    expect(vi.mocked(runDailyClimateRiskScan)).not.toHaveBeenCalled();
  });

  it('200 admin: runDailyClimateRiskScan called with wired deps', async () => {
    vi.mocked(runDailyClimateRiskScan).mockResolvedValueOnce({
      projectsScanned: 1, nodesWritten: 2, fcmSent: 0, fcmFailed: 0,
    } as never);
    const res = await request(buildApp())
      .post('/api/admin/jobs/climate-scan')
      .set(asUser('admin1'));
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect(vi.mocked(runDailyClimateRiskScan)).toHaveBeenCalledTimes(1);
    // deps arg is the first positional — it must be an object with the expected callbacks
    const deps = vi.mocked(runDailyClimateRiskScan).mock.calls[0][0];
    expect(typeof (deps as unknown as Record<string, unknown>).listActiveProjects).toBe('function');
    expect(typeof (deps as unknown as Record<string, unknown>).audit).toBe('function');
  });
});

// ===========================================================================
// GET /api/admin/quotas/global
// ===========================================================================
describe('GET /api/admin/quotas/global', () => {
  it('401 without token', async () => {
    const res = await request(buildApp()).get('/api/admin/quotas/global');
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller', async () => {
    const res = await request(buildApp()).get('/api/admin/quotas/global').set(asUser('worker1'));
    expect(res.status).toBe(403);
  });

  it('400 invalid date format', async () => {
    const res = await request(buildApp())
      .get('/api/admin/quotas/global?date=not-a-date')
      .set(asUser('admin1'));
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/Invalid date/);
  });

  it('200 default limit=10 when omitted', async () => {
    vi.mocked(topTenantsByUsage).mockResolvedValueOnce([{ tenantId: 't1', usd: 5 }] as never);
    const res = await request(buildApp())
      .get('/api/admin/quotas/global?date=2026-05-31')
      .set(asUser('admin1'));
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect(vi.mocked(topTenantsByUsage)).toHaveBeenCalledWith('2026-05-31', 10);
  });

  it('200 respects ?limit param; out-of-range (>100) falls back to 10', async () => {
    vi.mocked(topTenantsByUsage).mockResolvedValue([] as never);
    const r5 = await request(buildApp())
      .get('/api/admin/quotas/global?date=2026-05-31&limit=5')
      .set(asUser('admin1'));
    expect(r5.status).toBe(200);
    expect(vi.mocked(topTenantsByUsage)).toHaveBeenLastCalledWith('2026-05-31', 5);

    const rBig = await request(buildApp())
      .get('/api/admin/quotas/global?date=2026-05-31&limit=999')
      .set(asUser('admin1'));
    expect(rBig.status).toBe(200);
    expect(vi.mocked(topTenantsByUsage)).toHaveBeenLastCalledWith('2026-05-31', 10);
  });
});

// ===========================================================================
// POST /api/admin/quotas/reset
// ===========================================================================
describe('POST /api/admin/quotas/reset', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quotas/reset')
      .send({ tenantId: 'tenant-abc', date: '2026-05-31' });
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quotas/reset')
      .set(asUser('worker1'))
      .send({ tenantId: 'tenant-abc', date: '2026-05-31' });
    expect(res.status).toBe(403);
    expect(vi.mocked(resetQuota)).not.toHaveBeenCalled();
  });

  it('400 missing / invalid tenantId', async () => {
    const noId = await request(buildApp())
      .post('/api/admin/quotas/reset')
      .set(asUser('admin1'))
      .send({ date: '2026-05-31' });
    expect(noId.status).toBe(400);
    expect((noId.body as Record<string, unknown>).error).toMatch(/Invalid tenantId/);
  });

  it('400 invalid date format', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quotas/reset')
      .set(asUser('admin1'))
      .send({ tenantId: 'tenant-abc', date: 'baddate' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/Invalid date/);
  });

  it('200 admin: resetQuota called + audit_logs row written', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quotas/reset')
      .set(asUser('admin1'))
      .send({ tenantId: 'tenant-abc', date: '2026-05-31' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect((res.body as Record<string, unknown>).tenantId).toBe('tenant-abc');
    expect(vi.mocked(resetQuota)).toHaveBeenCalledWith('tenant-abc', '2026-05-31');
    const auditDoc = [...H.db!._store.values()].find((d) => d.action === 'quota_reset');
    expect(auditDoc?.target).toBe('tenant-abc');
    expect(auditDoc?.date).toBe('2026-05-31');
    expect(auditDoc?.actor).toBe('admin1');
  });
});

// ===========================================================================
// POST /api/admin/webauthn/revoke — admin-assisted MFA recovery (B17)
// ===========================================================================
describe('POST /api/admin/webauthn/revoke', () => {
  function seedKeys() {
    H.db!._seed('webauthn_credentials/v-key-1', {
      credentialId: 'v-key-1', uid: 'victim', publicKey: 'cHVi', counter: 3,
      transports: ['internal'], registeredAt: 1, lastUsedAt: null,
    });
    H.db!._seed('webauthn_credentials/v-key-2', {
      credentialId: 'v-key-2', uid: 'victim', publicKey: 'cHVi', counter: 0,
      transports: ['usb'], registeredAt: 2, lastUsedAt: null,
    });
    H.db!._seed('webauthn_credentials/other-key', {
      credentialId: 'other-key', uid: 'someone-else', publicKey: 'cHVi', counter: 1,
      transports: ['internal'], registeredAt: 3, lastUsedAt: null,
    });
  }

  it('401 without token', async () => {
    const res = await request(buildApp()).post('/api/admin/webauthn/revoke').send({ targetUid: 'victim' });
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller (cannot revoke another user\'s keys)', async () => {
    seedKeys();
    const res = await request(buildApp())
      .post('/api/admin/webauthn/revoke')
      .set(asUser('worker1'))
      .send({ targetUid: 'victim' });
    expect(res.status).toBe(403);
    expect(H.db!._store.has('webauthn_credentials/v-key-1')).toBe(true); // nothing deleted
    expect(H.revoke).not.toHaveBeenCalled();
  });

  it('400 invalid uid', async () => {
    const res = await request(buildApp())
      .post('/api/admin/webauthn/revoke')
      .set(asUser('admin1'))
      .send({ targetUid: 'has spaces' });
    expect(res.status).toBe(400);
  });

  it('200 admin revokes a SINGLE credential (owned) + audit + token revoke', async () => {
    seedKeys();
    const res = await request(buildApp())
      .post('/api/admin/webauthn/revoke')
      .set(asUser('admin1'))
      .send({ targetUid: 'victim', credentialId: 'v-key-1' });
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(1);
    expect(H.db!._store.has('webauthn_credentials/v-key-1')).toBe(false); // deleted
    expect(H.db!._store.has('webauthn_credentials/v-key-2')).toBe(true);  // other key kept
    expect(H.revoke).toHaveBeenCalledWith('victim');
    const audit = [...H.db!._store.values()].find((d) => d.action === 'webauthn.admin_revoke');
    expect(audit?.target).toBe('victim');
    expect(audit?.actor).toBe('admin1');
  });

  it('404 when the credentialId is not registered to the target user (no cross-user delete)', async () => {
    seedKeys();
    const res = await request(buildApp())
      .post('/api/admin/webauthn/revoke')
      .set(asUser('admin1'))
      .send({ targetUid: 'victim', credentialId: 'other-key' }); // belongs to someone-else
    expect(res.status).toBe(404);
    expect(H.db!._store.has('webauthn_credentials/other-key')).toBe(true); // untouched
  });

  it('200 admin revokes ALL of a user\'s keys when no credentialId is given', async () => {
    seedKeys();
    const res = await request(buildApp())
      .post('/api/admin/webauthn/revoke')
      .set(asUser('admin1'))
      .send({ targetUid: 'victim' });
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);
    expect(H.db!._store.has('webauthn_credentials/v-key-1')).toBe(false);
    expect(H.db!._store.has('webauthn_credentials/v-key-2')).toBe(false);
    expect(H.db!._store.has('webauthn_credentials/other-key')).toBe(true); // other user's untouched
    expect(H.revoke).toHaveBeenCalledWith('victim');
  });
});

// ===========================================================================
// GET /api/admin/circuit-state
// ===========================================================================
describe('GET /api/admin/circuit-state', () => {
  it('401 without token', async () => {
    const res = await request(buildApp()).get('/api/admin/circuit-state');
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller', async () => {
    const res = await request(buildApp()).get('/api/admin/circuit-state').set(asUser('worker1'));
    expect(res.status).toBe(403);
  });

  it('200 admin: returns thresholds + snapshot', async () => {
    const res = await request(buildApp()).get('/api/admin/circuit-state').set(asUser('admin1'));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const thresholds = body.thresholds as Record<string, unknown>;
    expect(thresholds.threshold).toBe(5);
    expect(thresholds.windowMs).toBe(1000);
    expect(thresholds.openDurationMs).toBe(1000);
    expect(body.state).toEqual({ state: 'closed' });
  });
});

// ===========================================================================
// POST /api/admin/sync/clear-user-queue
// ===========================================================================
describe('POST /api/admin/sync/clear-user-queue', () => {
  it('401 without token', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sync/clear-user-queue')
      .send({ targetUid: 'user-42' });
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sync/clear-user-queue')
      .set(asUser('worker1'))
      .send({ targetUid: 'user-42' });
    expect(res.status).toBe(403);
  });

  it('400 missing / invalid targetUid', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sync/clear-user-queue')
      .set(asUser('admin1'))
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/Invalid targetUid/);
  });

  it('200 admin: user_sync_state.clearRequested set + audit_logs row written', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sync/clear-user-queue')
      .set(asUser('admin1'))
      .send({ targetUid: 'user-42' });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect((res.body as Record<string, unknown>).targetUid).toBe('user-42');

    const syncDoc = H.db!._store.get('user_sync_state/user-42');
    expect(syncDoc?.clearRequested).toBe(true);
    expect(syncDoc?.clearRequestedBy).toBe('admin1');

    const auditDoc = [...H.db!._store.values()].find((d) => d.action === 'sync_clear_user_queue');
    expect(auditDoc?.target).toBe('user-42');
    expect(auditDoc?.actor).toBe('admin1');
  });

  it('200 stuckUsers sorted desc by pendingCount and capped at 25', async () => {
    // Seed 30 failed users
    for (let i = 0; i < 30; i++) {
      H.db!._seed(`user_sync_state/uid-fail-${i}`, {
        pendingCount: i + 1,
        state: 'online_failed',
      });
    }
    // Trigger via sync/stats to verify the cap (clear-user-queue itself doesn't aggregate)
    const res = await request(buildApp()).get('/api/admin/sync/stats').set(asUser('admin1'));
    expect(res.status).toBe(200);
    const stuck = (res.body as Record<string, unknown>).stuckUsers as Array<Record<string, unknown>>;
    expect(stuck.length).toBe(25);
    // Sorted descending: first entry should have highest pendingCount
    expect((stuck[0].pendingCount as number) >= (stuck[1].pendingCount as number)).toBe(true);
  });
});
