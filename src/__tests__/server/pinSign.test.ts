// Real-router supertest for src/server/routes/pinSign.ts
// (Plan v3 Fase 1 — 5 POST endpoints, pure-compute + PBKDF2 PIN crypto).
//
// Route is mounted at /api/sprint-k in server.ts:
//   POST /:projectId/pin-sign/validate-policy
//   POST /:projectId/pin-sign/register
//   POST /:projectId/pin-sign/verify
//   POST /:projectId/pin-sign/sign-item
//   POST /:projectId/pin-sign/verify-acknowledgement
//
// Crypto (PBKDF2 via @noble/hashes) is NOT mocked — we exercise the
// real KDF via registerPin() on the service, then feed the resulting
// credential to the verify/sign-item endpoints. This gives us real
// timing-safe comparison and lockout logic without touching prod code.
//
// PIN_SIGN_SERVER_SECRET is set in each test that needs it via
// vi.stubEnv so suites that don't need HMAC remain fast.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── vi.hoisted must be the first vi call ────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin mock ─────────────────────────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── verifyAuth stub ─────────────────────────────────────────────────────────
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
    };
    next();
  },
}));

// ── ancillary mocks ─────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ── imports after mocks ─────────────────────────────────────────────────────
import pinSignRouter from '../../server/routes/pinSign.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { registerPin } from '../../services/pinSign/pinSignService.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'p-pinsign-test';
const CALLER_UID = 'uid-worker-alice';
const SERVER_SECRET = 'abcdefghijklmnop'; // 16 chars — meets the >=16 requirement

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', pinSignRouter);
  return app;
}

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Faena Sur',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

/** Build a real PinCredential via the service (uses PBKDF2 at low iter count for speed). */
function makeCredential(uid: string, pin: string, opts?: { iterations?: number }) {
  const saltHex = 'aabbccddeeff00112233445566778899'; // 32 hex chars = 16 bytes
  return registerPin({
    workerUid: uid,
    pin,
    saltHex,
    iterations: opts?.iterations ?? 1, // 1 iteration — valid in tests (skips 600k KDF cost)
  });
}

// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
  vi.stubEnv('PIN_SIGN_SERVER_SECRET', SERVER_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. validate-policy
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/pin-sign/validate-policy', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/pin-sign/validate-policy`;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { app = buildApp(); });

  it('returns 401 when no auth header', async () => {
    const res = await request(app).post(url).send({ pin: '1357' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when pin is missing from body', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 when pin is not all-digits', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: 'abcd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 when pin is too short (3 digits)', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 403 when caller is not a project member', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', 'uid-outsider')
      .send({ pin: '5678' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 200 ok:true for a valid non-trivial pin', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: '9371' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 with engine error code for a trivial pin (1234)', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: '1234' });
    // validatePinPolicy throws PinSignValidationError([PIN_TRIVIAL]) → 400
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PIN_TRIVIAL/);
  });

  it('returns 400 with engine error code for all-same digits (0000)', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: '0000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PIN_TRIVIAL/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. register
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/pin-sign/register', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/pin-sign/register`;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { app = buildApp(); });

  it('returns 401 when no auth header', async () => {
    const res = await request(app).post(url).send({ pin: '9371' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when pin is missing', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 for a trivial pin (1234)', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: '1234' });
    // The route calls registerPin() which calls validatePinPolicy() → PIN_TRIVIAL
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PIN_TRIVIAL/);
  });

  it('returns 403 when caller is not a project member', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', 'uid-outsider')
      .send({ pin: '9371' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — returns registered:true and workerUid from token, NOT raw pin in response', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: '9371' });
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(true);
    // workerUid must come from the token, not client body.
    expect(res.body.workerUid).toBe(CALLER_UID);
    expect(res.body.createdAt).toBeDefined();
    // CRITICAL: raw PIN must never appear in the response.
    expect(JSON.stringify(res.body)).not.toContain('9371');
    // hash and salt must not be in the response.
    expect(res.body.hashHex).toBeUndefined();
    expect(res.body.saltHex).toBeUndefined();
  });

  it('workerUid is always taken from the token, not client-supplied body (anti-spoofing)', async () => {
    // Even if a client could inject extra fields they don't control workerUid.
    // The route does: workerUid = callerUid = req.user!.uid (from token).
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      // Inject a spoofed workerUid in the body — route ignores it.
      .send({ pin: '9371', workerUid: 'uid-attacker' });
    expect(res.status).toBe(200);
    expect(res.body.workerUid).toBe(CALLER_UID);
    expect(res.body.workerUid).not.toBe('uid-attacker');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. verify
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/pin-sign/verify', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/pin-sign/verify`;

  // Build a real credential once for reuse in happy-path tests.
  const VALID_PIN = '9371';
  const WRONG_PIN = '0000'; // happens to be trivial but verifyPin doesn't re-run policy
  const cred = makeCredential(CALLER_UID, VALID_PIN);

  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { app = buildApp(); });

  it('returns 401 when no auth header', async () => {
    const res = await request(app)
      .post(url)
      .send({ credential: cred, pin: VALID_PIN });
    expect(res.status).toBe(401);
  });

  it('returns 400 when credential is missing from body', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: VALID_PIN });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 when pin field is missing', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ credential: cred });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 403 when credential.workerUid does not match the token uid (cross-user)', async () => {
    const otherCred = makeCredential('uid-other-worker', VALID_PIN);
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ credential: otherCred, pin: VALID_PIN });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_credential');
  });

  it('returns 403 when caller is not a project member', async () => {
    const outsiderCred = makeCredential('uid-outsider', VALID_PIN);
    const res = await request(app)
      .post(url)
      .set('x-test-uid', 'uid-outsider')
      .send({ credential: outsiderCred, pin: VALID_PIN });
    expect(res.status).toBe(403);
    // guard(assertProjectMember) fires first since uid matches, then forbidden.
    // Actually guard fires first. uid-outsider not in project → 403 forbidden.
    expect(res.body.error).toBe('forbidden');
  });

  it('200 ok:true + updated credential returned on correct pin', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ credential: cred, pin: VALID_PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.justLockedOut).toBe(false);
    // Updated credential returned for caller to persist.
    expect(res.body.credential).toBeDefined();
    expect(res.body.credential.workerUid).toBe(CALLER_UID);
    expect(res.body.credential.consecutiveFailures).toBe(0);
    // CRITICAL: hash must still be present (for future verifications) but
    // the response must not expose the raw pin value.
    expect(JSON.stringify(res.body)).not.toContain(VALID_PIN);
  });

  it('200 ok:false + justLockedOut:false on wrong pin (first attempt)', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ credential: cred, pin: WRONG_PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.justLockedOut).toBe(false);
    expect(res.body.credential.consecutiveFailures).toBe(1);
  });

  it('200 ok:false + justLockedOut:true after 5 consecutive failures', async () => {
    let currentCred = { ...cred };
    // Simulate 4 prior failures via the credential's consecutiveFailures field.
    currentCred = { ...currentCred, consecutiveFailures: 4 };

    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ credential: currentCred, pin: WRONG_PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.justLockedOut).toBe(true);
    expect(res.body.remainingLockoutMinutes).toBe(15);
    expect(res.body.credential.lockedUntil).toBeDefined();
  });

  it('200 ok:false + remainingLockoutMinutes set when credential is already locked', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min from now
    const lockedCred = { ...cred, consecutiveFailures: 5, lockedUntil: future };

    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ credential: lockedCred, pin: VALID_PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.justLockedOut).toBe(false);
    expect(res.body.remainingLockoutMinutes).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. sign-item
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/pin-sign/sign-item', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/pin-sign/sign-item`;
  const VALID_PIN = '8472';
  const WRONG_PIN = '1111'; // trivial but not re-validated at verify time
  const cred = makeCredential(CALLER_UID, VALID_PIN);

  const validBody = () => ({
    credential: cred,
    pin: VALID_PIN,
    itemId: 'epp-001',
    kind: 'epp_delivery' as const,
    location: { lat: -33.45, lng: -70.65 },
  });

  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { app = buildApp(); });

  it('returns 401 when no auth header', async () => {
    const res = await request(app).post(url).send(validBody());
    expect(res.status).toBe(401);
  });

  it('returns 400 when itemId is missing', async () => {
    const body = validBody();
    delete (body as Partial<typeof body>).itemId;
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 when kind is not in the allowed enum', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody(), kind: 'not_a_kind' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 403 when credential.workerUid does not match the token uid', async () => {
    const otherCred = makeCredential('uid-other', VALID_PIN);
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody(), credential: otherCred });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_credential');
  });

  it('returns 403 when caller is not a project member', async () => {
    const outsiderCred = makeCredential('uid-outsider', VALID_PIN);
    const res = await request(app)
      .post(url)
      .set('x-test-uid', 'uid-outsider')
      .send({ ...validBody(), credential: outsiderCred });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 401 ok:false when pin is wrong (verify fails inside sign-item)', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody(), pin: WRONG_PIN });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.credential).toBeDefined();
  });

  it('200 happy path — acknowledgement returned with correct signedByUid from token', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const ack = res.body.acknowledgement;
    expect(ack).toBeDefined();
    // CRITICAL: signedByUid must be server-stamped from the token, not from
    // any client-supplied body field.
    expect(ack.signedByUid).toBe(CALLER_UID);
    expect(ack.itemId).toBe('epp-001');
    expect(ack.kind).toBe('epp_delivery');
    expect(ack.projectId).toBe(PROJECT_ID);
    expect(ack.biometricUsed).toBe(false);
    // attestationHex must be present and non-trivial.
    expect(typeof ack.attestationHex).toBe('string');
    expect(ack.attestationHex.length).toBeGreaterThan(32);
    // signedAt must be an ISO timestamp.
    expect(new Date(ack.signedAt).getTime()).toBeGreaterThan(0);
    // Updated credential returned for persistence.
    expect(res.body.credential.consecutiveFailures).toBe(0);
  });

  it('signedByUid in acknowledgement is token uid even if attacker injects spoofed signedByUid', async () => {
    // The route uses callerUid = req.user!.uid; body extra fields are ignored.
    const body = {
      ...validBody(),
      signedByUid: 'uid-attacker', // should be ignored
    };
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.acknowledgement.signedByUid).toBe(CALLER_UID);
    expect(res.body.acknowledgement.signedByUid).not.toBe('uid-attacker');
  });

  it('200 happy path without optional location', async () => {
    const body = validBody();
    delete (body as Partial<typeof body>).location;
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.acknowledgement.location).toBeUndefined();
  });

  it('returns 500 when PIN_SIGN_SERVER_SECRET env is missing', async () => {
    vi.unstubAllEnvs();
    delete process.env.PIN_SIGN_SERVER_SECRET;
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(validBody());
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_misconfigured');
    // Restore for other tests
    vi.stubEnv('PIN_SIGN_SERVER_SECRET', SERVER_SECRET);
  });

  it('401 ok:false + justLockedOut:true after 5th consecutive wrong-pin call in sign-item', async () => {
    const lockedCred = { ...cred, consecutiveFailures: 4 };
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody(), credential: lockedCred, pin: WRONG_PIN });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.justLockedOut).toBe(true);
    expect(res.body.remainingLockoutMinutes).toBe(15);
  });

  it('all ITEM_KINDS are accepted by the schema', async () => {
    const kinds = [
      'epp_delivery',
      'safety_talk',
      'document_read',
      'training_completion',
      'permit_acknowledgement',
      'inspection_handover',
    ] as const;
    for (const kind of kinds) {
      const res = await request(app)
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ ...validBody(), kind });
      expect(res.status).toBe(200);
      expect(res.body.acknowledgement.kind).toBe(kind);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. verify-acknowledgement
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/pin-sign/verify-acknowledgement', () => {
  const signUrl = `/api/sprint-k/${PROJECT_ID}/pin-sign/sign-item`;
  const verifyAckUrl = `/api/sprint-k/${PROJECT_ID}/pin-sign/verify-acknowledgement`;

  const VALID_PIN = '7293';
  const cred = makeCredential(CALLER_UID, VALID_PIN);

  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { app = buildApp(); });

  /** Produce a real acknowledgement by going through the sign-item endpoint. */
  async function issueAck() {
    const res = await request(app)
      .post(signUrl)
      .set('x-test-uid', CALLER_UID)
      .send({
        credential: cred,
        pin: VALID_PIN,
        itemId: 'doc-safety-001',
        kind: 'document_read',
        location: { lat: -23.5, lng: -46.6 },
      });
    expect(res.status).toBe(200);
    return res.body.acknowledgement as {
      itemId: string;
      kind: string;
      projectId: string;
      signedByUid: string;
      signedAt: string;
      attestationHex: string;
      biometricUsed: false;
      location?: { lat: number; lng: number };
    };
  }

  it('returns 401 when no auth header', async () => {
    const ack = await issueAck();
    const res = await request(app)
      .post(verifyAckUrl)
      .send({ acknowledgement: ack });
    expect(res.status).toBe(401);
  });

  it('returns 400 when acknowledgement is missing', async () => {
    const res = await request(app)
      .post(verifyAckUrl)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 403 when caller is not a project member', async () => {
    const ack = await issueAck();
    const res = await request(app)
      .post(verifyAckUrl)
      .set('x-test-uid', 'uid-outsider')
      .send({ acknowledgement: ack });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 400 when required acknowledgement field attestationHex is missing', async () => {
    const ack = await issueAck();
    const broken = { ...ack };
    delete (broken as Partial<typeof broken>).attestationHex;
    const res = await request(app)
      .post(verifyAckUrl)
      .set('x-test-uid', CALLER_UID)
      .send({ acknowledgement: broken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 ok:true for a genuine acknowledgement (HMAC valid)', async () => {
    const ack = await issueAck();
    const res = await request(app)
      .post(verifyAckUrl)
      .set('x-test-uid', CALLER_UID)
      .send({ acknowledgement: ack });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 ok:false when the acknowledgement has been tampered (attestationHex corrupted)', async () => {
    const ack = await issueAck();
    const tampered = {
      ...ack,
      attestationHex: 'deadbeef'.repeat(8), // plausible length but wrong HMAC
    };
    const res = await request(app)
      .post(verifyAckUrl)
      .set('x-test-uid', CALLER_UID)
      .send({ acknowledgement: tampered });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });

  it('200 ok:false when signedByUid in the acknowledgement is modified (tamper detection)', async () => {
    const ack = await issueAck();
    const tampered = { ...ack, signedByUid: 'uid-attacker' };
    const res = await request(app)
      .post(verifyAckUrl)
      .set('x-test-uid', CALLER_UID)
      .send({ acknowledgement: tampered });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });

  it('returns 500 when PIN_SIGN_SERVER_SECRET env is missing', async () => {
    const ack = await issueAck();
    vi.unstubAllEnvs();
    delete process.env.PIN_SIGN_SERVER_SECRET;
    const res = await request(app)
      .post(verifyAckUrl)
      .set('x-test-uid', CALLER_UID)
      .send({ acknowledgement: ack });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_misconfigured');
    vi.stubEnv('PIN_SIGN_SERVER_SECRET', SERVER_SECRET);
  });
});
