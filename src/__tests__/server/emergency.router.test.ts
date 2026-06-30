// Real-router supertest for src/server/routes/emergency.ts
// Plan v3 Fase 1 — coverage→90%. The existing emergency.test.ts is a
// parallel-copy harness (inlines its own handler logic) so it covers ~0% of
// the real route code. This file mounts the ACTUAL router and exercises both
// endpoints through the fakeFirestore real-router pattern used by
// misc.test.ts / systemEvents.test.ts / maintenance.test.ts.
//
// Endpoints under test:
//   POST /api/emergency/sos           — worker-initiated SOS alert
//   POST /api/emergency/notify-brigada — supervisor brigade activation
//
// Mount point: app.use('/api/emergency', emergencyRouter) in server.ts:895

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
// express-async-errors must be imported in the test process too — the real
// router is mounted on a local express() app, and the monkey-patch is per
// process, not per server.ts. This mirrors exactly what server.ts does so
// the guard-hang regression tests exercise the real fix path.
import 'express-async-errors';

// ── hoisted holder ───────────────────────────────────────────────────────────
// All variables referenced inside vi.mock() factories MUST be hoisted.

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // FCM: sendEachForMulticast spy — default resolves success
  fcmSendEach: vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] }),
  // Email service spy — null = RESEND_API_KEY absent (skip email)
  emailSendBatch: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
  emailEnabled: false,
}));

// ── firebase-admin mock ──────────────────────────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const fakeMessaging = {
    sendEachForMulticast: (...args: unknown[]) => H.fcmSendEach(...args),
  };
  const base = adminMock(() => H.db!);
  return {
    ...base,
    default: {
      ...base.default,
      messaging: () => fakeMessaging,
    },
    messaging: () => fakeMessaging,
  };
});

// ── verifyAuth: x-test-uid→user, absent→401 ─────────────────────────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@test.com`,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

// ── idempotencyKey: no-op in tests ───────────────────────────────────────────
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── sosLimiter: no-op in tests (rate-limit covered by parallel-copy test) ────
// We re-export sosLimiter from the module; mock the module so the limiter
// passes through without counting.
vi.mock('express-rate-limit', () => {
  const rateLimit = () => (_req: Request, _res: Response, next: NextFunction) => next();
  rateLimit.ipKeyGenerator = () => 'ip';
  return { default: rateLimit, ipKeyGenerator: () => 'ip' };
});

// ── logger ───────────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── captureRouteError ────────────────────────────────────────────────────────
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// ── tracedAsync: call-through (no OTel overhead in tests) ───────────────────
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: async (
    _name: string,
    _attrs: unknown,
    fn: () => unknown,
  ) => fn(),
}));

// ── assertProjectMember: honour the real fakeFirestore via projectMembership ─
// We do NOT mock assertProjectMember — we seed the DB so the real service
// reads `projects/{id}` and either resolves (member) or throws
// ProjectMembershipError (non-member / missing). This gives us genuine
// membership enforcement coverage.

// ── customClaims (imported by projectMembership §12.4.2 fast-path) ──────────
vi.mock('../../services/auth/customClaims.js', () => ({
  resolveAssignedSitesCheck: () => ({ resolved: false, member: false }),
}));

// ── EmailService ─────────────────────────────────────────────────────────────
vi.mock('../../services/email/resendService.js', () => ({
  EmailService: {
    fromEnv: () => (H.emailEnabled ? {
      sendBatch: (...args: unknown[]) => H.emailSendBatch(...args),
    } : null),
  },
}));
vi.mock('../../services/email/templates.js', () => ({
  sosBackupTemplate: () => '<html>SOS</html>',
}));

// ── import the REAL router AFTER mocks are set up ───────────────────────────
import emergencyRouter, { __clearUserTokenCache } from '../../server/routes/emergency.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── app factory ──────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/emergency', emergencyRouter);
  return app;
}

// Seed helpers
function seedProject(
  db: ReturnType<typeof createFakeFirestore>,
  projectId: string,
  {
    tenantId,
    createdBy,
    members = [],
    name,
  }: { tenantId?: string; createdBy?: string; members?: string[]; name?: string },
) {
  db._seed(`projects/${projectId}`, {
    tenantId: tenantId ?? projectId,
    createdBy: createdBy ?? members[0] ?? 'owner',
    members,
    name: name ?? projectId,
  });
}

function seedMember(
  db: ReturnType<typeof createFakeFirestore>,
  projectId: string,
  uid: string,
  role: string,
  extras: Record<string, unknown> = {},
) {
  db._seed(`projects/${projectId}/members/${uid}`, { role, ...extras });
}

function seedUserTokens(
  db: ReturnType<typeof createFakeFirestore>,
  uid: string,
  tokens: string[],
) {
  db._seed(`users/${uid}`, { fcmTokens: tokens });
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
  H.fcmSendEach.mockClear();
  H.emailSendBatch.mockClear();
  H.emailEnabled = false;
  __clearUserTokenCache();
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/emergency/sos
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/emergency/sos', () => {
  const SOS = '/api/emergency/sos';

  it('401 when no auth token is present', async () => {
    const res = await request(buildApp()).post(SOS).send({ type: 'sos', projectId: 'p1' });
    expect(res.status).toBe(401);
  });

  it('400 when type !== "sos"', async () => {
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'panic', projectId: 'p1' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_type');
  });

  it('400 when projectId is missing', async () => {
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_projectId');
  });

  it('400 when projectId is empty string', async () => {
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: '' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_projectId');
  });

  it('400 when projectId exceeds 128 chars', async () => {
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'x'.repeat(129) });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_projectId');
  });

  it('400 when timestamp is not a string', async () => {
    seedProject(H.db!, 'p1', { createdBy: 'u1', members: ['u1'] });
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1', timestamp: 12345 });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_timestamp');
  });

  it('400 when geo is provided but has invalid lat', async () => {
    seedProject(H.db!, 'p1', { createdBy: 'u1', members: ['u1'] });
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1', geo: { lat: 999, lng: 0 } });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_geo');
  });

  it('400 when geo has non-finite number', async () => {
    seedProject(H.db!, 'p1', { createdBy: 'u1', members: ['u1'] });
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1', geo: { lat: Infinity, lng: 0 } });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_geo');
  });

  it('403 when caller is not a project member', async () => {
    // Project exists but u1 is not createdBy and not in members[]
    seedProject(H.db!, 'p1', { createdBy: 'other', members: ['other'] });
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    // no project seeded at all → assertProjectMember throws ProjectMembershipError
    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'nonexistent' });
    expect(res.status).toBe(403);
  });

  it('200 happy path: alert written, audit logged, FCM sent to supervisor', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tenant-A', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'sup1', 'supervisor', { fcmToken: 'tok-sup1' });
    seedMember(H.db!, 'p1', 'op1', 'operario'); // should NOT receive push

    H.fcmSendEach.mockResolvedValueOnce({ successCount: 1, failureCount: 0, responses: [] });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({
        type: 'sos',
        projectId: 'p1',
        geo: { lat: -33.45, lng: -70.67 },
        timestamp: '2026-05-31T10:00:00Z',
      });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.alertId).toBe('string');
    expect(body.notified).toBe(1);
    expect(body.delivered).toBe(true); // a supervisor push landed

    // Alert doc written under tenants/{tenantId}/emergency_alerts/
    const alertKeys = [...H.db!._store.keys()].filter((k) =>
      k.startsWith('tenants/tenant-A/emergency_alerts/'),
    );
    expect(alertKeys).toHaveLength(1);
    const alertData = H.db!._store.get(alertKeys[0]) as Record<string, unknown>;
    expect(alertData.type).toBe('sos');
    expect(alertData.uid).toBe('u1');
    expect(alertData.userEmail).toBe('u1@test.com');
    expect(alertData.projectId).toBe('p1');
    expect(alertData.geo).toEqual({ lat: -33.45, lng: -70.67 });
    expect(alertData.clientTimestamp).toBe('2026-05-31T10:00:00Z');

    // Audit row written
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys).toHaveLength(1);
    const audit = H.db!._store.get(auditKeys[0]) as Record<string, unknown>;
    expect(audit.action).toBe('emergency.sos');
    expect(audit.userId).toBe('u1');
    expect(audit.projectId).toBe('p1');
    const details = audit.details as Record<string, unknown>;
    expect(details.hasGeo).toBe(true);

    // FCM called once with supervisor token
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
    const fcmCall = H.fcmSendEach.mock.calls[0][0] as Record<string, unknown>;
    expect((fcmCall.tokens as string[]).sort()).toContain('tok-sup1');
  });

  it('200: uses projectId as tenantId when project has no tenantId field', async () => {
    // seed project WITHOUT tenantId — route falls back to projectId
    H.db!._seed('projects/p-no-tenant', { createdBy: 'u1', members: ['u1'] });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p-no-tenant' });

    expect(res.status).toBe(200);
    const alertKeys = [...H.db!._store.keys()].filter((k) =>
      k.startsWith('tenants/p-no-tenant/emergency_alerts/'),
    );
    expect(alertKeys).toHaveLength(1);
  });

  it('200: null geo when geo is omitted', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    expect(res.status).toBe(200);
    const alertKeys = [...H.db!._store.keys()].filter((k) =>
      k.startsWith('tenants/tA/emergency_alerts/'),
    );
    const alertData = H.db!._store.get(alertKeys[0]) as Record<string, unknown>;
    expect(alertData.geo).toBeNull();

    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    const audit = H.db!._store.get(auditKeys[0]) as Record<string, unknown>;
    const details = audit.details as Record<string, unknown>;
    expect(details.hasGeo).toBe(false);
  });

  it('200 but delivered:false (zero-reach) when no supervisor tokens/emails — never falsely reassure', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'op1', 'operario'); // non-supervisor, no token, no email

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    // The alert is still recorded (ok:true) so a dispatcher can pick it up...
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(0);
    expect(body.emailedSupervisors).toBe(0);
    // ...but it reached NOBODY, so delivered MUST be false — the client uses this
    // to fall through to the tel: deeplink instead of a green success toast.
    expect(body.delivered).toBe(false);
    expect(H.fcmSendEach).not.toHaveBeenCalled();
  });

  it('200: cross-collection token lookup — canonical users/{uid}.fcmTokens merged and deduped', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    // Two supervisors: one with legacy fcmToken, one with only canonical tokens
    seedMember(H.db!, 'p1', 'supA', 'supervisor', { fcmToken: 'leg-tok-A' });
    seedMember(H.db!, 'p1', 'supB', 'gerente');
    // supA also has canonical tokens (union should dedupe leg-tok-A)
    seedUserTokens(H.db!, 'supA', ['leg-tok-A', 'new-tok-A']);
    seedUserTokens(H.db!, 'supB', ['tok-B1', 'tok-B2']);

    H.fcmSendEach.mockResolvedValueOnce({ successCount: 3, failureCount: 0, responses: [] });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
    const fcmCall = H.fcmSendEach.mock.calls[0][0] as Record<string, unknown>;
    const sentTokens = (fcmCall.tokens as string[]).sort();
    // 3 unique tokens: leg-tok-A / new-tok-A / tok-B1 / tok-B2
    expect(sentTokens).toEqual(['leg-tok-A', 'new-tok-A', 'tok-B1', 'tok-B2'].sort());
  });

  it('200: parallel fan-out collects EVERY supervisor\'s canonical tokens (no drops)', async () => {
    // The per-member users/{uid}.fcmTokens reads now run via Promise.all. The
    // failure mode of a bad parallelization is dropped tokens or a rejected
    // batch — seed several supervisors and assert the multicast carries the
    // full union, order-independent.
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'sup1', 'supervisor');
    seedMember(H.db!, 'p1', 'sup2', 'gerente');
    seedMember(H.db!, 'p1', 'sup3', 'supervisor');
    seedMember(H.db!, 'p1', 'op1', 'operario'); // non-supervisor → excluded
    seedUserTokens(H.db!, 'sup1', ['t1a', 't1b']);
    seedUserTokens(H.db!, 'sup2', ['t2a']);
    seedUserTokens(H.db!, 'sup3', ['t3a', 't3b']);
    seedUserTokens(H.db!, 'op1', ['should-not-send']);

    H.fcmSendEach.mockResolvedValueOnce({ successCount: 5, failureCount: 0, responses: [] });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
    const fcmCall = H.fcmSendEach.mock.calls[0][0] as Record<string, unknown>;
    const sentTokens = (fcmCall.tokens as string[]).sort();
    expect(sentTokens).toEqual(['t1a', 't1b', 't2a', 't3a', 't3b'].sort());
    expect(sentTokens).not.toContain('should-not-send');
  });

  it('200: email fallback sent when push has failures and supervisorEmails are present', async () => {
    H.emailEnabled = true;
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'], name: 'Proyecto Test' });
    seedMember(H.db!, 'p1', 'supA', 'supervisor', {
      fcmToken: 'tok-sup',
      email: 'sup@example.com',
    });
    // FCM: 1 success + 1 failure → shouldEmailFallback=true
    H.fcmSendEach.mockResolvedValueOnce({ successCount: 1, failureCount: 1, responses: [] });
    H.emailSendBatch.mockResolvedValueOnce({ sent: 1, failed: 0 });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    // emailedSupervisors should be 1
    expect(body.emailedSupervisors).toBe(1);
    expect(H.emailSendBatch).toHaveBeenCalledTimes(1);
  });

  it('200: email fallback when push completely fails (notified:0)', async () => {
    H.emailEnabled = true;
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'supA', 'supervisor', {
      fcmToken: 'tok-sup',
      email: 'sup@example.com',
    });
    H.fcmSendEach.mockResolvedValueOnce({ successCount: 0, failureCount: 1, responses: [] });
    H.emailSendBatch.mockResolvedValueOnce({ sent: 1, failed: 0 });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(H.emailSendBatch).toHaveBeenCalledTimes(1);
  });

  it('200: no email when RESEND_API_KEY absent (emailEnabled=false)', async () => {
    H.emailEnabled = false;
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'supA', 'supervisor', {
      fcmToken: 'tok-sup',
      email: 'sup@example.com',
    });
    H.fcmSendEach.mockResolvedValueOnce({ successCount: 0, failureCount: 1, responses: [] });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).emailedSupervisors).toBe(0);
    expect(H.emailSendBatch).not.toHaveBeenCalled();
  });

  it('200: FCM fan-out failure does NOT fail the SOS — alert still written', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'supA', 'supervisor', { fcmToken: 'tok-sup' });
    H.fcmSendEach.mockRejectedValueOnce(new Error('FCM network error'));

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    // Alert must succeed even though FCM threw
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    const alertKeys = [...H.db!._store.keys()].filter((k) =>
      k.startsWith('tenants/tA/emergency_alerts/'),
    );
    expect(alertKeys).toHaveLength(1);
    // notified should be 0 (fanout swallowed)
    expect((res.body as Record<string, unknown>).notified).toBe(0);
  });

  it('200: all supervisor roles (supervisor/gerente/prevencionista/admin) receive push', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'uSup', 'supervisor', { fcmToken: 'tok-supervisor' });
    seedMember(H.db!, 'p1', 'uGer', 'gerente', { fcmToken: 'tok-gerente' });
    seedMember(H.db!, 'p1', 'uPrev', 'prevencionista', { fcmToken: 'tok-prev' });
    seedMember(H.db!, 'p1', 'uAdm', 'admin', { fcmToken: 'tok-admin' });
    seedMember(H.db!, 'p1', 'uOp', 'operario', { fcmToken: 'tok-operario' }); // excluded

    H.fcmSendEach.mockResolvedValueOnce({ successCount: 4, failureCount: 0, responses: [] });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p1' });

    expect(res.status).toBe(200);
    const fcmCall = H.fcmSendEach.mock.calls[0][0] as Record<string, unknown>;
    const sentTokens = (fcmCall.tokens as string[]).sort();
    expect(sentTokens).toEqual([
      'tok-admin', 'tok-gerente', 'tok-prev', 'tok-supervisor',
    ]);
    expect(sentTokens).not.toContain('tok-operario');
  });

  it('200: caller identified as creator (no members[] entry needed)', async () => {
    // createdBy matches uid — assertProjectMember should pass via createdBy fast-path
    H.db!._seed('projects/p-creator', { tenantId: 'tC', createdBy: 'u1', members: [] });

    const res = await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p-creator' });

    expect(res.status).toBe(200);
  });

  // ── Guard-hang regression (express-async-errors) ──────────────────────────
  //
  // When Firestore is down, assertProjectMember inside the async handler throws
  // a non-ProjectMembershipError. Prior to express-async-errors being wired in
  // server.ts, Express 4 would HANG (the request never resolved) because async
  // route rejections were not forwarded to next(err). These tests assert that
  // the route returns 500 within the request — NOT a hang — even under outage.
  //
  // The app must have a terminal error handler so the error doesn't escape to
  // supertest as an unhandled promise rejection. We add a minimal one here.

  it('GUARD-HANG: Firestore outage on SOS path returns 500 (not hang)', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/emergency', emergencyRouter);
    // Minimal error handler — mirrors what server.ts global handler does.
    // express-async-errors forwards async rejections to this handler → 500.
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: 'internal_server_error' });
    });

    // Seed project so validation passes, but force ALL Firestore reads to
    // reject — simulating a Firestore outage. assertProjectMember will throw a
    // generic Error (not ProjectMembershipError), which the route re-throws.
    // express-async-errors must forward this to next(err) → our error handler.
    H.db!._seed('projects/p-hang', { tenantId: 'tH', createdBy: 'u1', members: ['u1'] });
    H.db!._failReads(); // all subsequent reads reject with Error('Firestore unavailable')

    const res = await request(app)
      .post(SOS)
      .set('x-test-uid', 'u1')
      .send({ type: 'sos', projectId: 'p-hang' });

    // Must NOT hang — must return 500
    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/emergency/notify-brigada
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/emergency/notify-brigada', () => {
  const NB = '/api/emergency/notify-brigada';

  const validBody = {
    projectId: 'p1',
    emergencyType: 'fire',
    message: 'Incendio en sector norte',
  };

  it('401 when no auth token is present', async () => {
    const res = await request(buildApp()).post(NB).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 (invalid_payload) when projectId is missing', async () => {
    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ emergencyType: 'fire' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 (invalid_payload) when emergencyType is not in the enum', async () => {
    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', emergencyType: 'nuclear_meltdown' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('400 (invalid_payload) when message exceeds 500 chars', async () => {
    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', emergencyType: 'fire', message: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    seedProject(H.db!, 'p1', { createdBy: 'other', members: ['other'] });

    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send(validBody);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('200 happy path: all valid emergency types accepted — tsunami', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'supA', 'supervisor', { fcmToken: 'tok-sup' });
    H.fcmSendEach.mockResolvedValueOnce({ successCount: 1, failureCount: 0, responses: [] });

    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', emergencyType: 'tsunami' });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(1);
  });

  it('200 happy path: notifies supervisors + writes audit log', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'supA', 'supervisor', { fcmToken: 'tok-sup1' });
    seedMember(H.db!, 'p1', 'gerA', 'gerente', { fcmToken: 'tok-ger1' });
    H.fcmSendEach.mockResolvedValueOnce({ successCount: 2, failureCount: 0, responses: [] });

    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', emergencyType: 'fire', message: 'Evacuación inmediata' });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(2);
    expect(body.failed).toBe(0);

    // FCM payload shape
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
    const fcmCall = H.fcmSendEach.mock.calls[0][0] as Record<string, unknown>;
    const notification = fcmCall.notification as Record<string, string>;
    expect(notification.title).toMatch(/fire/i);

    // Audit row written
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys).toHaveLength(1);
    const audit = H.db!._store.get(auditKeys[0]) as Record<string, unknown>;
    expect(audit.action).toBe('emergency.notify_brigada');
    expect(audit.userId).toBe('u1');
    expect(audit.userEmail).toBe('u1@test.com');
    const details = audit.details as Record<string, unknown>;
    expect(details.emergencyType).toBe('fire');
    expect(details.notified).toBe(2);
  });

  it('200 with optional message omitted — falls back to default body', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    seedMember(H.db!, 'p1', 'supA', 'supervisor', { fcmToken: 'tok-sup' });
    H.fcmSendEach.mockResolvedValueOnce({ successCount: 1, failureCount: 0, responses: [] });

    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', emergencyType: 'collapse' });

    expect(res.status).toBe(200);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
    const fcmCall = H.fcmSendEach.mock.calls[0][0] as Record<string, unknown>;
    const notification = fcmCall.notification as Record<string, string>;
    // Default body contains projectId
    expect(notification.body).toContain('p1');
  });

  it('200: notified:0 when no supervisor tokens found (empty brigade)', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    // Only an operario — no supervisors

    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', emergencyType: 'medical' });

    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).notified).toBe(0);
    expect(H.fcmSendEach).not.toHaveBeenCalled();
  });

  it('200: all new emergency types accepted (flood, earthquake, volcanic, storm)', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });

    for (const emergencyType of ['flood', 'earthquake', 'volcanic', 'storm']) {
      H.fcmSendEach.mockClear();
      const res = await request(buildApp())
        .post(NB)
        .set('x-test-uid', 'u1')
        .send({ projectId: 'p1', emergencyType });
      expect(res.status).toBe(200);
    }
  });

  it('200: cross-collection token lookup works for notify-brigada too', async () => {
    seedProject(H.db!, 'p1', { tenantId: 'tA', createdBy: 'u1', members: ['u1'] });
    // supervisor with only canonical tokens (no legacy fcmToken on member doc)
    seedMember(H.db!, 'p1', 'supX', 'supervisor');
    seedUserTokens(H.db!, 'supX', ['canonical-tok-1', 'canonical-tok-2']);

    H.fcmSendEach.mockResolvedValueOnce({ successCount: 2, failureCount: 0, responses: [] });

    const res = await request(buildApp())
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', emergencyType: 'sos' });

    expect(res.status).toBe(200);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
    const fcmCall = H.fcmSendEach.mock.calls[0][0] as Record<string, unknown>;
    const sentTokens = (fcmCall.tokens as string[]).sort();
    expect(sentTokens).toEqual(['canonical-tok-1', 'canonical-tok-2']);
  });

  // ── Guard-hang regression (express-async-errors) ──────────────────────────
  it('GUARD-HANG: Firestore outage on notify-brigada path returns 500 (not hang)', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/emergency', emergencyRouter);
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: 'internal_server_error' });
    });

    H.db!._seed('projects/p-nb-hang', { tenantId: 'tH', createdBy: 'u1', members: ['u1'] });
    H.db!._failReads();

    const res = await request(app)
      .post(NB)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p-nb-hang', emergencyType: 'fire' });

    expect(res.status).toBe(500);
  });
});
