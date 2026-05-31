// Real-router supertest coverage for src/server/routes/auditPortal.ts
// (Plan v3 Fase 1 — server real-router lever, Sprint 39 H.1).
//
// Route mounted at /api/sprint-k in server.ts (line 1062):
//   POST /:projectId/audit-portal/create-portal
//   POST /:projectId/audit-portal/derive-status
//   POST /:projectId/audit-portal/revoke
//   POST /:projectId/audit-portal/check-access
//   POST /:projectId/audit-portal/summarize-usage
//   POST /:projectId/audit-portal/generate-token
//
// All 6 endpoints are pure compute (no Firestore writes) — the route header
// documents this explicitly. assertProjectMember reads projects/{id} to gate
// access; the rest delegates to the externalAuditPortal engine.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── fakeFirestore holder (hoisted so vi.mock factory can close over it) ──────

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin mock ───────────────────────────────────────────────────────

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── middleware mocks ──────────────────────────────────────────────────────────

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: { uid: string; role?: string; tenantId?: string } }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
    };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn(), isAvailable: false, name: 'noop' }),
}));

// ── imports (after mocks) ─────────────────────────────────────────────────────

import auditPortalRouter from '../../server/routes/auditPortal.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', auditPortalRouter);
  return app;
}

// ── constants ─────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-audit-test';
const CALLER_UID = 'uid-audit-caller';

// A fully valid AuditPortalConfig for use in body parameters that accept a portal.
const FUTURE_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST_DATE   = new Date(Date.now() - 30 * 86_400_000).toISOString();

const VALID_PORTAL = {
  id: 'portal-001',
  accessToken: 'a'.repeat(64), // 64 chars, satisfies min(32)
  createdByUid: CALLER_UID,
  createdAt: new Date().toISOString(),
  expiresAt: FUTURE_DATE,
  auditorName: 'Ana Fiscalizadora',
  auditorAffiliation: 'suseso' as const,
  scopeProjectIds: [PROJECT_ID],
  scopeModules: ['documents', 'incidents'] as const,
};

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
  // Seed the project so assertProjectMember passes for CALLER_UID.
  H.db._seed(`projects/${PROJECT_ID}`, { members: [CALLER_UID] });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/audit-portal/create-portal
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/audit-portal/create-portal', () => {
  const url = (pid = PROJECT_ID) =>
    `/api/sprint-k/${pid}/audit-portal/create-portal`;

  const validBody = {
    id: 'new-portal-id',
    auditorName: 'Pedro Auditor',
    auditorAffiliation: 'iso',
    scopeProjectIds: [PROJECT_ID],
    scopeModules: ['documents', 'trainings'],
    ttlDays: 14,
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    // Seed project without CALLER_UID in members.
    H.db!._seed(`projects/${PROJECT_ID}`, { members: ['other-uid'] });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(url('nonexistent-project'))
      .set('x-test-uid', CALLER_UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 when auditorName is missing (Zod validate)', async () => {
    const { auditorName: _drop, ...body } = validBody;
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when auditorAffiliation is invalid enum', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, auditorAffiliation: 'not_valid_affiliation' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when ttlDays exceeds 90 (Zod validate)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, ttlDays: 91 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when ttlDays is 0 (Zod validate)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, ttlDays: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when scopeProjectIds is empty (PortalValidationError EMPTY_SCOPE)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, scopeProjectIds: [] });
    // Empty array passes Zod (min(1) is on the array), then createPortal throws
    // PortalValidationError which the route maps to 400.
    expect(res.status).toBe(400);
  });

  it('400 when scopeModules is empty (PortalValidationError EMPTY_MODULES)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, scopeModules: [] });
    expect(res.status).toBe(400);
  });

  it('400 when auditorName is too short (<3 chars, PortalValidationError)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, auditorName: 'AB' });
    // Zod min(3) on auditorName — caught by validate middleware.
    expect(res.status).toBe(400);
  });

  it('200 happy path — returns portal with all required fields', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.portal).toBeDefined();
    const portal = res.body.portal as Record<string, unknown>;
    expect(typeof portal.id).toBe('string');
    expect(portal.id).toBe('new-portal-id');
    expect(typeof portal.accessToken).toBe('string');
    expect((portal.accessToken as string).length).toBe(64); // sha256 hex
    expect(portal.createdByUid).toBe(CALLER_UID); // forced from req.user
    expect(typeof portal.createdAt).toBe('string');
    expect(typeof portal.expiresAt).toBe('string');
    expect(portal.auditorName).toBe('Pedro Auditor');
    expect(portal.auditorAffiliation).toBe('iso');
  });

  it('200 — createdByUid forced from token, not from body', async () => {
    // Even if body contains createdByUid, the route ignores it and uses req.user.uid.
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, createdByUid: 'attacker-spoof-uid' });

    expect(res.status).toBe(200);
    expect(res.body.portal.createdByUid).toBe(CALLER_UID);
    expect(res.body.portal.createdByUid).not.toBe('attacker-spoof-uid');
  });

  it('200 — optional now param controls timestamps', async () => {
    const fixedNow = '2026-01-15T00:00:00.000Z';
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, now: fixedNow, ttlDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.portal.createdAt).toBe(fixedNow);
    // expiresAt should be 7 days after fixedNow.
    const expectedExpiry = new Date(
      new Date(fixedNow).getTime() + 7 * 86_400_000,
    ).toISOString();
    expect(res.body.portal.expiresAt).toBe(expectedExpiry);
  });

  it('200 — each call generates a distinct accessToken', async () => {
    const res1 = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, id: 'portal-a' });
    const res2 = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, id: 'portal-b' });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.portal.accessToken).not.toBe(res2.body.portal.accessToken);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/audit-portal/derive-status
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/audit-portal/derive-status', () => {
  const url = (pid = PROJECT_ID) =>
    `/api/sprint-k/${pid}/audit-portal/derive-status`;

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(url()).send({ portal: VALID_PORTAL });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [] });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL });
    expect(res.status).toBe(403);
  });

  it('400 when portal is missing (Zod validate)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when portal.accessToken is too short (<32 chars)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: { ...VALID_PORTAL, accessToken: 'short' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns "active" for a valid non-expired portal', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('200 returns "expired" when expiresAt is in the past', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: { ...VALID_PORTAL, expiresAt: PAST_DATE },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('expired');
  });

  it('200 returns "revoked" when portal has revokedAt', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: {
          ...VALID_PORTAL,
          revokedAt: PAST_DATE,
          revokedByUid: 'some-uid',
          revokedReason: 'audit complete after long review',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
  });

  it('200 — optional now param is respected for status derivation', async () => {
    // Portal expires 2026-01-20; if now is 2026-01-19 → active, 2026-01-21 → expired.
    const expiresAt = '2026-01-20T00:00:00.000Z';
    const portal = { ...VALID_PORTAL, expiresAt };

    const resActive = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal, now: '2026-01-19T00:00:00.000Z' });
    expect(resActive.status).toBe(200);
    expect(resActive.body.status).toBe('active');

    const resExpired = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal, now: '2026-01-21T00:00:00.000Z' });
    expect(resExpired.status).toBe(200);
    expect(resExpired.body.status).toBe('expired');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/audit-portal/revoke
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/audit-portal/revoke', () => {
  const url = (pid = PROJECT_ID) =>
    `/api/sprint-k/${pid}/audit-portal/revoke`;

  const LONG_REASON = 'Audit cycle complete — closing portal after final report submission.';

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(url())
      .send({ portal: VALID_PORTAL, reason: LONG_REASON });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [] });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL, reason: LONG_REASON });
    expect(res.status).toBe(403);
  });

  it('400 when reason is missing (Zod validate)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when reason is too short (<10 chars per Zod schema)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL, reason: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 (PortalValidationError ALREADY_REVOKED) when portal is already revoked', async () => {
    const alreadyRevoked = {
      ...VALID_PORTAL,
      revokedAt: PAST_DATE,
      revokedByUid: 'original-revoker',
      revokedReason: 'already revoked for prior reason',
    };
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: alreadyRevoked, reason: LONG_REASON });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('ALREADY_REVOKED');
  });

  it('200 happy path — returns revoked portal with revokedByUid forced from token', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL, reason: LONG_REASON });

    expect(res.status).toBe(200);
    expect(res.body.portal).toBeDefined();
    const portal = res.body.portal as Record<string, unknown>;
    expect(portal.revokedByUid).toBe(CALLER_UID); // forced from req.user
    expect(typeof portal.revokedAt).toBe('string');
    expect(portal.revokedReason).toBe(LONG_REASON);
    // id and other fields preserved.
    expect(portal.id).toBe(VALID_PORTAL.id);
  });

  it('200 — revokedByUid cannot be spoofed via body', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: VALID_PORTAL,
        reason: LONG_REASON,
        // revokedByUid is not part of revokeSchema body — it's forced server-side
      });

    expect(res.status).toBe(200);
    expect(res.body.portal.revokedByUid).toBe(CALLER_UID);
  });

  it('200 — optional now param controls revokedAt timestamp', async () => {
    const fixedNow = '2026-02-01T12:00:00.000Z';
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL, reason: LONG_REASON, now: fixedNow });

    expect(res.status).toBe(200);
    expect(res.body.portal.revokedAt).toBe(fixedNow);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/audit-portal/check-access
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/audit-portal/check-access', () => {
  const url = (pid = PROJECT_ID) =>
    `/api/sprint-k/${pid}/audit-portal/check-access`;

  const VALID_TOKEN = 'a'.repeat(64);

  const validRequest = {
    token: VALID_TOKEN,
    module: 'documents' as const,
    projectId: PROJECT_ID,
  };

  const portalWithToken = { ...VALID_PORTAL, accessToken: VALID_TOKEN };

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(url())
      .send({ portal: portalWithToken, request: validRequest });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [] });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: portalWithToken, request: validRequest });
    expect(res.status).toBe(403);
  });

  it('400 when request.module is missing', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: portalWithToken,
        request: { token: VALID_TOKEN, projectId: PROJECT_ID },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when request.module is invalid enum', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: portalWithToken,
        request: { ...validRequest, module: 'not_a_module' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns allowed:true for valid active portal with matching token/scope', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: portalWithToken, request: validRequest });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBeDefined();
    expect(res.body.decision.allowed).toBe(true);
  });

  it('200 returns allowed:false, reason:token_unknown when portal is null', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: null, request: validRequest });

    expect(res.status).toBe(200);
    expect(res.body.decision.allowed).toBe(false);
    expect(res.body.decision.reason).toBe('token_unknown');
  });

  it('200 returns allowed:false, reason:token_unknown when token does not match', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: portalWithToken,
        request: { ...validRequest, token: 'b'.repeat(64) }, // different token
      });

    expect(res.status).toBe(200);
    expect(res.body.decision.allowed).toBe(false);
    expect(res.body.decision.reason).toBe('token_unknown');
  });

  it('200 returns allowed:false, reason:portal_expired for expired portal', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: { ...portalWithToken, expiresAt: PAST_DATE },
        request: validRequest,
        now: new Date().toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.decision.allowed).toBe(false);
    expect(res.body.decision.reason).toBe('portal_expired');
  });

  it('200 returns allowed:false, reason:portal_revoked for revoked portal', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: {
          ...portalWithToken,
          revokedAt: PAST_DATE,
          revokedByUid: 'some-uid',
          revokedReason: 'closed after audit period',
        },
        request: validRequest,
      });

    expect(res.status).toBe(200);
    expect(res.body.decision.allowed).toBe(false);
    expect(res.body.decision.reason).toBe('portal_revoked');
  });

  it('200 returns allowed:false, reason:module_not_in_scope when module not in scope', async () => {
    const portalNarrowScope = {
      ...portalWithToken,
      scopeModules: ['documents'], // iper_matrix is NOT in scope
    };
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: portalNarrowScope,
        request: { ...validRequest, module: 'iper_matrix' },
      });

    expect(res.status).toBe(200);
    expect(res.body.decision.allowed).toBe(false);
    expect(res.body.decision.reason).toBe('module_not_in_scope');
  });

  it('200 returns allowed:false, reason:project_not_in_scope when project not in scope', async () => {
    const portalNarrowScope = {
      ...portalWithToken,
      scopeProjectIds: ['another-project'], // PROJECT_ID is NOT in scope
    };
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: portalNarrowScope,
        request: validRequest, // requests PROJECT_ID which is not in scope
      });

    expect(res.status).toBe(200);
    expect(res.body.decision.allowed).toBe(false);
    expect(res.body.decision.reason).toBe('project_not_in_scope');
  });

  it('200 — optional now param controls expiry check', async () => {
    const expiresAt = '2026-06-01T00:00:00.000Z';
    const portal = { ...portalWithToken, expiresAt };

    const resActive = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal, request: validRequest, now: '2026-05-30T00:00:00.000Z' });
    expect(resActive.status).toBe(200);
    expect(resActive.body.decision.allowed).toBe(true);

    const resExpired = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal, request: validRequest, now: '2026-06-02T00:00:00.000Z' });
    expect(resExpired.status).toBe(200);
    expect(resExpired.body.decision.allowed).toBe(false);
    expect(resExpired.body.decision.reason).toBe('portal_expired');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. POST /:projectId/audit-portal/summarize-usage
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/audit-portal/summarize-usage', () => {
  const url = (pid = PROJECT_ID) =>
    `/api/sprint-k/${pid}/audit-portal/summarize-usage`;

  const validLog = {
    portalId: VALID_PORTAL.id,
    accessedAt: new Date().toISOString(),
    module: 'documents' as const,
    downloaded: false,
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(url())
      .send({ portal: VALID_PORTAL, logs: [validLog] });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [] });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL, logs: [validLog] });
    expect(res.status).toBe(403);
  });

  it('400 when logs is missing (Zod validate)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a log entry has invalid module enum', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        portal: VALID_PORTAL,
        logs: [{ ...validLog, module: 'not_a_module' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 happy path — empty logs returns zero-count summary', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL, logs: [] });

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    const summary = res.body.summary as Record<string, unknown>;
    expect(summary.portalId).toBe(VALID_PORTAL.id);
    expect(summary.totalAccesses).toBe(0);
    expect(summary.totalDownloads).toBe(0);
    expect(summary.uniqueModulesAccessed).toBe(0);
    expect(summary.lastAccessAt).toBeUndefined();
  });

  it('200 aggregates totalAccesses, totalDownloads, uniqueModulesAccessed, lastAccessAt', async () => {
    const t1 = '2026-01-01T10:00:00.000Z';
    const t2 = '2026-01-02T10:00:00.000Z';
    const t3 = '2026-01-03T10:00:00.000Z';
    const logs = [
      { portalId: VALID_PORTAL.id, accessedAt: t1, module: 'documents', downloaded: false },
      { portalId: VALID_PORTAL.id, accessedAt: t2, module: 'incidents', downloaded: true },
      { portalId: VALID_PORTAL.id, accessedAt: t3, module: 'documents', downloaded: true },
      // This log belongs to a different portal — should be excluded.
      { portalId: 'other-portal', accessedAt: t3, module: 'trainings', downloaded: false },
    ];
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL, logs });

    expect(res.status).toBe(200);
    const summary = res.body.summary as Record<string, unknown>;
    expect(summary.totalAccesses).toBe(3); // only portal-001 logs
    expect(summary.totalDownloads).toBe(2);
    expect(summary.uniqueModulesAccessed).toBe(2); // documents + incidents
    expect(summary.lastAccessAt).toBe(t3);
  });

  it('200 — logs for other portals are excluded from summary', async () => {
    const logs = [
      { portalId: 'other-portal-x', accessedAt: new Date().toISOString(), module: 'epp', downloaded: false },
    ];
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ portal: VALID_PORTAL, logs });

    expect(res.status).toBe(200);
    expect(res.body.summary.totalAccesses).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. POST /:projectId/audit-portal/generate-token
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/audit-portal/generate-token', () => {
  const url = (pid = PROJECT_ID) =>
    `/api/sprint-k/${pid}/audit-portal/generate-token`;

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(url()).send({});
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [] });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(403);
  });

  it('400 when body has unexpected fields (emptySchema.strict())', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ unexpected: 'field' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 happy path — returns 64-char hex token', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({});

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token).toHaveLength(64);
    // Verify it's hex (only 0-9, a-f).
    expect(/^[0-9a-f]{64}$/.test(res.body.token as string)).toBe(true);
  });

  it('200 — each call generates a distinct token (randomness)', async () => {
    const [res1, res2] = await Promise.all([
      request(buildApp()).post(url()).set('x-test-uid', CALLER_UID).send({}),
      request(buildApp()).post(url()).set('x-test-uid', CALLER_UID).send({}),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.token).not.toBe(res2.body.token);
  });

  it('200 — different projects with same member both succeed (projectId scope)', async () => {
    const project2 = 'proj-second';
    H.db!._seed(`projects/${project2}`, { members: [CALLER_UID] });

    const res1 = await request(buildApp())
      .post(url(PROJECT_ID))
      .set('x-test-uid', CALLER_UID)
      .send({});
    const res2 = await request(buildApp())
      .post(url(project2))
      .set('x-test-uid', CALLER_UID)
      .send({});

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});
