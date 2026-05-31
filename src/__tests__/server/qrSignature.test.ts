// Praeventio Guard — Real-router supertest coverage for qrSignature route.
//
// Plan v3 Fase 1: raises line coverage toward 90% without modifying production
// code. Mounts the ACTUAL router and exercises HTTP contracts, auth gates,
// role gates, validation 400s, project-membership 403s, and the full QR
// challenge/acknowledge flow including the LEGAL signing identity invariant:
// the stored `acknowledgedByCallerUid` MUST come from req.user.uid (the
// verified token), not from any client-supplied field.
//
// Mount prefix: /api/sprint-k (server.ts line 963).
//
// Routes exercised:
//   POST /:projectId/qr-signature/challenge    → 201 / 400 / 401 / 403 / 500
//   POST /:projectId/qr-signature/acknowledge  → 201 / 200(idempotent) / 400 / 401 / 403 / 401(invalid)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ────────────────────────────────────────────────────────────────────────
// Hoisted holder — reassigned in beforeEach so the db is fresh every test.
// ────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import('../helpers/fakeFirestore').createFakeFirestore
  > | null,
}));

// ────────────────────────────────────────────────────────────────────────
// firebase-admin mock — route reads only admin.firestore() (no auth claims
// read by the route itself; verifyAuth is mocked out separately).
// ────────────────────────────────────────────────────────────────────────

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ────────────────────────────────────────────────────────────────────────
// verifyAuth — read x-test-uid header; 401 if absent.
// Populates req.user.role from x-test-role so callerHasSupervisorRole() works.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
      admin: req.header('x-test-admin') === 'true',
    };
    next();
  },
}));

// ────────────────────────────────────────────────────────────────────────
// logger — prevent console noise, allow spy assertions if needed.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ────────────────────────────────────────────────────────────────────────
// captureRouteError — prevent Sentry side-effects in tests.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// ────────────────────────────────────────────────────────────────────────
// observability — prevent Sentry network calls.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ────────────────────────────────────────────────────────────────────────
// qrSignatureService — we use the REAL service so buildChallenge and
// verifyChallenge run against actual HMAC logic. The route does a dynamic
// `await import(...)` — we mock the specifier so Vite intercepts it.
// ────────────────────────────────────────────────────────────────────────

// No mock: we let the real qrSignatureService run. The dynamic import in
// the route resolves to the real module because Vitest handles ESM dynamic
// imports in the same module graph.

// ────────────────────────────────────────────────────────────────────────
// assertProjectMember — we run the REAL implementation against the fake db
// (same pattern as eppFlow.test.ts). This exercises the real guard path.
// ────────────────────────────────────────────────────────────────────────

// No mock for projectMembership — real code runs against fake db.

// ────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────────────────────────────────

import qrSignatureRouter from '../../server/routes/qrSignature.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  buildChallenge,
  type QrSignatureChallenge,
} from '../../services/qrSignature/qrSignatureService.js';

// ────────────────────────────────────────────────────────────────────────
// App factory
// ────────────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', qrSignatureRouter);
  return app;
}

// ────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-qr-1';
const MEMBER_UID = 'uid-supervisor-1';
const WORKER_UID = 'uid-worker-1';
const OTHER_UID = 'uid-outsider-9';
const TENANT_ID = 'tenant-qr-a';

/** A valid QR_SIG_SECRET (≥16 chars) injected via process.env for all tests. */
const TEST_SECRET = 'test-qr-secret-16chars-minimum!!';

/** URL helpers */
const challengeUrl = (pid = PROJECT_ID) =>
  `/api/sprint-k/${pid}/qr-signature/challenge`;
const acknowledgeUrl = (pid = PROJECT_ID) =>
  `/api/sprint-k/${pid}/qr-signature/acknowledge`;

/** Minimal valid challenge POST body. */
const baseChallengeBody = {
  itemId: 'item-001',
  kind: 'epp_delivery' as const,
};

/** Minimal valid acknowledge POST body. */
const baseAckBody = (challengeId: string, workerUid: string) => ({
  challengeId,
  workerUid,
  signedAt: new Date().toISOString(),
  biometricUsed: true,
});

/**
 * Build a valid QrSignatureChallenge and seed it in H.db so the acknowledge
 * endpoint can find it. Returns the full challenge object.
 */
function seedChallenge(overrides: Partial<{
  expiresAtOffset: number; // ms relative to now; negative = already expired
  projectId: string;
  signatureHex: string;
  secret: string;
}>= {}): QrSignatureChallenge {
  const secret = overrides.secret ?? TEST_SECRET;
  const now = new Date();
  const ttlMinutes = overrides.expiresAtOffset !== undefined
    ? overrides.expiresAtOffset / 60_000
    : 5;

  // Build with the real service so the HMAC is valid.
  const challenge = buildChallenge(
    {
      challengeId: `chal-${Date.now()}`,
      itemId: 'item-001',
      kind: 'epp_delivery',
      projectId: overrides.projectId ?? PROJECT_ID,
      initiatedByUid: MEMBER_UID,
      nonceHex: 'abcdef1234567890abcdef1234567890', // 32 hex = 16 bytes
      now,
      ttlMinutes: Math.max(1, Math.ceil(Math.abs(ttlMinutes === 0 ? 1 : ttlMinutes))),
    },
    secret,
  );

  // If caller wants an expired challenge: override expiresAt to past.
  const storedChallenge =
    overrides.expiresAtOffset !== undefined && overrides.expiresAtOffset < 0
      ? { ...challenge, expiresAt: new Date(Date.now() - 60_000).toISOString() }
      : challenge;

  // If caller wants a tampered signature.
  const finalChallenge =
    overrides.signatureHex !== undefined
      ? { ...storedChallenge, signatureHex: overrides.signatureHex }
      : storedChallenge;

  // Seed into the fake db at the correct Firestore path.
  const challengePath =
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/qr_signature_challenges/${finalChallenge.challengeId}`;
  H.db!._seed(challengePath, {
    ...finalChallenge,
    createdAt: new Date().toISOString(),
    createdByCallerUid: MEMBER_UID,
  });

  return finalChallenge;
}

// ────────────────────────────────────────────────────────────────────────
// beforeEach — fresh db, env secret, seeded project.
// ────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.QR_SIG_SECRET = TEST_SECRET;
  H.db = createFakeFirestore();

  // Seed the project so assertProjectMember passes for MEMBER_UID and WORKER_UID.
  H.db._seed(`projects/${PROJECT_ID}`, {
    members: [MEMBER_UID, WORKER_UID],
    createdBy: MEMBER_UID,
    tenantId: TENANT_ID,
  });
});

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/qr-signature/challenge
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/qr-signature/challenge', () => {
  const URL = challengeUrl();

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(baseChallengeBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', OTHER_UID)
      .set('x-test-role', 'supervisor')
      .send(baseChallengeBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 invalid_payload when body is empty', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when kind is not in enum', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send({ itemId: 'x', kind: 'unknown_kind' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when ttlMinutes exceeds max (>30)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send({ itemId: 'x', kind: 'safety_talk', ttlMinutes: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 forbidden_role when caller has no supervisor role (plain operario)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .set('x-test-role', 'operario')
      .send(baseChallengeBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
    expect(Array.isArray(res.body.allowed)).toBe(true);
    expect(res.body.allowed).toContain('supervisor');
  });

  it('403 forbidden_role when caller has no role at all', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      // no x-test-role header → role is undefined
      .send(baseChallengeBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('500 qr_signature_secret_not_configured when QR_SIG_SECRET is missing', async () => {
    delete process.env.QR_SIG_SECRET;
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(baseChallengeBody);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('qr_signature_secret_not_configured');
  });

  it('500 qr_signature_secret_not_configured when QR_SIG_SECRET is too short (<16)', async () => {
    process.env.QR_SIG_SECRET = 'short';
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(baseChallengeBody);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('qr_signature_secret_not_configured');
  });

  it('404 tenant_not_found when project exists but has no tenantId', async () => {
    // Seed a project without tenantId so resolveTenantId returns null.
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [MEMBER_UID],
      createdBy: MEMBER_UID,
      // no tenantId field
    });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(baseChallengeBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('201 happy path — challenge persisted in Firestore with server-stamped uid', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'supervisor')
      .send(baseChallengeBody);

    expect(res.status).toBe(201);
    expect(res.body.challenge).toBeDefined();
    const { challenge } = res.body;

    // Shape assertions.
    expect(typeof challenge.challengeId).toBe('string');
    expect(challenge.itemId).toBe('item-001');
    expect(challenge.kind).toBe('epp_delivery');
    expect(challenge.projectId).toBe(PROJECT_ID);
    expect(typeof challenge.signatureHex).toBe('string');
    expect(challenge.signatureHex.length).toBeGreaterThan(0);

    // CRITICAL: initiatedByUid must come from req.user.uid (the verified token),
    // NOT from any client-supplied field.
    expect(challenge.initiatedByUid).toBe(MEMBER_UID);

    // The challenge must be persisted in Firestore.
    const stored = H.db!._dump();
    const challengePath = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/qr_signature_challenges/${challenge.challengeId}`;
    expect(stored[challengePath]).toBeDefined();
    // Server stamps createdByCallerUid from the token uid.
    expect(stored[challengePath]!.createdByCallerUid).toBe(MEMBER_UID);
  });

  it('201 when caller is admin (u.admin === true) — passes role gate', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-admin', 'true')
      // no role header — admin flag alone should be enough
      .send(baseChallengeBody);
    expect(res.status).toBe(201);
  });

  it('201 when caller has prevencionista role', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [MEMBER_UID, 'prev-uid'],
      createdBy: MEMBER_UID,
      tenantId: TENANT_ID,
    });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .set('x-test-role', 'prevencionista')
      .send({ ...baseChallengeBody, ttlMinutes: 10 });
    expect(res.status).toBe(201);
    expect(res.body.challenge.kind).toBe('epp_delivery');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/qr-signature/acknowledge
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/qr-signature/acknowledge', () => {
  const URL = acknowledgeUrl();

  it('401 without a token', async () => {
    const challenge = seedChallenge();
    const res = await request(buildApp())
      .post(URL)
      .send(baseAckBody(challenge.challengeId, WORKER_UID));
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const challenge = seedChallenge();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', OTHER_UID)
      .send(baseAckBody(challenge.challengeId, OTHER_UID));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 invalid_payload when body is missing challengeId', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send({ workerUid: WORKER_UID, signedAt: new Date().toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when signedAt is missing', async () => {
    const challenge = seedChallenge();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send({ challengeId: challenge.challengeId, workerUid: WORKER_UID });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('500 qr_signature_secret_not_configured when secret is missing', async () => {
    delete process.env.QR_SIG_SECRET;
    const challenge = seedChallenge();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send(baseAckBody(challenge.challengeId, WORKER_UID));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('qr_signature_secret_not_configured');
  });

  it('401 invalid_challenge when challenge does not exist in Firestore', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send(baseAckBody('nonexistent-challenge-id', WORKER_UID));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_challenge');
    expect(res.body.reason).toBe('challenge_not_found');
  });

  it('401 invalid_challenge when challenge belongs to a different projectId', async () => {
    // Seed a challenge for a different project.
    const challenge = buildChallenge(
      {
        challengeId: 'chal-wrong-proj',
        itemId: 'item-x',
        kind: 'safety_talk',
        projectId: 'other-project-99',
        initiatedByUid: MEMBER_UID,
        nonceHex: 'aabbccddeeff00112233445566778899',
      },
      TEST_SECRET,
    );
    H.db!._seed(
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/qr_signature_challenges/${challenge.challengeId}`,
      { ...challenge, createdAt: new Date().toISOString(), createdByCallerUid: MEMBER_UID },
    );

    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send(baseAckBody(challenge.challengeId, WORKER_UID));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_challenge');
    expect(res.body.reason).toBe('challenge_project_mismatch');
  });

  it('401 invalid_challenge when challenge HMAC is tampered (bad_signature)', async () => {
    const challenge = seedChallenge({ signatureHex: 'deadbeef'.repeat(8) });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send(baseAckBody(challenge.challengeId, WORKER_UID));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_challenge');
    expect(res.body.reason).toMatch(/bad_signature/);
  });

  it('401 invalid_challenge when challenge is expired', async () => {
    // Seed a challenge with expiresAt in the past.
    const challenge = seedChallenge({ expiresAtOffset: -1 }); // will override expiresAt to past
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send(baseAckBody(challenge.challengeId, WORKER_UID));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_challenge');
    expect(res.body.reason).toMatch(/expired/);
  });

  it('201 happy path — acknowledgement created and persisted in Firestore', async () => {
    const challenge = seedChallenge();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send(baseAckBody(challenge.challengeId, WORKER_UID));

    expect(res.status).toBe(201);
    expect(res.body.acknowledgement).toBeDefined();
    const { acknowledgement } = res.body;

    // Shape assertions.
    expect(acknowledgement.challengeId).toBe(challenge.challengeId);
    expect(acknowledgement.itemId).toBe('item-001');
    expect(acknowledgement.kind).toBe('epp_delivery');
    expect(acknowledgement.supervisorUid).toBe(MEMBER_UID);

    // CRITICAL signing identity invariant: acknowledgedByCallerUid MUST come
    // from req.user.uid (the verified token), not from the client body's workerUid.
    expect(acknowledgement.acknowledgedByCallerUid).toBe(WORKER_UID);

    // The ack must be persisted in Firestore.
    const stored = H.db!._dump();
    const ackPath =
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/qr_acknowledgements/${challenge.challengeId}`;
    expect(stored[ackPath]).toBeDefined();
    // Server stamps acknowledgedByCallerUid from token.
    expect(stored[ackPath]!.acknowledgedByCallerUid).toBe(WORKER_UID);
  });

  it('CRITICAL: acknowledgedByCallerUid is always token uid, not spoofed workerUid in body', async () => {
    const challenge = seedChallenge();
    const SPOOFED_UID = 'attacker-uid-spoof';

    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID) // real token uid
      .send({
        challengeId: challenge.challengeId,
        workerUid: SPOOFED_UID, // client tries to spoof a different uid
        signedAt: new Date().toISOString(),
        biometricUsed: false,
      });

    // Response still goes through (worker is a member).
    expect(res.status).toBe(201);

    // CRITICAL: the stored record must use the token uid, NOT the spoofed body uid.
    const stored = H.db!._dump();
    const ackPath =
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/qr_acknowledgements/${challenge.challengeId}`;
    expect(stored[ackPath]).toBeDefined();
    expect(stored[ackPath]!.acknowledgedByCallerUid).toBe(WORKER_UID);
    expect(stored[ackPath]!.acknowledgedByCallerUid).not.toBe(SPOOFED_UID);

    // NOTE: workerUid from body IS stored as a separate denormalized field
    // (it records which physical worker performed the action — a different
    // concept from the authenticated caller). The LEGAL identity is acknowledgedByCallerUid.
    expect(stored[ackPath]!.workerUid).toBe(SPOOFED_UID);
  });

  it('200 idempotent response when ack already exists (duplicate POST)', async () => {
    const challenge = seedChallenge();
    const ackBody = baseAckBody(challenge.challengeId, WORKER_UID);

    // First POST — creates.
    const res1 = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send(ackBody);
    expect(res1.status).toBe(201);

    // Second POST with same challengeId — idempotent return.
    const res2 = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send(ackBody);
    expect(res2.status).toBe(200);
    expect(res2.body.acknowledgement).toBeDefined();
    expect(res2.body.acknowledgement.challengeId).toBe(challenge.challengeId);
  });

  it('201 with biometricUsed=false when field is omitted (defaults to false)', async () => {
    const challenge = seedChallenge();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_UID)
      .send({
        challengeId: challenge.challengeId,
        workerUid: WORKER_UID,
        signedAt: new Date().toISOString(),
        // biometricUsed omitted
      });

    expect(res.status).toBe(201);
    // Route uses Boolean(body.biometricUsed) — undefined → false.
    expect(res.body.acknowledgement.biometricUsed).toBe(false);
  });
});
