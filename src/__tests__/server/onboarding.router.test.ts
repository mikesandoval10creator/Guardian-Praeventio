// Real-router supertest for src/server/routes/onboarding.ts (B.6)
//
// Mounts the ACTUAL router (fakeFirestore real-router pattern, mirroring
// emergency.router.test.ts) and exercises POST /api/onboarding/complete:
//
//   • 401 without token
//   • 400 invalid payload
//   • 200 happy path (gratis tier): users/{uid} flags, tenant project +
//     canonical projects/{pid} mirror, completion audit emitted
//   • 200 EVEN IF the final 'onboarding.completed' audit write rejects —
//     the CLAUDE.md #14 guard: the user's completed onboarding must never
//     turn into a 5xx because the compliance trail hiccupped. (Note: the
//     real auditServerEvent currently swallows errors and resolves false;
//     this test pins the ROUTE's own defensiveness so a future
//     auditServerEvent that throws cannot regress onboarding.)
//
// Mount point mirror: app.use('/api', onboardingRouter) in server.ts:1065

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
// express-async-errors must be imported in the test process too — the real
// router is mounted on a local express() app and the monkey-patch is per
// process. Without it a rejecting handler HANGS instead of 500ing, and the
// audit-failure regression case would be meaningless.
import 'express-async-errors';

// ── hoisted holder ───────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // When set, the auditServerEvent mock REJECTS for exactly this action.
  auditRejectAction: null as string | null,
  auditSpy: vi.fn(),
  loggerError: vi.fn(),
  captureRouteError: vi.fn(),
}));

// ── firebase-admin mock ─────────────────────────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
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
    };
    next();
  },
}));

// ── idempotencyKey: no-op in tests ───────────────────────────────────────────
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── auditServerEvent: controllable — resolves true, or REJECTS for one accion
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: async (
    _req: unknown,
    action: string,
    module: string,
    details: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => {
    H.auditSpy(action, module, details, options);
    if (H.auditRejectAction !== null && action === H.auditRejectAction) {
      throw new Error(`forced audit failure for ${action} (test)`);
    }
    return true;
  },
}));

// ── logger / captureRouteError spies ─────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: {
    error: (...args: unknown[]) => H.loggerError(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: (...args: unknown[]) => H.captureRouteError(...args),
}));

// ── EmailService: env-less (invites skip email side-effects) ────────────────
vi.mock('../../services/email/resendService.js', () => ({
  EmailService: { fromEnv: () => null },
}));
vi.mock('../../services/email/templates.js', () => ({
  projectInvitationTemplate: () => '<html>invite</html>',
}));

// ── import the REAL router AFTER mocks are set up ───────────────────────────
import onboardingRouter from '../../server/routes/onboarding.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── app factory (mirror of server.ts: app.use('/api', onboardingRouter)) ────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', onboardingRouter);
  return app;
}

const COMPLETE = '/api/onboarding/complete';

const happyPayload = {
  industry: 'construction',
  countries: ['CL'],
  tier: 'gratis',
  projectName: 'Faena Norte',
  inviteEmails: [],
  workersCsv: null,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.auditRejectAction = null;
  H.auditSpy.mockClear();
  H.loggerError.mockClear();
  H.captureRouteError.mockClear();
});

describe('POST /api/onboarding/complete (real router)', () => {
  it('401 without token', async () => {
    const res = await request(buildApp()).post(COMPLETE).send(happyPayload);
    expect(res.status).toBe(401);
  });

  it('400 on invalid payload (unknown industry)', async () => {
    const res = await request(buildApp())
      .post(COMPLETE)
      .set('x-test-uid', 'u1')
      .send({ ...happyPayload, industry: 'nope' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('invalid_industry');
  });

  it('200 happy path: user flags, tenant project + canonical mirror, completion audit', async () => {
    const res = await request(buildApp())
      .post(COMPLETE)
      .set('x-test-uid', 'u1')
      .send(happyPayload);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(typeof body.projectId).toBe('string');
    const projectId = body.projectId as string;

    // users/{uid}: onboarded flag + gratis subscription active
    const user = H.db!._store.get('users/u1') as Record<string, unknown>;
    expect(user).toBeDefined();
    expect(user.onboarded).toBe(true);
    const sub = user.subscription as Record<string, unknown>;
    expect(sub.planId).toBe('gratis');
    expect(sub.status).toBe('active');

    // tenant-scoped project (tenantId = uid, single-tenant-per-user)
    const tenantProject = H.db!._store.get(
      `tenants/u1/projects/${projectId}`,
    ) as Record<string, unknown>;
    expect(tenantProject).toBeDefined();
    expect(tenantProject.ownerUid).toBe('u1');
    expect(tenantProject.name).toBe('Faena Norte');

    // canonical top-level mirror the SPA + rules key off
    const mirror = H.db!._store.get(`projects/${projectId}`) as Record<string, unknown>;
    expect(mirror).toBeDefined();
    expect(mirror.createdBy).toBe('u1');
    expect(mirror.members).toEqual(['u1']);

    // completion audit emitted with the projectId tag
    const completedCalls = H.auditSpy.mock.calls.filter(
      (c) => c[0] === 'onboarding.completed',
    );
    expect(completedCalls).toHaveLength(1);
    expect((completedCalls[0][2] as Record<string, unknown>).projectId).toBe(projectId);
  });

  it('200 even when the final completion audit REJECTS (rule #14 guard)', async () => {
    H.auditRejectAction = 'onboarding.completed';

    const res = await request(buildApp())
      .post(COMPLETE)
      .set('x-test-uid', 'u1')
      .send(happyPayload);

    // The user finished onboarding — a compliance-trail failure is logged +
    // captured, but MUST NOT convert their success into a 5xx.
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).success).toBe(true);

    // Failure is still observable: logger.error + captureRouteError fired.
    const errorEvents = H.loggerError.mock.calls.map((c) => c[0]);
    expect(errorEvents).toContain('audit_event_failed');
    const captured = H.captureRouteError.mock.calls.map((c) => c[1]);
    expect(captured).toContain('onboarding.completion_audit');
  });
});
