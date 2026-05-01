// Praeventio Guard — Round 20 R5: POST /api/auth/webauthn/register/options
// + /verify supertest harness.
//
// Closes the TODO from R19 (`webauthnCredentialStore.ts` line 34): the
// /verify pipeline assumed credentials were pre-seeded via the Firebase
// Admin SDK. R20 ships the in-app registration ceremony so a worker can
// enroll a passkey / Touch ID / security key end-to-end.
//
// Coverage matrix (R20 R5 + R20 R6 MEDIUM #2):
//   1. 401 when Bearer header is missing (options + verify)
//   2. 200 happy path — register/options issues a challenge AND
//      register/verify persists the credential via registerCredential()
//   3. 200 idempotent register — second register with the same
//      credentialId overwrites the row (matches registerCredential
//      contract).
//   4. 401 when verifyRegistrationResponse → verified:false
//      (reason='attestation_invalid')
//   5. 401 when verifyRegistrationResponse throws (origin mismatch,
//      RP-id mismatch, attestation parse error → reason='attestation_invalid')
//   6. 401 when the challenge has already been consumed (replay attempt
//      on /register/verify)
//   7. 401 when challengeId points at a never-issued challenge
//      (reason='unknown')
//   8. 401 when challenge has expired (reason='expired')
//   9. Audit row contains uid + credentialId only — NEVER the public-key bytes
//  10. webauthnRegisterLimiter — 4th call within 60s gets 429
//  11. cross-uid isolation — uid A's quota does NOT throttle uid B
//  12. expectedOrigin prod fail-fast — module-load throws when
//      NODE_ENV=production with no APP_BASE_URL/APP_URL set.
//
// Strategy mirrors webauthnVerify.test.ts: parallel minimal Express app
// that re-implements the production handler verbatim. Drift is detected
// by reviewing both files in the same PR + by the `expectedOrigin`
// fail-fast test which boots the REAL module via dynamic import.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { InMemoryFirestore, type FakeAuth } from './test-server.js';
import {
  storeWebAuthnChallenge,
  consumeWebAuthnChallenge,
  type MinimalChallengesDb,
} from '../../services/auth/webauthnChallenge.js';
import {
  registerCredential as registerCredentialSvc,
  findByCredentialId,
  type MinimalCredentialsDb,
} from '../../services/auth/webauthnCredentialStore.js';

// Mock the @simplewebauthn/server primitives. The unit suite cannot
// produce a real attestation (would need a hardware-bound private key),
// so we intercept and return canned responses. Real crypto is exercised
// by upstream package tests + manual e2e on devices.
const mockGenerateRegistrationOptions = vi.fn();
const mockVerifyRegistrationResponse = vi.fn();
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (opts: any) => mockGenerateRegistrationOptions(opts),
  verifyRegistrationResponse: (opts: any) => mockVerifyRegistrationResponse(opts),
  // verifyAuthenticationResponse is unused in this suite but the
  // production module imports it — make the mock surface complete.
  verifyAuthenticationResponse: vi.fn(),
}));

const FAKE_AUTH: FakeAuth = {
  async verifyIdToken(token: string) {
    if (token === 'invalid') throw new Error('invalid token');
    const [, uid, email] = token.split(':');
    return { uid: uid ?? 'uid-default', email: email || `${uid}@test.com` };
  },
  async getUser(uid: string) {
    return { uid, email: `${uid}@test.com`, customClaims: {} };
  },
  async getUserByEmail() {
    throw Object.assign(new Error('user not found'), { code: 'auth/user-not-found' });
  },
  async setCustomUserClaims() {},
  async revokeRefreshTokens() {},
};

function buildTestChallengesDb(
  fs: InMemoryFirestore,
  now: () => number,
): MinimalChallengesDb {
  return {
    now,
    collection(name: string) {
      return {
        doc(id: string) {
          const key = `${name}/${id}`;
          return {
            async get() {
              const data = fs.store.get(key);
              return {
                exists: data !== undefined,
                id,
                data: () => data,
              };
            },
            async set(data: Record<string, unknown>) {
              fs.store.set(key, { ...data });
            },
            async updateIf(
              precondition: (current: Record<string, unknown> | undefined) => boolean,
              patch: Record<string, unknown>,
            ): Promise<boolean> {
              const cur = fs.store.get(key);
              if (!precondition(cur)) return false;
              fs.store.set(key, { ...(cur ?? {}), ...patch });
              return true;
            },
          };
        },
      };
    },
  };
}

function buildTestCredentialsDb(
  fs: InMemoryFirestore,
  now: () => number,
): MinimalCredentialsDb {
  return {
    now,
    collection(name: string) {
      return {
        doc(id: string) {
          const key = `${name}/${id}`;
          return {
            async get() {
              const data = fs.store.get(key);
              return {
                exists: data !== undefined,
                id,
                data: () => data,
              };
            },
            async set(data: Record<string, unknown>) {
              fs.store.set(key, { ...data });
            },
            async update(patch: Record<string, unknown>) {
              const cur = fs.store.get(key);
              if (!cur) throw new Error('document does not exist');
              fs.store.set(key, { ...cur, ...patch });
            },
          };
        },
        where(field: string, _op: '==', value: unknown) {
          return {
            async get() {
              const docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
              for (const [key, data] of fs.store.entries()) {
                if (!key.startsWith(`${name}/`)) continue;
                if ((data as Record<string, unknown>)[field] === value) {
                  docs.push({
                    id: key.slice(name.length + 1),
                    data: () => data as Record<string, unknown>,
                  });
                }
              }
              return { empty: docs.length === 0, docs };
            },
          };
        },
      };
    },
  };
}

interface RegisterTestDeps {
  firestore: InMemoryFirestore;
  auth: FakeAuth;
  now?: () => number;
  expectedOrigin?: string;
  expectedRPID?: string;
  /** Override register limiter `max` per-test so we don't have to spam 4 reqs. */
  registerMax?: number;
  registerWindowMs?: number;
}

/**
 * Verbatim copy of the production R20 handler in
 * `src/server/routes/curriculum.ts`. Drift is mitigated the same way the
 * rest of __tests__/server is — checking both files in the same review.
 */
function buildRegisterApp(deps: RegisterTestDeps): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const now = deps.now ?? (() => Date.now());
  const challengesDb = buildTestChallengesDb(deps.firestore, now);
  const credsDb = buildTestCredentialsDb(deps.firestore, now);

  const verifyAuth = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
      const decoded = await deps.auth.verifyIdToken(token);
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  };

  // Mirrors src/server/middleware/limiters.ts → webauthnRegisterLimiter.
  // Re-instantiated per test so the in-memory counter store does not
  // leak counts across tests.
  const registerLimiter = rateLimit({
    windowMs: deps.registerWindowMs ?? 60 * 1000,
    max: deps.registerMax ?? 3,
    keyGenerator: (req: any) => (req as any).user?.uid || req.ip || 'anonymous',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_register_attempts', retryAfterMs: 60_000 },
  });

  const EXPECTED_ORIGIN = deps.expectedOrigin ?? 'http://localhost:3000';
  const EXPECTED_RP_ID = deps.expectedRPID ?? 'localhost';

  app.post(
    '/api/auth/webauthn/register/options',
    verifyAuth,
    registerLimiter,
    async (req: any, res) => {
      const callerUid = req.user.uid;
      const callerEmail: string | null = req.user.email ?? null;
      try {
        const { generateRegistrationOptions } = await import('@simplewebauthn/server');
        const options = await generateRegistrationOptions({
          rpName: 'Praeventio Guard',
          rpID: EXPECTED_RP_ID,
          userName: callerEmail ?? callerUid,
          userDisplayName: callerEmail ?? 'Praeventio Worker',
          attestationType: 'none',
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'required',
          },
        } as any);
        const challengeBytes = new Uint8Array(
          Buffer.from(
            (options as any).challenge.replace(/-/g, '+').replace(/_/g, '/'),
            'base64',
          ),
        );
        const challengeId = (options as any).challenge;
        await storeWebAuthnChallenge(callerUid, challengeId, challengeBytes, challengesDb);
        return res.json({ challengeId, options });
      } catch (err: any) {
        return res.status(500).json({ error: err?.message || 'Internal' });
      }
    },
  );

  app.post(
    '/api/auth/webauthn/register/verify',
    verifyAuth,
    registerLimiter,
    async (req: any, res) => {
      const callerUid = req.user.uid;
      const { challengeId, attestationResponse } = req.body ?? {};

      if (typeof challengeId !== 'string' || challengeId.length === 0 || challengeId.length > 1024) {
        return res.status(400).json({ error: 'challengeId is required' });
      }
      if (
        !attestationResponse ||
        typeof attestationResponse !== 'object' ||
        typeof (attestationResponse as any).id !== 'string'
      ) {
        return res.status(400).json({ error: 'attestationResponse is required' });
      }

      let providedChallenge: Uint8Array;
      try {
        const b64 = challengeId.replace(/-/g, '+').replace(/_/g, '/');
        providedChallenge = new Uint8Array(Buffer.from(b64, 'base64'));
      } catch {
        return res.status(400).json({ error: 'malformed challengeId' });
      }

      const consumeResult = await consumeWebAuthnChallenge(
        callerUid,
        challengeId,
        providedChallenge,
        challengesDb,
      );
      if (consumeResult.valid === false) {
        return res
          .status(401)
          .json({ verified: false, reason: consumeResult.reason });
      }

      const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
      let verification: any;
      try {
        verification = await verifyRegistrationResponse({
          response: attestationResponse,
          expectedChallenge: challengeId,
          expectedOrigin: EXPECTED_ORIGIN,
          expectedRPID: EXPECTED_RP_ID,
          requireUserVerification: true,
        } as any);
      } catch {
        return res.status(401).json({ verified: false, reason: 'attestation_invalid' });
      }

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(401).json({ verified: false, reason: 'attestation_invalid' });
      }

      const { credential } = verification.registrationInfo;
      const credentialIdStr = credential.id as string;
      const publicKeyBytes =
        credential.publicKey instanceof Uint8Array
          ? credential.publicKey
          : new Uint8Array(credential.publicKey as ArrayBuffer);

      await registerCredentialSvc(
        callerUid,
        {
          credentialId: credentialIdStr,
          publicKey: publicKeyBytes,
          counter: credential.counter,
          transports: credential.transports as string[] | undefined,
        },
        credsDb,
      );

      await deps.firestore.collection('audit_logs').add({
        action: 'auth.webauthn.registered',
        module: 'curriculum',
        userId: callerUid,
        details: { uid: callerUid, credentialId: credentialIdStr },
      });

      return res.json({ verified: true, credentialId: credentialIdStr });
    },
  );

  return app;
}

describe('POST /api/auth/webauthn/register — R20 R5 ceremony', () => {
  let fs: InMemoryFirestore;
  let app: Express;

  beforeEach(() => {
    fs = new InMemoryFirestore();
    mockGenerateRegistrationOptions.mockReset();
    mockVerifyRegistrationResponse.mockReset();
    app = buildRegisterApp({ firestore: fs, auth: FAKE_AUTH });
  });

  /** Standard register/options happy-path stub. */
  function stubOptions(challenge = 'CHAL_BASE64URL_AAA') {
    mockGenerateRegistrationOptions.mockResolvedValueOnce({
      challenge,
      rp: { name: 'Praeventio Guard', id: 'localhost' },
      user: { id: 'dXNlcg', name: 'u', displayName: 'u' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      timeout: 60000,
      attestation: 'none',
    });
  }

  /** Standard register/verify happy-path stub returning a registered credential. */
  function stubVerify(credentialId = 'cred-NEW', counter = 0) {
    mockVerifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        aaguid: '00000000-0000-0000-0000-000000000000',
        credentialType: 'public-key',
        attestationObject: new Uint8Array([0x1, 0x2]),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
        credential: {
          id: credentialId,
          publicKey: new Uint8Array([0xa, 0xb, 0xc]),
          counter,
          transports: ['internal'],
        },
      },
    });
  }

  it('returns 401 when Bearer header is missing on /register/options', async () => {
    const res = await request(app)
      .post('/api/auth/webauthn/register/options')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 401 when Bearer header is missing on /register/verify', async () => {
    const res = await request(app)
      .post('/api/auth/webauthn/register/verify')
      .send({});
    expect(res.status).toBe(401);
  });

  it('200 happy path — /register/options issues a challenge, /register/verify persists the credential', async () => {
    const uid = 'uid-happy';
    const auth = `Bearer test:${uid}:happy@test.com`;

    stubOptions('HAPPY_CH_AAA');
    const optionsRes = await request(app)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});
    expect(optionsRes.status).toBe(200);
    expect(optionsRes.body.challengeId).toBe('HAPPY_CH_AAA');
    expect(optionsRes.body.options.challenge).toBe('HAPPY_CH_AAA');

    stubVerify('cred-HAPPY', 0);
    const verifyRes = await request(app)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'HAPPY_CH_AAA',
        attestationResponse: {
          id: 'cred-HAPPY',
          rawId: 'cred-HAPPY',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.verified).toBe(true);
    expect(verifyRes.body.credentialId).toBe('cred-HAPPY');

    // Credential persisted under uid-happy.
    const credsDb = buildTestCredentialsDb(fs, () => Date.now());
    const stored = await findByCredentialId('cred-HAPPY', credsDb);
    expect(stored).not.toBeNull();
    expect(stored!.uid).toBe(uid);
    expect(stored!.credential.counter).toBe(0);
  });

  it('200 idempotent — re-registering the same credentialId overwrites the row', async () => {
    const uid = 'uid-idem';
    const auth = `Bearer test:${uid}:idem@test.com`;
    // Two ceremonies = 4 hits on the limiter; bump the cap so the
    // limiter doesn't pre-empt the idempotent scenario.
    const idemApp = buildRegisterApp({
      firestore: fs,
      auth: FAKE_AUTH,
      registerMax: 10,
    });

    // First registration
    stubOptions('IDEM_CH_1');
    await request(idemApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});
    stubVerify('cred-IDEM', 0);
    const first = await request(idemApp)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'IDEM_CH_1',
        attestationResponse: {
          id: 'cred-IDEM',
          rawId: 'cred-IDEM',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(first.status).toBe(200);

    // Second registration with the same credentialId on a NEW challenge.
    stubOptions('IDEM_CH_2');
    await request(idemApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});
    stubVerify('cred-IDEM', 7); // counter advanced
    const second = await request(idemApp)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'IDEM_CH_2',
        attestationResponse: {
          id: 'cred-IDEM',
          rawId: 'cred-IDEM',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(second.status).toBe(200);
    expect(second.body.credentialId).toBe('cred-IDEM');

    // Counter from the second registration overwrote the first.
    const credsDb = buildTestCredentialsDb(fs, () => Date.now());
    const stored = await findByCredentialId('cred-IDEM', credsDb);
    expect(stored!.credential.counter).toBe(7);
  });

  it('401 reason=attestation_invalid when verifyRegistrationResponse → verified:false', async () => {
    const uid = 'uid-bad-att';
    const auth = `Bearer test:${uid}:bad@test.com`;
    stubOptions('BAD_CH_1');
    await request(app)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});

    mockVerifyRegistrationResponse.mockResolvedValueOnce({
      verified: false,
      registrationInfo: undefined,
    });
    const res = await request(app)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'BAD_CH_1',
        attestationResponse: {
          id: 'cred-BAD',
          rawId: 'cred-BAD',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('attestation_invalid');
  });

  it('401 reason=attestation_invalid when verifyRegistrationResponse throws (origin mismatch / RP-id mismatch)', async () => {
    const uid = 'uid-thr';
    const auth = `Bearer test:${uid}:thr@test.com`;
    stubOptions('THR_CH_1');
    await request(app)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});

    mockVerifyRegistrationResponse.mockRejectedValueOnce(
      new Error('Unexpected registration response origin "https://attacker.example"'),
    );
    const res = await request(app)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'THR_CH_1',
        attestationResponse: {
          id: 'cred-THR',
          rawId: 'cred-THR',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('attestation_invalid');
  });

  it('401 reason=consumed on replay — second register/verify with the same challengeId fails', async () => {
    const uid = 'uid-replay';
    const auth = `Bearer test:${uid}:rp@test.com`;
    stubOptions('REPLAY_CH');
    await request(app)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});

    stubVerify('cred-REPLAY', 0);
    const r1 = await request(app)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'REPLAY_CH',
        attestationResponse: {
          id: 'cred-REPLAY',
          rawId: 'cred-REPLAY',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(r1.status).toBe(200);

    // Replay attempt — same challenge, even with a fresh signed body.
    stubVerify('cred-REPLAY', 0);
    const r2 = await request(app)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'REPLAY_CH',
        attestationResponse: {
          id: 'cred-REPLAY',
          rawId: 'cred-REPLAY',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(r2.status).toBe(401);
    expect(r2.body.reason).toBe('consumed');
  });

  it('401 reason=unknown when challengeId was never issued', async () => {
    const uid = 'uid-unk';
    const auth = `Bearer test:${uid}:un@test.com`;
    const res = await request(app)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'NEVER_ISSUED',
        attestationResponse: {
          id: 'cred-X',
          rawId: 'cred-X',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('unknown');
  });

  it('401 reason=expired when the challenge TTL has elapsed', async () => {
    const uid = 'uid-exp';
    const auth = `Bearer test:${uid}:ex@test.com`;
    let fakeNow = 1_000_000_000_000;
    const expiringFs = new InMemoryFirestore();
    const expiringApp = buildRegisterApp({
      firestore: expiringFs,
      auth: FAKE_AUTH,
      now: () => fakeNow,
    });

    // We can't pass ttlMs through generateRegistrationOptions, but we
    // can drive the challenge TTL directly via storeWebAuthnChallenge
    // by simulating the options path: stub generateRegistrationOptions
    // → app stores via storeWebAuthnChallenge with the default TTL,
    // then we advance the clock past it.
    stubOptions('EXP_CH');
    await request(expiringApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});

    fakeNow += 10 * 60 * 1000; // 10 minutes — past the 5-minute default TTL

    stubVerify('cred-EXP', 0);
    const res = await request(expiringApp)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'EXP_CH',
        attestationResponse: {
          id: 'cred-EXP',
          rawId: 'cred-EXP',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('expired');
  });

  it('audit row records uid + credentialId only — never the public-key bytes', async () => {
    const uid = 'uid-audit';
    const auth = `Bearer test:${uid}:au@test.com`;
    stubOptions('AUDIT_CH');
    await request(app)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});

    // Stub a verify that ships a recognizable public-key byte sequence
    // we can grep for in the audit row.
    mockVerifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        aaguid: '00000000-0000-0000-0000-000000000000',
        credentialType: 'public-key',
        attestationObject: new Uint8Array([0x1, 0x2]),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        credential: {
          id: 'cred-AUD',
          // Recognizable bytes whose base64 is 'c2VjcmV0LXB1Yi1rZXk=' for 'secret-pub-key'
          publicKey: new TextEncoder().encode('secret-pub-key'),
          counter: 0,
          transports: ['internal'],
        },
      },
    });

    await request(app)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'AUDIT_CH',
        attestationResponse: {
          id: 'cred-AUD',
          rawId: 'cred-AUD',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });

    const audited = fs.audit.find((e) => e.action === 'auth.webauthn.registered');
    expect(audited).toBeDefined();
    expect(audited!.userId).toBe(uid);
    expect(audited!.details).toEqual({ uid, credentialId: 'cred-AUD' });
    const dump = JSON.stringify(audited);
    // base64('secret-pub-key') = 'c2VjcmV0LXB1Yi1rZXk='
    expect(dump).not.toContain('c2VjcmV0LXB1Yi1rZXk');
    expect(dump).not.toContain('publicKey');
    expect(dump).not.toContain('attestationObject');
  });

  it('rate-limit: 4th call within 60s gets 429 (max=3)', async () => {
    const uid = 'uid-rl';
    const auth = `Bearer test:${uid}:rl@test.com`;
    const limitedApp = buildRegisterApp({
      firestore: fs,
      auth: FAKE_AUTH,
      registerMax: 3,
    });

    stubOptions('RL_1');
    const a = await request(limitedApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});
    expect(a.status).toBe(200);
    stubOptions('RL_2');
    const b = await request(limitedApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});
    expect(b.status).toBe(200);
    stubOptions('RL_3');
    const c = await request(limitedApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', auth)
      .send({});
    expect(c.status).toBe(200);

    // 4th call — even on a different sub-route — trips the limiter.
    const d = await request(limitedApp)
      .post('/api/auth/webauthn/register/verify')
      .set('Authorization', auth)
      .send({
        challengeId: 'RL_3',
        attestationResponse: {
          id: 'cred-RL',
          rawId: 'cred-RL',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
          clientExtensionResults: {},
        },
      });
    expect(d.status).toBe(429);
    expect(d.body.error).toBe('too_many_register_attempts');
    expect(d.body.retryAfterMs).toBe(60_000);
  });

  it('cross-uid isolation — uid A exhausting its quota does NOT throttle uid B', async () => {
    const limitedApp = buildRegisterApp({
      firestore: fs,
      auth: FAKE_AUTH,
      registerMax: 2,
    });
    const authA = `Bearer test:uid-A:a@test.com`;
    const authB = `Bearer test:uid-B:b@test.com`;

    stubOptions('A_1');
    await request(limitedApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', authA)
      .send({});
    stubOptions('A_2');
    await request(limitedApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', authA)
      .send({});
    // 3rd from uid A → 429
    const blocked = await request(limitedApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', authA)
      .send({});
    expect(blocked.status).toBe(429);

    // uid B is fresh — first call still succeeds.
    stubOptions('B_1');
    const okB = await request(limitedApp)
      .post('/api/auth/webauthn/register/options')
      .set('Authorization', authB)
      .send({});
    expect(okB.status).toBe(200);
    expect(okB.body.challengeId).toBe('B_1');
  });
});

// ───────────────────────────────────────────────────────────────────────
// Round 20 R6 MEDIUM #2 — expectedOrigin prod fail-fast guard.
//
// The production curriculum.ts module computes expectedOrigin at boot.
// In production with no APP_BASE_URL/APP_URL the module MUST throw at
// import time (refusing to load) — the WebAuthn signature-verify path
// would otherwise silently fall back to http://localhost:3000 and reject
// every legitimate assertion as `signature_invalid`.
//
// We exercise this by manipulating process.env BEFORE dynamically
// importing curriculum.ts. We do NOT cache the import, and we restore
// env between tests so other suites stay deterministic.
// ───────────────────────────────────────────────────────────────────────

describe('curriculum module-load — expectedOrigin prod fail-fast', () => {
  const ORIGINAL = {
    NODE_ENV: process.env.NODE_ENV,
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_URL: process.env.APP_URL,
  };
  const RESEND_KEY = process.env.RESEND_API_KEY;

  beforeEach(() => {
    // The module instantiates a Resend client at load — give it a stub
    // value so that side-effect doesn't fail for an unrelated reason.
    if (!process.env.RESEND_API_KEY) process.env.RESEND_API_KEY = 're_test_stub';
    // firebase-admin's default app instantiation won't happen because
    // curriculum.ts doesn't call admin.initializeApp() at module load
    // — it only calls admin.firestore() lazily inside handlers. The
    // import itself is safe.
  });

  function restore() {
    if (ORIGINAL.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL.NODE_ENV;
    if (ORIGINAL.APP_BASE_URL === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = ORIGINAL.APP_BASE_URL;
    if (ORIGINAL.APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = ORIGINAL.APP_URL;
    if (RESEND_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = RESEND_KEY;
  }

  it('throws at module-load when NODE_ENV=production AND APP_BASE_URL/APP_URL are unset', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_BASE_URL;
    delete process.env.APP_URL;

    // Drop any cached copy of the module so the boot guard runs fresh.
    vi.resetModules();
    let captured: unknown = null;
    try {
      await import('../../server/routes/curriculum.js');
    } catch (err) {
      captured = err;
    } finally {
      restore();
      vi.resetModules();
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toMatch(/FATAL|APP_BASE_URL|APP_URL/);
  });
});
