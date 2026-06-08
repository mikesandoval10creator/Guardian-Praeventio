// Real-router supertest coverage for src/server/routes/curriculum.ts.
// Mounts the ACTUAL production router (not a copy) through the reusable
// fakeFirestore pattern so every handler branch — auth gate, 400 validation,
// happy-path 200/201, business branches (cosign/decline/already-signed/expired),
// audit_logs side-effects, and the per-token resend rate-limit — is exercised.
//
// The heavy deps (Resend, @simplewebauthn/server, webauthnChallenge,
// webauthnCredentialStore) are mocked so this remains a fast HTTP-contract test.
// The curriculum claims service uses the real implementation through the
// fakeFirestore DI surface.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import crypto from 'node:crypto';

// ── hoisted holder — lets us reassign H.db in beforeEach while the vi.mock
// factory captures the getter once at import time. ────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  resendSend: vi.fn(async () => ({ id: 'email-id-1', data: { id: 'email-id-1' } })),
}));

// ── firebase-admin mock ───────────────────────────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    verifyIdToken: async () => ({ uid: 'worker-1' }),
    getUser: async (uid: string) => ({
      uid,
      email: `${uid}@example.com`,
      displayName: `Worker ${uid}`,
    }),
  });
});

// ── verifyAuth shim: reads x-test-uid header (no real JWT needed) ─────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@example.com`,
    };
    next();
  },
}));

// ── pass-through rate limiters ────────────────────────────────────────────────
vi.mock('../../server/middleware/limiters.js', () => ({
  refereeLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  webauthnVerifyLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  webauthnRegisterLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── silent logger & observability ────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ── Resend — mock the emails.send method so no real HTTP leaves the test ──────
vi.mock('resend', () => {
  class Resend {
    emails = { send: H.resendSend };
  }
  return { Resend };
});

// ── WebAuthn services — stub them for the curriculum routes surface ───────────
vi.mock('../../services/auth/webauthnChallenge.js', () => ({
  generateWebAuthnChallenge: vi.fn(() => ({
    challengeId: 'challenge-id-1',
    challenge: new Uint8Array([1, 2, 3, 4]),
  })),
  storeWebAuthnChallenge: vi.fn(async () => undefined),
  consumeWebAuthnChallenge: vi.fn(async () => ({ valid: true })),
}));
vi.mock('../../services/auth/webauthnCredentialStore.js', () => ({
  findByCredentialId: vi.fn(async () => null),
  registerCredential: vi.fn(async () => undefined),
  updateCounter: vi.fn(async () => undefined),
  decodePublicKey: vi.fn((_b64: string) => new Uint8Array([1, 2, 3])),
}));
vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  })),
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: 'c2hvcnRjaGFsbGVuZ2U',
    rp: { id: 'localhost', name: 'Praeventio Guard' },
    user: { id: 'dXNlci0x', name: 'w1@example.com', displayName: 'w1@example.com' },
    pubKeyCredParams: [],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: [],
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-id-1',
        publicKey: new Uint8Array([4, 5, 6]),
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    },
  })),
}));

// ── Import real router AFTER mocks ────────────────────────────────────────────
import curriculumRouter, { webauthnChallengeRouter } from '../../server/routes/curriculum.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { hashToken, generateRefereeToken } from '../../services/curriculum/refereeTokens.js';

// ── App factory ───────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/curriculum', curriculumRouter);
  app.use('/api/auth', webauthnChallengeRouter);
  return app;
}

// ── Valid claim body ──────────────────────────────────────────────────────────
const VALID_CLAIM_BODY = {
  claim: 'Tengo 5 años de experiencia como capataz de seguridad.',
  category: 'experience',
  referees: [
    { email: 'ref1@company.com', name: 'Referencia Uno' },
    { email: 'ref2@company.com', name: 'Referencia Dos' },
  ],
  signedByWorker: { fallbackAttest: true, fallbackReason: 'no authenticator on device' },
};

// ── Helper: seed a claim in fakeFirestore ─────────────────────────────────────
function seedClaim(
  id: string,
  overrides: Record<string, unknown> = {},
): { rawToken0: string; rawToken1: string } {
  const rawToken0 = generateRefereeToken();
  const rawToken1 = generateRefereeToken();
  H.db!._seed(`curriculum_claims/${id}`, {
    workerId: 'worker-1',
    workerEmail: 'worker-1@example.com',
    claim: 'Tengo 5 años como capataz.',
    category: 'experience',
    status: 'pending_referees',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    verifiedAt: null,
    signedByWorker: { signedAt: new Date().toISOString(), fallbackAttest: true },
    referees: [
      { email: 'ref1@company.com', name: 'Ref Uno', tokenHash: hashToken(rawToken0), signedAt: null },
      { email: 'ref2@company.com', name: 'Ref Dos', tokenHash: hashToken(rawToken1), signedAt: null },
    ],
    ...overrides,
  });
  return { rawToken0, rawToken1 };
}

// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  H.db = createFakeFirestore();
  H.resendSend.mockClear();
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/curriculum/claim
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/curriculum/claim', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/curriculum/claim').send(VALID_CLAIM_BODY);
    expect(res.status).toBe(401);
  });

  it('400 when claim text is missing', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_CLAIM_BODY, claim: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/claim/i);
  });

  it('400 when claim text exceeds 500 chars', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_CLAIM_BODY, claim: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('400 when category is invalid', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_CLAIM_BODY, category: 'not_a_category' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid category/i);
  });

  it('400 when referees array is wrong length', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_CLAIM_BODY, referees: [{ email: 'ref1@c.com', name: 'R1' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2 referees/i);
  });

  it('400 when referees have duplicate emails (service-layer validation)', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim')
      .set('x-test-uid', 'worker-1')
      .send({
        ...VALID_CLAIM_BODY,
        referees: [
          { email: 'same@company.com', name: 'R1' },
          { email: 'same@company.com', name: 'R2' },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/distinct/i);
  });

  it('200 creates a claim, writes to Firestore, and fires 2 emails', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim')
      .set('x-test-uid', 'worker-1')
      .send(VALID_CLAIM_BODY);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.claimId).toBe('string');

    // Confirm Firestore write
    const snap = await H.db!.collection('curriculum_claims').doc(res.body.claimId).get();
    expect(snap.exists).toBe(true);
    const data = snap.data() as Record<string, unknown>;
    expect(data.workerId).toBe('worker-1');
    expect(data.status).toBe('pending_referees');
    expect((data.referees as unknown[]).length).toBe(2);

    // Emails: 2 magic-link emails sent
    expect(H.resendSend).toHaveBeenCalledTimes(2);

    // Audit log written
    const auditSnap = await H.db!.collection('audit_logs').get();
    expect(auditSnap.empty).toBe(false);
    const actions = auditSnap.docs.map((d) => d.data()!.action);
    expect(actions).toContain('curriculum.claim.created');
    // audit logs have userId stamped (not client-supplied)
    const auditDoc = auditSnap.docs.find((d) => d.data()!.action === 'curriculum.claim.created');
    expect(auditDoc!.data()!.userId).toBe('worker-1');
  });

  it('200 works with category=certification', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_CLAIM_BODY, category: 'certification' });
    expect(res.status).toBe(200);
    const snap = await H.db!.collection('curriculum_claims').doc(res.body.claimId).get();
    expect((snap.data() as Record<string, unknown>).category).toBe('certification');
  });

  it('200 works with all valid categories', async () => {
    for (const category of ['experience', 'certification', 'incident_record', 'other']) {
      H.db = createFakeFirestore();
      H.resendSend.mockClear();
      const res = await request(buildApp())
        .post('/api/curriculum/claim')
        .set('x-test-uid', 'worker-1')
        .send({ ...VALID_CLAIM_BODY, category });
      expect(res.status).toBe(200);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/curriculum/claims
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/curriculum/claims', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/curriculum/claims');
    expect(res.status).toBe(401);
  });

  it('200 returns empty array when worker has no claims', async () => {
    const res = await request(buildApp())
      .get('/api/curriculum/claims')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.claims).toEqual([]);
  });

  it('200 returns only the calling worker claims (not another worker)', async () => {
    seedClaim('claim-a');
    H.db!._seed('curriculum_claims/claim-b', {
      workerId: 'other-worker',
      workerEmail: 'other@example.com',
      claim: 'Other claim.',
      category: 'other',
      status: 'pending_referees',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      verifiedAt: null,
      signedByWorker: { signedAt: new Date().toISOString() },
      referees: [],
    });

    const res = await request(buildApp())
      .get('/api/curriculum/claims')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(200);
    expect(res.body.claims).toHaveLength(1);
    expect(res.body.claims[0].workerId).toBe('worker-1');
  });

  it('200 returns multiple claims for the same worker', async () => {
    seedClaim('claim-a');
    seedClaim('claim-b');

    const res = await request(buildApp())
      .get('/api/curriculum/claims')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(200);
    expect(res.body.claims).toHaveLength(2);
    expect(res.body.claims.every((c: Record<string, unknown>) => c.workerId === 'worker-1')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/curriculum/claim/:id/resend
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/curriculum/claim/:id/resend', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim/claim-x/resend')
      .send({ refereeIndex: 0 });
    expect(res.status).toBe(401);
  });

  it('400 when refereeIndex is missing or invalid', async () => {
    seedClaim('claim-r');
    for (const refereeIndex of [undefined, -1, 2, 'foo']) {
      const res = await request(buildApp())
        .post('/api/curriculum/claim/claim-r/resend')
        .set('x-test-uid', 'worker-1')
        .send({ refereeIndex });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/refereeIndex/i);
    }
  });

  it('404 when claim does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/claim/no-such-claim/resend')
      .set('x-test-uid', 'worker-1')
      .send({ refereeIndex: 0 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('403 when the claim belongs to a different worker', async () => {
    H.db!._seed('curriculum_claims/claim-other', {
      workerId: 'other-worker',
      workerEmail: 'other@example.com',
      claim: 'Another claim.',
      category: 'other',
      status: 'pending_referees',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      verifiedAt: null,
      signedByWorker: { signedAt: new Date().toISOString() },
      referees: [
        { email: 'ref1@c.com', name: 'R1', tokenHash: hashToken(generateRefereeToken()), signedAt: null },
        { email: 'ref2@c.com', name: 'R2', tokenHash: hashToken(generateRefereeToken()), signedAt: null },
      ],
    });
    const res = await request(buildApp())
      .post('/api/curriculum/claim/claim-other/resend')
      .set('x-test-uid', 'worker-1')
      .send({ refereeIndex: 0 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your claim/i);
  });

  it('409 when claim status is not pending_referees', async () => {
    seedClaim('claim-verified', { status: 'verified' });
    const res = await request(buildApp())
      .post('/api/curriculum/claim/claim-verified/resend')
      .set('x-test-uid', 'worker-1')
      .send({ refereeIndex: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not pending/i);
  });

  it('409 when referee has already signed', async () => {
    const rawToken0 = generateRefereeToken();
    H.db!._seed('curriculum_claims/claim-signed', {
      workerId: 'worker-1',
      workerEmail: 'worker-1@example.com',
      claim: 'My claim.',
      category: 'other',
      status: 'pending_referees',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      verifiedAt: null,
      signedByWorker: { signedAt: new Date().toISOString() },
      referees: [
        { email: 'ref1@c.com', name: 'R1', tokenHash: hashToken(rawToken0), signedAt: new Date().toISOString() },
        { email: 'ref2@c.com', name: 'R2', tokenHash: hashToken(generateRefereeToken()), signedAt: null },
      ],
    });
    const res = await request(buildApp())
      .post('/api/curriculum/claim/claim-signed/resend')
      .set('x-test-uid', 'worker-1')
      .send({ refereeIndex: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already responded/i);
  });

  it('200 rotates token, updates Firestore, and sends email for refereeIndex=0', async () => {
    const { rawToken0 } = seedClaim('claim-resend');
    const oldHash = hashToken(rawToken0);

    const res = await request(buildApp())
      .post('/api/curriculum/claim/claim-resend/resend')
      .set('x-test-uid', 'worker-1')
      .send({ refereeIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Token was rotated: new hash != old hash
    const updated = (await H.db!.collection('curriculum_claims').doc('claim-resend').get()).data() as Record<string, unknown>;
    const updatedReferees = updated.referees as Array<Record<string, unknown>>;
    expect(updatedReferees[0].tokenHash).not.toBe(oldHash);

    // Email was sent
    expect(H.resendSend).toHaveBeenCalledTimes(1);
  });

  it('200 rotates token for refereeIndex=1', async () => {
    const { rawToken1 } = seedClaim('claim-resend2');
    const oldHash = hashToken(rawToken1);

    const res = await request(buildApp())
      .post('/api/curriculum/claim/claim-resend2/resend')
      .set('x-test-uid', 'worker-1')
      .send({ refereeIndex: 1 });
    expect(res.status).toBe(200);

    const updated = (await H.db!.collection('curriculum_claims').doc('claim-resend2').get()).data() as Record<string, unknown>;
    const updatedReferees = updated.referees as Array<Record<string, unknown>>;
    expect(updatedReferees[1].tokenHash).not.toBe(oldHash);
  });

  it('429 when resend is called twice within the cooldown window', async () => {
    seedClaim('claim-ratelimit');
    const app = buildApp();

    const first = await request(app)
      .post('/api/curriculum/claim/claim-ratelimit/resend')
      .set('x-test-uid', 'worker-1')
      .send({ refereeIndex: 0 });
    expect(first.status).toBe(200);

    // Re-seed same state to pass the signedAt check
    seedClaim('claim-ratelimit');

    const second = await request(app)
      .post('/api/curriculum/claim/claim-ratelimit/resend')
      .set('x-test-uid', 'worker-1')
      .send({ refereeIndex: 0 });
    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/too many resends/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/curriculum/referee/:token
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/curriculum/referee/:token (public preview)', () => {
  it('400 when token format is invalid (not 64-char hex)', async () => {
    const res = await request(buildApp()).get('/api/curriculum/referee/not-a-valid-token');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid token format/i);
  });

  it('400 when token is too short', async () => {
    const res = await request(buildApp()).get('/api/curriculum/referee/' + 'a'.repeat(32));
    expect(res.status).toBe(400);
  });

  it('404 when no claim matches the token', async () => {
    const fakeToken = crypto.randomBytes(32).toString('hex');
    const res = await request(buildApp()).get(`/api/curriculum/referee/${fakeToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/token does not match/i);
  });

  it('200 returns claim preview when token matches a pending claim', async () => {
    const { rawToken0 } = seedClaim('claim-preview');
    const res = await request(buildApp()).get(`/api/curriculum/referee/${rawToken0}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      claimText: expect.any(String),
      status: 'pending_referees',
      refereeName: 'Ref Uno',
      refereeEmail: 'ref1@company.com',
      category: 'experience',
      alreadySigned: false,
    });
  });

  it('200 shows alreadySigned=true when slot has signedAt', async () => {
    const rawToken0 = generateRefereeToken();
    H.db!._seed('curriculum_claims/claim-signed-preview', {
      workerId: 'worker-1',
      workerEmail: 'worker-1@example.com',
      claim: 'Signed claim.',
      category: 'experience',
      status: 'verified',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      verifiedAt: new Date().toISOString(),
      signedByWorker: { signedAt: new Date().toISOString() },
      referees: [
        { email: 'ref1@company.com', name: 'Ref Uno', tokenHash: hashToken(rawToken0), signedAt: new Date().toISOString() },
        { email: 'ref2@company.com', name: 'Ref Dos', tokenHash: hashToken(generateRefereeToken()), signedAt: new Date().toISOString() },
      ],
    });
    const res = await request(buildApp()).get(`/api/curriculum/referee/${rawToken0}`);
    expect(res.status).toBe(200);
    expect(res.body.alreadySigned).toBe(true);
    expect(res.body.status).toBe('verified');
  });

  it('200 lazy-expires a past-expiresAt pending claim and returns status=expired', async () => {
    const rawToken0 = generateRefereeToken();
    H.db!._seed('curriculum_claims/claim-expired', {
      workerId: 'worker-1',
      workerEmail: 'worker-1@example.com',
      claim: 'Old claim.',
      category: 'other',
      status: 'pending_referees',
      createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
      expiresAt: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
      verifiedAt: null,
      signedByWorker: { signedAt: new Date().toISOString() },
      referees: [
        { email: 'ref1@company.com', name: 'Ref Uno', tokenHash: hashToken(rawToken0), signedAt: null },
        { email: 'ref2@company.com', name: 'Ref Dos', tokenHash: hashToken(generateRefereeToken()), signedAt: null },
      ],
    });
    const res = await request(buildApp()).get(`/api/curriculum/referee/${rawToken0}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('expired');

    // Lazy expire was written to Firestore
    const updated = (await H.db!.collection('curriculum_claims').doc('claim-expired').get()).data() as Record<string, unknown>;
    expect(updated.status).toBe('expired');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/curriculum/referee/:token  (cosign / decline)
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/curriculum/referee/:token (cosign/decline)', () => {
  const shortSig = 'I-attest-standard';

  it('400 when token format is invalid', async () => {
    const res = await request(buildApp())
      .post('/api/curriculum/referee/badtoken')
      .send({ action: 'cosign', method: 'standard', signature: shortSig });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid token format/i);
  });

  it('400 when action is invalid', async () => {
    const tok = crypto.randomBytes(32).toString('hex');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${tok}`)
      .send({ action: 'approve', method: 'standard', signature: shortSig });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action must be cosign or decline/i);
  });

  it('400 when cosign method is invalid', async () => {
    const tok = crypto.randomBytes(32).toString('hex');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${tok}`)
      .send({ action: 'cosign', method: 'pen', signature: shortSig });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/method must be webauthn or standard/i);
  });

  it('400 when signature is missing', async () => {
    const tok = crypto.randomBytes(32).toString('hex');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${tok}`)
      .send({ action: 'cosign', method: 'standard', signature: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it('400 when signature exceeds 1024 chars', async () => {
    const tok = crypto.randomBytes(32).toString('hex');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${tok}`)
      .send({ action: 'cosign', method: 'standard', signature: 'x'.repeat(1025) });
    expect(res.status).toBe(400);
  });

  it('404 when no pending claim matches the token', async () => {
    const tok = crypto.randomBytes(32).toString('hex');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${tok}`)
      .send({ action: 'cosign', method: 'standard', signature: shortSig });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/token does not match/i);
  });

  it('200 cosign — first referee signs, claim stays pending_referees', async () => {
    const { rawToken0 } = seedClaim('claim-cosign1');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'cosign', method: 'standard', signature: shortSig });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verified).toBe(false);

    const snap = (await H.db!.collection('curriculum_claims').doc('claim-cosign1').get()).data() as Record<string, unknown>;
    expect(snap.status).toBe('pending_referees');
    const refs = snap.referees as Array<Record<string, unknown>>;
    expect(refs[0].signedAt).toBeTruthy();
    expect(refs[0].signature).toBe(shortSig);
    expect(refs[0].method).toBe('standard');

    // Audit log
    const auditSnap = await H.db!.collection('audit_logs').get();
    const actions = auditSnap.docs.map((d) => d.data()!.action);
    expect(actions).toContain('curriculum.referee.endorsed');
  });

  it('200 cosign — both referees sign, claim becomes verified', async () => {
    const { rawToken0, rawToken1 } = seedClaim('claim-cosign2');

    // First referee signs
    await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'cosign', method: 'standard', signature: shortSig });

    // Second referee signs
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken1}`)
      .send({ action: 'cosign', method: 'webauthn', signature: 'webauthn-assertion-bytes' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);

    const snap = (await H.db!.collection('curriculum_claims').doc('claim-cosign2').get()).data() as Record<string, unknown>;
    expect(snap.status).toBe('verified');
    expect(snap.verifiedAt).toBeTruthy();

    // Both curriculum.referee.endorsed + curriculum.claim.verified audit entries
    const auditSnap = await H.db!.collection('audit_logs').get();
    const actions = auditSnap.docs.map((d) => d.data()!.action);
    expect(actions).toContain('curriculum.claim.verified');
  });

  it('409 when referee already endorsed (replay protection)', async () => {
    const { rawToken0 } = seedClaim('claim-replay');

    // Sign once
    await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'cosign', method: 'standard', signature: shortSig });

    // Try to sign again with same token (after the first sign, slot no longer in pending)
    // NOTE: after the first sign the status is still pending_referees (only 1 signed),
    // and the slot now has signedAt set — the service should throw "already endorsed".
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'cosign', method: 'standard', signature: shortSig });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it('200 decline — sets declined=true and flips claim to rejected', async () => {
    const { rawToken0 } = seedClaim('claim-decline');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'decline', method: 'standard', signature: shortSig });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verified).toBe(false);
    expect(res.body.declined).toBe(true);

    const snap = (await H.db!.collection('curriculum_claims').doc('claim-decline').get()).data() as Record<string, unknown>;
    expect(snap.status).toBe('rejected');
    const refs = snap.referees as Array<Record<string, unknown>>;
    expect(refs[0].declined).toBe(true);

    // Audit written for decline
    const auditSnap = await H.db!.collection('audit_logs').get();
    const actions = auditSnap.docs.map((d) => d.data()!.action);
    expect(actions).toContain('curriculum.referee.declined');
  });

  // ── F4: the public cosign path NEVER stores method=webauthn ──────────────
  // An unauthenticated magic-link referee has no enrolled credential, so the
  // server cannot verify a real assertion. A client 'webauthn' intent must be
  // recorded as the truthful 'device_attested', never the cryptographic label.

  it('F4: coerces client method=webauthn into stored method=device_attested', async () => {
    const { rawToken0 } = seedClaim('claim-f4a');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'cosign', method: 'webauthn', signature: 'device-attested:2026-06-08T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The route echoes the RESOLVED method so the client knows the truth.
    expect(res.body.method).toBe('device_attested');

    const snap = (await H.db!.collection('curriculum_claims').doc('claim-f4a').get()).data() as Record<string, unknown>;
    const refs = snap.referees as Array<Record<string, unknown>>;
    // CRITICAL: the stored slot is NOT labelled as cryptographic webauthn.
    expect(refs[0].method).toBe('device_attested');
    expect(refs[0].method).not.toBe('webauthn');
    expect(refs[0].signedAt).toBeTruthy();

    // Audit records the truthful method + webauthnVerified:false.
    const auditSnap = await H.db!.collection('audit_logs').get();
    const endorsed = auditSnap.docs.find((d) => d.data()!.action === 'curriculum.referee.endorsed');
    const details = endorsed!.data()!.details as Record<string, unknown>;
    expect(details.method).toBe('device_attested');
    expect(details.webauthnVerified).toBe(false);
  });

  it('F4: standard cosign still stores method=standard', async () => {
    const { rawToken0 } = seedClaim('claim-f4b');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'cosign', method: 'standard', signature: 'standard:2026-06-08T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.method).toBe('standard');
    const snap = (await H.db!.collection('curriculum_claims').doc('claim-f4b').get()).data() as Record<string, unknown>;
    expect((snap.referees as Array<Record<string, unknown>>)[0].method).toBe('standard');
  });

  it('F4: both referees biometric → claim verifies but NO slot claims webauthn', async () => {
    const { rawToken0, rawToken1 } = seedClaim('claim-f4c');
    await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'cosign', method: 'webauthn', signature: 'device-attested:a' });
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken1}`)
      .send({ action: 'cosign', method: 'webauthn', signature: 'device-attested:b' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);

    const snap = (await H.db!.collection('curriculum_claims').doc('claim-f4c').get()).data() as Record<string, unknown>;
    expect(snap.status).toBe('verified');
    const refs = snap.referees as Array<Record<string, unknown>>;
    expect(refs.every((r) => r.method === 'device_attested')).toBe(true);
    expect(refs.some((r) => r.method === 'webauthn')).toBe(false);
  });

  it('F4: decline with method=webauthn does not stamp the webauthn label', async () => {
    const { rawToken0 } = seedClaim('claim-f4d');
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'decline', method: 'webauthn', signature: 'device-attested:x' });
    expect(res.status).toBe(200);
    expect(res.body.declined).toBe(true);
    const snap = (await H.db!.collection('curriculum_claims').doc('claim-f4d').get()).data() as Record<string, unknown>;
    const refs = snap.referees as Array<Record<string, unknown>>;
    expect(refs[0].declined).toBe(true);
    expect(refs[0].method).toBe('device_attested');
    expect(refs[0].method).not.toBe('webauthn');
  });

  it('410 when claim has expired (service throws "expired")', async () => {
    // Seed an expired claim that still has status pending_referees
    // (lazy expiry path: expiresAt is past but not yet flipped).
    const rawToken0 = generateRefereeToken();
    H.db!._seed('curriculum_claims/claim-exp-endorse', {
      workerId: 'worker-1',
      workerEmail: 'worker-1@example.com',
      claim: 'Expired claim.',
      category: 'other',
      status: 'pending_referees',
      createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
      expiresAt: new Date(Date.now() - 86400000).toISOString(), // past
      verifiedAt: null,
      signedByWorker: { signedAt: new Date().toISOString() },
      referees: [
        { email: 'ref1@company.com', name: 'Ref Uno', tokenHash: hashToken(rawToken0), signedAt: null },
        { email: 'ref2@company.com', name: 'Ref Dos', tokenHash: hashToken(generateRefereeToken()), signedAt: null },
      ],
    });
    const res = await request(buildApp())
      .post(`/api/curriculum/referee/${rawToken0}`)
      .send({ action: 'cosign', method: 'standard', signature: shortSig });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/auth/webauthn/challenge
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/auth/webauthn/challenge', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/auth/webauthn/challenge');
    expect(res.status).toBe(401);
  });

  it('200 returns challengeId, challenge (base64), and ttlSeconds', async () => {
    const res = await request(buildApp())
      .get('/api/auth/webauthn/challenge')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(200);
    expect(typeof res.body.challengeId).toBe('string');
    expect(typeof res.body.challenge).toBe('string');
    expect(res.body.ttlSeconds).toBe(300);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/auth/webauthn/verify (validation layer only — crypto mocked)
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/webauthn/verify (validation)', () => {
  // Build a minimal base64-encoded clientDataJSON with a challenge field
  const dummyChallenge = 'c2hvcnRjaGFsbGVuZ2U'; // base64url of 'shortchallenge'
  const clientDataJSONObj = { challenge: dummyChallenge, type: 'webauthn.get', origin: 'http://localhost:3000' };
  const clientDataJSON = Buffer.from(JSON.stringify(clientDataJSONObj)).toString('base64');

  const VALID_VERIFY_BODY = {
    challengeId: 'challenge-id-1',
    id: 'cred-id-1',
    rawId: 'cred-id-1',
    clientDataJSON,
    authenticatorData: 'auth-data',
    signature: 'sig-data',
    type: 'public-key',
    clientExtensionResults: {},
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/auth/webauthn/verify').send(VALID_VERIFY_BODY);
    expect(res.status).toBe(401);
  });

  it('400 when challengeId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, challengeId: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/challengeId/i);
  });

  it('400 when clientDataJSON is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, clientDataJSON: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/clientDataJSON/i);
  });

  it('400 when authenticatorData is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, authenticatorData: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/authenticatorData/i);
  });

  it('400 when signature is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, signature: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it('400 when credential id is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, id: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id is required/i);
  });

  it('400 when rawId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, rawId: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rawId/i);
  });

  it('400 when type is not public-key', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, type: 'other' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/public-key/i);
  });

  it('400 when clientExtensionResults is null', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, clientExtensionResults: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/clientExtensionResults/i);
  });

  it('400 when clientDataJSON is malformed (not base64 JSON)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send({ ...VALID_VERIFY_BODY, clientDataJSON: 'not-valid-base64-json!!!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/malformed clientDataJSON/i);
  });

  it('401 when consumeWebAuthnChallenge returns valid=false', async () => {
    const { consumeWebAuthnChallenge } = await import('../../services/auth/webauthnChallenge.js');
    vi.mocked(consumeWebAuthnChallenge).mockResolvedValueOnce({ valid: false, reason: 'consumed' });
    const { findByCredentialId } = await import('../../services/auth/webauthnCredentialStore.js');
    vi.mocked(findByCredentialId).mockResolvedValueOnce(null);

    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send(VALID_VERIFY_BODY);
    expect(res.status).toBe(401);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('consumed');
  });

  it('401 when credential is unknown', async () => {
    const { consumeWebAuthnChallenge } = await import('../../services/auth/webauthnChallenge.js');
    vi.mocked(consumeWebAuthnChallenge).mockResolvedValueOnce({ valid: true });
    const { findByCredentialId } = await import('../../services/auth/webauthnCredentialStore.js');
    vi.mocked(findByCredentialId).mockResolvedValueOnce(null);

    const res = await request(buildApp())
      .post('/api/auth/webauthn/verify')
      .set('x-test-uid', 'worker-1')
      .send(VALID_VERIFY_BODY);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('unknown_credential');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/auth/webauthn/register/options
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/webauthn/register/options', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/auth/webauthn/register/options');
    expect(res.status).toBe(401);
  });

  it('200 returns challengeId and options', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/register/options')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(200);
    expect(typeof res.body.challengeId).toBe('string');
    expect(res.body.options).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/auth/webauthn/register/verify
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/webauthn/register/verify', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/register/verify')
      .send({ challengeId: 'c2hvcnRjaGFsbGVuZ2U', attestationResponse: { id: 'cred-1' } });
    expect(res.status).toBe(401);
  });

  it('400 when challengeId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/register/verify')
      .set('x-test-uid', 'worker-1')
      .send({ challengeId: '', attestationResponse: { id: 'cred-1' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/challengeId/i);
  });

  it('400 when attestationResponse is missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/register/verify')
      .set('x-test-uid', 'worker-1')
      .send({ challengeId: 'c2hvcnRjaGFsbGVuZ2U', attestationResponse: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attestationResponse/i);
  });

  it('400 when attestationResponse has no id', async () => {
    const res = await request(buildApp())
      .post('/api/auth/webauthn/register/verify')
      .set('x-test-uid', 'worker-1')
      .send({ challengeId: 'c2hvcnRjaGFsbGVuZ2U', attestationResponse: { notId: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attestationResponse/i);
  });

  it('401 when consumeWebAuthnChallenge returns valid=false during registration', async () => {
    const { consumeWebAuthnChallenge } = await import('../../services/auth/webauthnChallenge.js');
    vi.mocked(consumeWebAuthnChallenge).mockResolvedValueOnce({ valid: false, reason: 'expired' });

    const res = await request(buildApp())
      .post('/api/auth/webauthn/register/verify')
      .set('x-test-uid', 'worker-1')
      .send({ challengeId: 'c2hvcnRjaGFsbGVuZ2U', attestationResponse: { id: 'cred-1' } });
    expect(res.status).toBe(401);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('expired');
  });

  it('200 registers credential and writes audit log', async () => {
    const { consumeWebAuthnChallenge } = await import('../../services/auth/webauthnChallenge.js');
    vi.mocked(consumeWebAuthnChallenge).mockResolvedValueOnce({ valid: true });

    const res = await request(buildApp())
      .post('/api/auth/webauthn/register/verify')
      .set('x-test-uid', 'worker-1')
      .send({ challengeId: 'c2hvcnRjaGFsbGVuZ2U', attestationResponse: { id: 'cred-1' } });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(typeof res.body.credentialId).toBe('string');

    // Audit log: auth.webauthn.registered
    const auditSnap = await H.db!.collection('audit_logs').get();
    const actions = auditSnap.docs.map((d) => d.data()!.action);
    expect(actions).toContain('auth.webauthn.registered');
    // userId stamped server-side, not from client
    const registeredAudit = auditSnap.docs.find((d) => d.data()!.action === 'auth.webauthn.registered');
    expect(registeredAudit!.data()!.userId).toBe('worker-1');
  });
});
