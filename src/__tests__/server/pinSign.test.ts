// Real-router supertest for src/server/routes/pinSign.ts
// (Plan v3 Fase 1 · B17 Fase 5 — server-persisted PIN credential).
//
// Route is mounted at /api/sprint-k in server.ts:
//   POST /:projectId/pin-sign/validate-policy
//   POST /:projectId/pin-sign/register
//   POST /:projectId/pin-sign/verify
//   POST /:projectId/pin-sign/sign-item
//   POST /:projectId/pin-sign/verify-acknowledgement
//
// B17 (Fase 5) security model under test: the PIN credential (salt + PBKDF2
// hash + failure counter + lockout) is stored SERVER-SIDE at
// projects/{projectId}/pin_credentials/{workerUid}. `verify`/`sign-item` read
// it from Firestore and persist the updated counter in a transaction. The
// client NEVER supplies or receives the credential — so it cannot forge a
// hash for a chosen PIN, nor reset the lockout counter.
//
// Crypto (PBKDF2 via @noble/hashes) is NOT mocked — `makeCredential` runs the
// real KDF (at 1 iteration for speed) and we seed the result into the fake
// Firestore, exercising the real timing-safe compare + lockout logic.

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
      email: `${uid}@x.cl`,
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
import { registerPin, type PinCredential } from '../../services/pinSign/pinSignService.js';

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
function makeCredential(uid: string, pin: string, opts?: { iterations?: number }): PinCredential {
  const saltHex = 'aabbccddeeff00112233445566778899'; // 32 hex chars = 16 bytes
  return registerPin({
    workerUid: uid,
    pin,
    saltHex,
    iterations: opts?.iterations ?? 1, // 1 iteration — valid in tests (skips 600k KDF cost)
  });
}

// Top-level server-only collection (see route: avoids the projects master-gate
// read that would expose the hash to members).
const credPath = (uid: string) => `pin_credentials/${PROJECT_ID}__${uid}`;

/** Seed a stored PIN credential server-side (the way `register` would). */
function seedCredential(
  db: NonNullable<typeof H.db>,
  uid: string,
  pin: string,
  overrides: Partial<PinCredential> = {},
) {
  db._seed(credPath(uid), { ...makeCredential(uid, pin), ...overrides });
}

function storedCredential(db: NonNullable<typeof H.db>, uid: string) {
  return db._store.get(credPath(uid)) as PinCredential | undefined;
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
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 when pin is not all-digits', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: 'abcd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 403 when caller is not a project member', async () => {
    const res = await request(app).post(url).set('x-test-uid', 'uid-outsider').send({ pin: '5678' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 200 ok:true for a valid non-trivial pin', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: '9371' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 with engine error code for a trivial pin (1234)', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: '1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PIN_TRIVIAL/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. register  (persists server-side + audits)
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
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 for a trivial pin (1234)', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: '1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PIN_TRIVIAL/);
  });

  it('returns 403 when caller is not a project member', async () => {
    const res = await request(app).post(url).set('x-test-uid', 'uid-outsider').send({ pin: '9371' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — persists the credential server-side, audits, and never returns hash/salt/pin', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: '9371' });
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(true);
    expect(res.body.workerUid).toBe(CALLER_UID);
    expect(res.body.createdAt).toBeDefined();
    // CRITICAL: raw PIN / hash / salt must never appear in the response.
    expect(JSON.stringify(res.body)).not.toContain('9371');
    expect(res.body.hashHex).toBeUndefined();
    expect(res.body.saltHex).toBeUndefined();
    // The credential is now stored SERVER-SIDE with a real hash.
    const stored = storedCredential(H.db!, CALLER_UID);
    expect(stored).toBeDefined();
    expect(stored!.workerUid).toBe(CALLER_UID);
    expect(typeof stored!.hashHex).toBe('string');
    expect(stored!.hashHex.length).toBeGreaterThan(0);
    expect(stored!.consecutiveFailures).toBe(0);
    // A state-changing op must write audit_logs (directive #3).
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
  });

  it('workerUid is always taken from the token, not client-supplied body (anti-spoofing)', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ pin: '9371', workerUid: 'uid-attacker' });
    expect(res.status).toBe(200);
    expect(res.body.workerUid).toBe(CALLER_UID);
    // Stored under the caller, never the spoofed uid.
    expect(storedCredential(H.db!, CALLER_UID)).toBeDefined();
    expect(storedCredential(H.db!, 'uid-attacker')).toBeUndefined();
  });

  it('returns a clean 5xx (no hang, no internals) when the membership read fails mid-check', async () => {
    // Infra outage during assertProjectMember: the guard re-throws (NOT a 403),
    // and the handler must surface a clean 5xx rather than hanging on an
    // unhandled async rejection (Express 4). The error body must not leak the
    // forced-failure message or the Firestore path.
    H.db!._failReads(`projects/${PROJECT_ID}`);
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: '9371' });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('forced read failure');
    expect(serialized).not.toContain(PROJECT_ID);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. verify  (reads credential from Firestore — never the body)
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/pin-sign/verify', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/pin-sign/verify`;
  const VALID_PIN = '9371';
  const WRONG_PIN = '0000';

  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { app = buildApp(); });

  it('returns 401 when no auth header', async () => {
    const res = await request(app).post(url).send({ pin: VALID_PIN });
    expect(res.status).toBe(401);
  });

  it('returns 400 when pin field is missing', async () => {
    seedCredential(H.db!, CALLER_UID, VALID_PIN);
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 404 when the caller has no registered credential', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: VALID_PIN });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_registered');
  });

  it('returns 403 when caller is not a project member', async () => {
    const res = await request(app).post(url).set('x-test-uid', 'uid-outsider').send({ pin: VALID_PIN });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 ok:true on the correct pin; resets the stored counter; no credential in response', async () => {
    seedCredential(H.db!, CALLER_UID, VALID_PIN, { consecutiveFailures: 2 });
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: VALID_PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.justLockedOut).toBe(false);
    // The credential (hash/salt/counter) must NOT be exposed to the client.
    expect(res.body.credential).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(VALID_PIN);
    // Counter reset persisted server-side.
    expect(storedCredential(H.db!, CALLER_UID)!.consecutiveFailures).toBe(0);
  });

  it('200 ok:false on a wrong pin; increments the stored counter (forgery/lockout-reset is impossible)', async () => {
    seedCredential(H.db!, CALLER_UID, VALID_PIN);
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: WRONG_PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.justLockedOut).toBe(false);
    expect(res.body.credential).toBeUndefined();
    // The failure was persisted server-side — the client can't reset it.
    expect(storedCredential(H.db!, CALLER_UID)!.consecutiveFailures).toBe(1);
  });

  it('200 justLockedOut:true after the 5th consecutive failure (counter is server-authoritative)', async () => {
    seedCredential(H.db!, CALLER_UID, VALID_PIN, { consecutiveFailures: 4 });
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: WRONG_PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.justLockedOut).toBe(true);
    expect(res.body.remainingLockoutMinutes).toBe(15);
    expect(storedCredential(H.db!, CALLER_UID)!.lockedUntil).toBeDefined();
  });

  it('200 ok:false + remaining lockout when the stored credential is already locked', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    seedCredential(H.db!, CALLER_UID, VALID_PIN, { consecutiveFailures: 5, lockedUntil: future });
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ pin: VALID_PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.justLockedOut).toBe(false);
    expect(res.body.remainingLockoutMinutes).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. sign-item  (reads credential from Firestore; audits the signature)
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sprint-k/:projectId/pin-sign/sign-item', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/pin-sign/sign-item`;
  const VALID_PIN = '8472';
  const WRONG_PIN = '1111';

  const validBody = () => ({
    pin: VALID_PIN,
    itemId: 'epp-001',
    kind: 'epp_delivery' as const,
    location: { lat: -33.45, lng: -70.65 },
  });

  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { app = buildApp(); seedCredential(H.db!, CALLER_UID, VALID_PIN); });

  it('returns 401 when no auth header', async () => {
    const res = await request(app).post(url).send(validBody());
    expect(res.status).toBe(401);
  });

  it('returns 400 when itemId is missing', async () => {
    const body = validBody();
    delete (body as Partial<typeof body>).itemId;
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 400 when kind is not in the allowed enum', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ ...validBody(), kind: 'not_a_kind' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 404 when the caller has no registered credential', async () => {
    H.db!._store.delete(credPath(CALLER_UID));
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send(validBody());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_registered');
  });

  it('returns 403 when caller is not a project member', async () => {
    const res = await request(app).post(url).set('x-test-uid', 'uid-outsider').send(validBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 401 ok:false when the pin is wrong; no credential in response', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ ...validBody(), pin: WRONG_PIN });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.credential).toBeUndefined();
    expect(storedCredential(H.db!, CALLER_UID)!.consecutiveFailures).toBe(1);
  });

  it('200 happy path — acknowledgement server-stamped, audited, no credential leaked', async () => {
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.credential).toBeUndefined();
    const ack = res.body.acknowledgement;
    expect(ack).toBeDefined();
    // signedByUid is server-stamped from the token.
    expect(ack.signedByUid).toBe(CALLER_UID);
    expect(ack.itemId).toBe('epp-001');
    expect(ack.kind).toBe('epp_delivery');
    expect(ack.projectId).toBe(PROJECT_ID);
    expect(ack.biometricUsed).toBe(false);
    expect(typeof ack.attestationHex).toBe('string');
    expect(ack.attestationHex.length).toBeGreaterThan(32);
    expect(new Date(ack.signedAt).getTime()).toBeGreaterThan(0);
    // The signing event is audited (directive #3).
    const audit = [...H.db!._store.values()].find((d) => d.action === 'pinSign.signItem');
    expect(audit).toBeDefined();
  });

  it('signedByUid is the token uid even if an attacker injects a spoofed signedByUid', async () => {
    const res = await request(app)
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody(), signedByUid: 'uid-attacker' });
    expect(res.status).toBe(200);
    expect(res.body.acknowledgement.signedByUid).toBe(CALLER_UID);
  });

  it('200 happy path without optional location', async () => {
    const body = validBody();
    delete (body as Partial<typeof body>).location;
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.acknowledgement.location).toBeUndefined();
  });

  it('returns 500 when PIN_SIGN_SERVER_SECRET env is missing', async () => {
    vi.unstubAllEnvs();
    delete process.env.PIN_SIGN_SERVER_SECRET;
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send(validBody());
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_misconfigured');
    vi.stubEnv('PIN_SIGN_SERVER_SECRET', SERVER_SECRET);
  });

  it('401 justLockedOut:true on the 5th consecutive wrong-pin sign-item attempt', async () => {
    seedCredential(H.db!, CALLER_UID, VALID_PIN, { consecutiveFailures: 4 });
    const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ ...validBody(), pin: WRONG_PIN });
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
      const res = await request(app).post(url).set('x-test-uid', CALLER_UID).send({ ...validBody(), kind });
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

  let app: ReturnType<typeof buildApp>;
  beforeEach(() => { app = buildApp(); seedCredential(H.db!, CALLER_UID, VALID_PIN); });

  /** Produce a real acknowledgement by going through the (now persisted) sign-item endpoint. */
  async function issueAck() {
    const res = await request(app)
      .post(signUrl)
      .set('x-test-uid', CALLER_UID)
      .send({
        pin: VALID_PIN,
        itemId: 'doc-safety-001',
        kind: 'document_read',
        location: { lat: -23.5, lng: -46.6 },
      });
    expect(res.status).toBe(200);
    return res.body.acknowledgement as Record<string, unknown>;
  }

  it('returns 401 when no auth header', async () => {
    const ack = await issueAck();
    const res = await request(app).post(verifyAckUrl).send({ acknowledgement: ack });
    expect(res.status).toBe(401);
  });

  it('returns 400 when acknowledgement is missing', async () => {
    const res = await request(app).post(verifyAckUrl).set('x-test-uid', CALLER_UID).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('returns 403 when caller is not a project member', async () => {
    const ack = await issueAck();
    const res = await request(app).post(verifyAckUrl).set('x-test-uid', 'uid-outsider').send({ acknowledgement: ack });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 ok:true for a genuine acknowledgement (HMAC valid)', async () => {
    const ack = await issueAck();
    const res = await request(app).post(verifyAckUrl).set('x-test-uid', CALLER_UID).send({ acknowledgement: ack });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 ok:false when the acknowledgement is tampered (attestationHex corrupted)', async () => {
    const ack = await issueAck();
    const tampered = { ...ack, attestationHex: 'deadbeef'.repeat(8) };
    const res = await request(app).post(verifyAckUrl).set('x-test-uid', CALLER_UID).send({ acknowledgement: tampered });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });

  it('200 ok:false when signedByUid is modified (tamper detection)', async () => {
    const ack = await issueAck();
    const tampered = { ...ack, signedByUid: 'uid-attacker' };
    const res = await request(app).post(verifyAckUrl).set('x-test-uid', CALLER_UID).send({ acknowledgement: tampered });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});
