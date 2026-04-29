// Praeventio Guard — Round 18 R6 (Round 17 MEDIUM #1 close-out):
// POST /api/auth/webauthn/verify HTTP-layer supertest harness.
//
// Round 17 R5 shipped the GET /api/auth/webauthn/challenge endpoint and the
// `consumeWebAuthnChallenge` Firestore-transactional consume helper. The
// matching POST /verify endpoint (which the client calls AFTER WebAuthn
// returns its assertion) was deferred. R6 R17 flagged the gap as a
// downgrade vector: a malicious client could happily ignore the server
// challenge and submit a stolen, replay-able assertion forever.
//
// This test mounts a parallel minimal Express app that re-implements the
// production handler from src/server/routes/curriculum.ts
// (`webauthnChallengeRouter` / POST /webauthn/verify). Drift is mitigated
// the same way the rest of __tests__/server is — the handler here is a
// near-verbatim copy, and the consume helper is the REAL one.
//
// Coverage matrix (R18 R6):
//   1. 401 missing Bearer
//   2. 401 invalid Bearer
//   3. 400 missing challengeId
//   4. 400 malformed body (missing clientDataJSON / authenticatorData / signature)
//   5. 200 happy path (consume succeeds + audit row emitted)
//   6. 401 unknown challenge (consume returns valid:false, reason='unknown')
//   7. 401 expired challenge (reason='expired')
//   8. 401 already-consumed (replay attempt — reason='consumed')
//   9. Audit row contains uid only — NO assertion bytes (clientDataJSON,
//      authenticatorData, signature MUST NOT appear in the audit details).
//
// CRITICAL invariant: the verify endpoint MUST be fail-closed. There is no
// "best effort" branch — if the challenge cannot be consumed atomically,
// the request is rejected with 401. This closes the R6 finding.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { InMemoryFirestore, type FakeAuth } from './test-server.js';
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
  consumeWebAuthnChallenge,
  type MinimalChallengesDb,
} from '../../services/auth/webauthnChallenge.js';
import {
  registerCredential,
  findByCredentialId,
  updateCounter as updateCredentialCounter,
  decodePublicKey,
  type MinimalCredentialsDb,
} from '../../services/auth/webauthnCredentialStore.js';

// Round 19: mock @simplewebauthn/server's verifyAuthenticationResponse so
// the supertest pipeline can simulate signature-verify outcomes (verified
// true, verified false, throws) without producing real WebAuthn
// assertions inside the unit harness. Real crypto verification is
// covered by upstream package tests + manual e2e on real devices.
const mockVerifyAuthenticationResponse = vi.fn();
vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: (opts: any) => mockVerifyAuthenticationResponse(opts),
}));

interface VerifyTestDeps {
  firestore: InMemoryFirestore;
  auth: FakeAuth;
  /** Injected clock — defaults to Date.now. Tests override for TTL. */
  now?: () => number;
}

/**
 * Adapter that bridges the InMemoryFirestore test fake to the
 * MinimalChallengesDb surface the consume helper expects. Mirrors
 * `buildWebAuthnDb` in curriculum.ts but uses the test fake instead of
 * firebase-admin's transaction primitive.
 */
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

function buildVerifyApp(deps: VerifyTestDeps): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const now = deps.now ?? (() => Date.now());
  const challengesDb = buildTestChallengesDb(deps.firestore, now);

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

  // Verbatim copy of the production handler (curriculum.ts /webauthn/verify).
  app.post('/api/auth/webauthn/verify', verifyAuth, async (req: any, res) => {
    const callerUid = req.user.uid;
    const { challengeId, clientDataJSON, authenticatorData, signature } = req.body ?? {};

    // Shape validation. All four fields are required strings (the client
    // base64-encodes the WebAuthn assertion bytes before sending them).
    if (typeof challengeId !== 'string' || challengeId.length === 0 || challengeId.length > 256) {
      return res.status(400).json({ error: 'challengeId is required' });
    }
    if (typeof clientDataJSON !== 'string' || clientDataJSON.length === 0) {
      return res.status(400).json({ error: 'clientDataJSON is required' });
    }
    if (typeof authenticatorData !== 'string' || authenticatorData.length === 0) {
      return res.status(400).json({ error: 'authenticatorData is required' });
    }
    if (typeof signature !== 'string' || signature.length === 0) {
      return res.status(400).json({ error: 'signature is required' });
    }

    // Decode the base64 clientDataJSON to extract the original challenge
    // bytes the browser saw. The challenge field is the first 32 bytes
    // the server issued (round-trip through the WebAuthn ceremony).
    let providedChallenge: Uint8Array;
    try {
      const cdjStr = Buffer.from(clientDataJSON, 'base64').toString('utf8');
      const cdj = JSON.parse(cdjStr);
      const chB64u = String(cdj.challenge ?? '');
      // base64url → base64
      const b64 = chB64u.replace(/-/g, '+').replace(/_/g, '/');
      providedChallenge = new Uint8Array(Buffer.from(b64, 'base64'));
    } catch {
      return res.status(400).json({ error: 'malformed clientDataJSON' });
    }

    const result = await consumeWebAuthnChallenge(
      callerUid,
      challengeId,
      providedChallenge,
      challengesDb,
    );
    if (result.valid === false) {
      return res.status(401).json({ verified: false, reason: result.reason });
    }

    // TODO R19: integrate @simplewebauthn/server to CBOR-decode the
    // authenticatorData + verify the assertion signature against the
    // user's stored public key. For now (MVP) we trust the assertion if
    // the challenge consume succeeds — replay is already prevented via
    // the single-use challenge cache.
    await deps.firestore.collection('audit_logs').add({
      action: 'auth.webauthn.verified',
      module: 'auth',
      userId: callerUid,
      // SECURITY: ONLY the uid. NEVER the assertion bytes.
      details: { uid: callerUid },
    });

    return res.json({ verified: true, uid: callerUid });
  });

  return app;
}

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

/**
 * Helper: issue + persist a server challenge and return the metadata a
 * "good" client would have (challengeId + base64-encoded clientDataJSON
 * embedding the challenge as base64url, per WebAuthn spec).
 */
async function issueChallenge(
  fs: InMemoryFirestore,
  uid: string,
  now: () => number = () => Date.now(),
  ttlMs?: number,
): Promise<{ challengeId: string; clientDataJSON: string; rawChallenge: Uint8Array }> {
  const { challengeId, challenge } = generateWebAuthnChallenge();
  await storeWebAuthnChallenge(uid, challengeId, challenge, buildTestChallengesDb(fs, now), {
    ttlMs,
  });
  // Construct the clientDataJSON the browser would build. WebAuthn uses
  // base64url (no padding) for the challenge inside clientDataJSON.
  const challengeB64u = Buffer.from(challenge)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const cdj = JSON.stringify({
    type: 'webauthn.get',
    challenge: challengeB64u,
    origin: 'https://app.praeventio.net',
  });
  const clientDataJSON = Buffer.from(cdj, 'utf8').toString('base64');
  return { challengeId, clientDataJSON, rawChallenge: challenge };
}

describe('POST /api/auth/webauthn/verify', () => {
  let fs: InMemoryFirestore;
  let app: Express;

  beforeEach(() => {
    fs = new InMemoryFirestore();
    app = buildVerifyApp({ firestore: fs, auth: FAKE_AUTH });
  });

  it('returns 401 when Bearer header is missing', async () => {
    const res = await request(app).post('/api/auth/webauthn/verify').send({});
    expect(res.status).toBe(401);
  });

  it('returns 401 when Bearer token is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', 'Bearer invalid')
      .send({
        challengeId: 'cid',
        clientDataJSON: 'x',
        authenticatorData: 'x',
        signature: 'x',
      });
    expect(res.status).toBe(401);
  });

  it('returns 400 when challengeId is missing', async () => {
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', 'Bearer test:uid-1:user@test.com')
      .send({ clientDataJSON: 'x', authenticatorData: 'y', signature: 'z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/challengeId/);
  });

  it('returns 400 when clientDataJSON / authenticatorData / signature are missing', async () => {
    const baseAuth = 'Bearer test:uid-2:user@test.com';
    const r1 = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', baseAuth)
      .send({ challengeId: 'cid' });
    expect(r1.status).toBe(400);
    const r2 = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', baseAuth)
      .send({ challengeId: 'cid', clientDataJSON: 'x' });
    expect(r2.status).toBe(400);
    const r3 = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', baseAuth)
      .send({ challengeId: 'cid', clientDataJSON: 'x', authenticatorData: 'y' });
    expect(r3.status).toBe(400);
  });

  it('returns 400 when clientDataJSON is not valid base64-encoded JSON', async () => {
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', 'Bearer test:uid-3:user@test.com')
      .send({
        challengeId: 'cid',
        clientDataJSON: 'not-base64-json!!!',
        authenticatorData: 'y',
        signature: 'z',
      });
    expect(res.status).toBe(400);
  });

  it('returns 200 verified:true on happy path + emits audit row', async () => {
    const uid = 'uid-happy';
    const issued = await issueChallenge(fs, uid);
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:happy@test.com`)
      .send({
        challengeId: issued.challengeId,
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'aGVsbG8=', // base64('hello') — placeholder until R19
        signature: 'c2ln', // base64('sig')
      });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.uid).toBe(uid);
    expect(fs.audit.some((e) => e.action === 'auth.webauthn.verified')).toBe(true);
  });

  it('returns 401 when challengeId does not match any stored challenge', async () => {
    const uid = 'uid-unknown';
    // Build a clientDataJSON that points at a challengeId we never stored.
    const fakeChallenge = new Uint8Array(32);
    crypto.getRandomValues(fakeChallenge);
    const challengeB64u = Buffer.from(fakeChallenge)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const cdj = JSON.stringify({
      type: 'webauthn.get',
      challenge: challengeB64u,
      origin: 'https://app.praeventio.net',
    });
    const clientDataJSON = Buffer.from(cdj, 'utf8').toString('base64');
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:u@test.com`)
      .send({
        challengeId: 'a'.repeat(64), // 64-char hex but never stored
        clientDataJSON,
        authenticatorData: 'aGVsbG8=',
        signature: 'c2ln',
      });
    expect(res.status).toBe(401);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('unknown');
  });

  it('returns 401 when challenge has expired (TTL elapsed)', async () => {
    const uid = 'uid-exp';
    let fakeNow = 1_000_000_000_000;
    const expiringApp = buildVerifyApp({
      firestore: fs,
      auth: FAKE_AUTH,
      now: () => fakeNow,
    });
    const issued = await issueChallenge(fs, uid, () => fakeNow, 1000);
    fakeNow += 5000; // 5s past the 1s TTL
    const res = await request(expiringApp)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:exp@test.com`)
      .send({
        challengeId: issued.challengeId,
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'aGVsbG8=',
        signature: 'c2ln',
      });
    expect(res.status).toBe(401);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('expired');
  });

  it('returns 401 when challenge has already been consumed (replay)', async () => {
    const uid = 'uid-replay';
    const issued = await issueChallenge(fs, uid);
    const auth = `Bearer test:${uid}:replay@test.com`;
    const body = {
      challengeId: issued.challengeId,
      clientDataJSON: issued.clientDataJSON,
      authenticatorData: 'aGVsbG8=',
      signature: 'c2ln',
    };
    const r1 = await request(app).post('/api/auth/webauthn/verify').set('Authorization', auth).send(body);
    expect(r1.status).toBe(200);
    // Second call with the SAME challenge — replay attempt.
    const r2 = await request(app).post('/api/auth/webauthn/verify').set('Authorization', auth).send(body);
    expect(r2.status).toBe(401);
    expect(r2.body.reason).toBe('consumed');
  });

  it('audit row contains uid ONLY — never the assertion bytes', async () => {
    const uid = 'uid-audit';
    const issued = await issueChallenge(fs, uid);
    await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:a@test.com`)
      .send({
        challengeId: issued.challengeId,
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'c2VjcmV0LWF1dGgtZGF0YQ==', // 'secret-auth-data'
        signature: 'c2VjcmV0LXNpZ25hdHVyZQ==', // 'secret-signature'
      });
    const audited = fs.audit.find((e) => e.action === 'auth.webauthn.verified');
    expect(audited).toBeDefined();
    const dump = JSON.stringify(audited);
    // Must NOT contain the base64 of the secret bytes nor the field names
    // of the sensitive WebAuthn fields.
    expect(dump).not.toContain('c2VjcmV0LWF1dGgtZGF0YQ');
    expect(dump).not.toContain('c2VjcmV0LXNpZ25hdHVyZQ');
    expect(dump).not.toContain('clientDataJSON');
    expect(dump).not.toContain('authenticatorData');
    expect(dump).not.toContain('signature');
    // Must contain the uid.
    expect(audited!.userId).toBe(uid);
    expect(audited!.details).toEqual({ uid });
  });
});

// ───────────────────────────────────────────────────────────────────────
// Round 19 R19 A5 — full @simplewebauthn/server crypto-verify path.
// Triggered when the request body includes the credential `id` (base64url).
// The MVP consume-only path above stays alive (legacy clients) — these
// tests exercise the new layer on top.
// ───────────────────────────────────────────────────────────────────────

/** Adapter that bridges the InMemoryFirestore fake to MinimalCredentialsDb. */
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

interface CryptoVerifyTestDeps extends VerifyTestDeps {
  expectedOrigin?: string;
  expectedRPID?: string;
}

function buildCryptoVerifyApp(deps: CryptoVerifyTestDeps): Express {
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

  // Verbatim copy of the production R19 handler in curriculum.ts. Drift
  // is mitigated by checking both files in the same review.
  app.post('/api/auth/webauthn/verify', verifyAuth, async (req: any, res) => {
    const callerUid = req.user.uid;
    const {
      challengeId,
      id: credentialId,
      rawId,
      clientDataJSON,
      authenticatorData,
      signature,
      type: assertionType,
    } = req.body ?? {};

    if (typeof challengeId !== 'string' || challengeId.length === 0 || challengeId.length > 256) {
      return res.status(400).json({ error: 'challengeId is required' });
    }
    if (typeof clientDataJSON !== 'string' || clientDataJSON.length === 0) {
      return res.status(400).json({ error: 'clientDataJSON is required' });
    }
    if (typeof authenticatorData !== 'string' || authenticatorData.length === 0) {
      return res.status(400).json({ error: 'authenticatorData is required' });
    }
    if (typeof signature !== 'string' || signature.length === 0) {
      return res.status(400).json({ error: 'signature is required' });
    }

    let providedChallenge: Uint8Array;
    let challengeB64u: string;
    try {
      const cdjStr = Buffer.from(clientDataJSON, 'base64').toString('utf8');
      const cdj = JSON.parse(cdjStr);
      challengeB64u = String(cdj.challenge ?? '');
      const b64 = challengeB64u.replace(/-/g, '+').replace(/_/g, '/');
      providedChallenge = new Uint8Array(Buffer.from(b64, 'base64'));
    } catch {
      return res.status(400).json({ error: 'malformed clientDataJSON' });
    }

    const result = await consumeWebAuthnChallenge(
      callerUid,
      challengeId,
      providedChallenge,
      challengesDb,
    );
    if (result.valid === false) {
      return res.status(401).json({ verified: false, reason: result.reason });
    }

    if (typeof credentialId === 'string' && credentialId.length > 0) {
      const stored = await findByCredentialId(credentialId, credsDb);
      if (!stored) {
        return res.status(401).json({ verified: false, reason: 'unknown_credential' });
      }
      if (stored.uid !== callerUid) {
        return res.status(401).json({ verified: false, reason: 'unknown_credential' });
      }

      const expectedOrigin = deps.expectedOrigin ?? 'http://localhost:3000';
      const expectedRPID = deps.expectedRPID ?? 'localhost';

      // The mock is set per-test via mockVerifyAuthenticationResponse.
      // Import name-shadowed via the vi.mock at the top of the file.
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
      let verification: any;
      try {
        verification = await verifyAuthenticationResponse({
          response: {
            id: credentialId,
            rawId: typeof rawId === 'string' && rawId.length > 0 ? rawId : credentialId,
            response: { clientDataJSON, authenticatorData, signature },
            clientExtensionResults: {},
            type: (assertionType as 'public-key') ?? 'public-key',
          },
          expectedChallenge: challengeB64u,
          expectedOrigin,
          expectedRPID,
          credential: {
            id: stored.credential.credentialId,
            publicKey: decodePublicKey(stored.credential.publicKey),
            counter: stored.credential.counter,
            transports: stored.credential.transports as any,
          },
          requireUserVerification: true,
        });
      } catch {
        return res.status(401).json({ verified: false, reason: 'signature_invalid' });
      }
      if (!verification.verified) {
        return res.status(401).json({ verified: false, reason: 'signature_invalid' });
      }

      const newCounter = verification.authenticationInfo.newCounter;
      if (stored.credential.counter > 0 && newCounter <= stored.credential.counter) {
        return res.status(401).json({ verified: false, reason: 'counter_replay' });
      }
      await updateCredentialCounter(credentialId, newCounter, credsDb);

      await deps.firestore.collection('audit_logs').add({
        action: 'auth.webauthn.verified',
        module: 'auth',
        userId: callerUid,
        details: { uid: callerUid, credentialId, newCounter },
      });

      return res.json({ verified: true, uid: callerUid, newCounter });
    }

    // Legacy MVP path.
    await deps.firestore.collection('audit_logs').add({
      action: 'auth.webauthn.verified',
      module: 'auth',
      userId: callerUid,
      details: { uid: callerUid },
    });
    return res.json({ verified: true, uid: callerUid });
  });

  return app;
}

describe('POST /api/auth/webauthn/verify — R19 crypto-verify path', () => {
  let fs: InMemoryFirestore;
  let app: Express;

  beforeEach(async () => {
    fs = new InMemoryFirestore();
    app = buildCryptoVerifyApp({ firestore: fs, auth: FAKE_AUTH });
    mockVerifyAuthenticationResponse.mockReset();

    // Seed a credential for uid-crypto so the lookup hits.
    const credsDb = buildTestCredentialsDb(fs, () => Date.now());
    await registerCredential(
      'uid-crypto',
      {
        credentialId: 'cred-CRYPTO',
        publicKey: new Uint8Array([0xa, 0xb, 0xc, 0xd]),
        counter: 5,
        transports: ['internal'],
      },
      credsDb,
    );
  });

  it('returns 200 verified:true when the signature verifies + counter advances', async () => {
    const uid = 'uid-crypto';
    const issued = await issueChallenge(fs, uid);
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6, credentialID: 'cred-CRYPTO' },
    });
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:c@test.com`)
      .send({
        challengeId: issued.challengeId,
        id: 'cred-CRYPTO',
        rawId: 'cred-CRYPTO',
        type: 'public-key',
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'YXV0aA==',
        signature: 'c2ln',
      });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.uid).toBe(uid);
    expect(res.body.newCounter).toBe(6);

    // Counter persisted.
    const credsDb = buildTestCredentialsDb(fs, () => Date.now());
    const after = await findByCredentialId('cred-CRYPTO', credsDb);
    expect(after?.credential.counter).toBe(6);
  });

  it('returns 401 with reason=signature_invalid when verifyAuthenticationResponse → verified:false', async () => {
    const uid = 'uid-crypto';
    const issued = await issueChallenge(fs, uid);
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { newCounter: 0, credentialID: 'cred-CRYPTO' },
    });
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:c@test.com`)
      .send({
        challengeId: issued.challengeId,
        id: 'cred-CRYPTO',
        type: 'public-key',
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'YXV0aA==',
        signature: 'YmFkc2ln',
      });
    expect(res.status).toBe(401);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('signature_invalid');
  });

  it('returns 401 with reason=signature_invalid when verifyAuthenticationResponse throws (origin mismatch / RP-id mismatch / etc)', async () => {
    const uid = 'uid-crypto';
    const issued = await issueChallenge(fs, uid);
    mockVerifyAuthenticationResponse.mockRejectedValueOnce(
      new Error('Unexpected authentication response origin "https://attacker.example"'),
    );
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:c@test.com`)
      .send({
        challengeId: issued.challengeId,
        id: 'cred-CRYPTO',
        type: 'public-key',
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'YXV0aA==',
        signature: 'c2ln',
      });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('signature_invalid');
  });

  it('returns 401 with reason=counter_replay when newCounter <= storedCounter', async () => {
    const uid = 'uid-crypto';
    const issued = await issueChallenge(fs, uid);
    // Stored counter is 5 (seeded). Authenticator returns 5 → replay.
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 5, credentialID: 'cred-CRYPTO' },
    });
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:c@test.com`)
      .send({
        challengeId: issued.challengeId,
        id: 'cred-CRYPTO',
        type: 'public-key',
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'YXV0aA==',
        signature: 'c2ln',
      });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('counter_replay');
  });

  it('returns 401 with reason=unknown_credential when credentialId is not registered', async () => {
    const uid = 'uid-crypto';
    const issued = await issueChallenge(fs, uid);
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:c@test.com`)
      .send({
        challengeId: issued.challengeId,
        id: 'never-registered',
        type: 'public-key',
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'YXV0aA==',
        signature: 'c2ln',
      });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('unknown_credential');
    // verifyAuthenticationResponse must NOT have been called when the
    // credential lookup fails — saves a CBOR-decode + crypto op.
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('returns 401 with reason=unknown_credential when credentialId belongs to a different uid (no enumeration)', async () => {
    // The seeded credential belongs to uid-crypto. Authenticate as a
    // DIFFERENT uid and try to use it.
    const otherUid = 'uid-other';
    const issued = await issueChallenge(fs, otherUid);
    const res = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${otherUid}:o@test.com`)
      .send({
        challengeId: issued.challengeId,
        id: 'cred-CRYPTO',
        type: 'public-key',
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'YXV0aA==',
        signature: 'c2ln',
      });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('unknown_credential');
  });

  it('audit row records uid + credentialId + newCounter — never the assertion bytes', async () => {
    const uid = 'uid-crypto';
    const issued = await issueChallenge(fs, uid);
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 7, credentialID: 'cred-CRYPTO' },
    });
    await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:c@test.com`)
      .send({
        challengeId: issued.challengeId,
        id: 'cred-CRYPTO',
        type: 'public-key',
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'c2VjcmV0LWF1dGgtZGF0YQ==',
        signature: 'c2VjcmV0LXNpZ25hdHVyZQ==',
      });
    const audited = fs.audit.find((e) => e.action === 'auth.webauthn.verified');
    expect(audited).toBeDefined();
    expect(audited!.userId).toBe(uid);
    expect(audited!.details).toEqual({
      uid,
      credentialId: 'cred-CRYPTO',
      newCounter: 7,
    });
    const dump = JSON.stringify(audited);
    expect(dump).not.toContain('c2VjcmV0LWF1dGgtZGF0YQ');
    expect(dump).not.toContain('c2VjcmV0LXNpZ25hdHVyZQ');
    expect(dump).not.toContain('clientDataJSON');
    expect(dump).not.toContain('authenticatorData');
    expect(dump).not.toContain('"signature"');
  });

  it('passes expectedChallenge / expectedOrigin / expectedRPID to verifyAuthenticationResponse', async () => {
    const uid = 'uid-crypto';
    const issued = await issueChallenge(fs, uid);
    const customApp = buildCryptoVerifyApp({
      firestore: fs,
      auth: FAKE_AUTH,
      expectedOrigin: 'https://app.praeventio.net',
      expectedRPID: 'app.praeventio.net',
    });
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 8, credentialID: 'cred-CRYPTO' },
    });
    await request(customApp)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', `Bearer test:${uid}:c@test.com`)
      .send({
        challengeId: issued.challengeId,
        id: 'cred-CRYPTO',
        type: 'public-key',
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'YXV0aA==',
        signature: 'c2ln',
      });
    expect(mockVerifyAuthenticationResponse).toHaveBeenCalledTimes(1);
    const call = mockVerifyAuthenticationResponse.mock.calls[0][0];
    expect(call.expectedOrigin).toBe('https://app.praeventio.net');
    expect(call.expectedRPID).toBe('app.praeventio.net');
    // expectedChallenge is the base64url challenge from clientDataJSON.
    expect(typeof call.expectedChallenge).toBe('string');
    expect(call.expectedChallenge.length).toBeGreaterThan(0);
    // The credential it received must be the registered public key, not
    // attacker-supplied bytes.
    expect(call.credential.id).toBe('cred-CRYPTO');
    expect(call.credential.counter).toBe(5);
    expect(call.credential.publicKey).toBeInstanceOf(Uint8Array);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Round 19 R6 — per-uid rate limiter on /webauthn/verify.
//
// Hardens R18 R6 MEDIUM #1: even though the verify endpoint already
// enforces single-use challenges + monotonic-counter replay prevention,
// a brute-force flood from a compromised Bearer token would still burn
// CPU and Firestore reads. `webauthnVerifyLimiter` caps to 5/min keyed
// on the authenticated uid (verifyAuth runs first → req.user.uid is set
// → keyGenerator can read it). Falls back to req.ip then 'anonymous'.
//
// Each test instantiates a fresh limiter (via a fresh app build) so the
// in-memory store does not leak counts between tests.
// ───────────────────────────────────────────────────────────────────────

import rateLimit from 'express-rate-limit';

interface RateLimitedTestDeps extends VerifyTestDeps {
  /** Override max to make tests faster. Defaults to 5 (production value). */
  max?: number;
  /** Override window. Defaults to 60_000 ms (production value). */
  windowMs?: number;
}

/**
 * Builds a verify app whose /webauthn/verify route is wrapped with the
 * SAME limiter shape used in production (`webauthnVerifyLimiter`). We
 * reconstruct it inside the test so each `it()` gets a fresh in-memory
 * counter store — sharing the production singleton would leak counts
 * across tests.
 */
function buildRateLimitedApp(deps: RateLimitedTestDeps): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const now = deps.now ?? (() => Date.now());
  const challengesDb = buildTestChallengesDb(deps.firestore, now);

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

  // Mirror src/server/middleware/limiters.ts → webauthnVerifyLimiter.
  const limiter = rateLimit({
    windowMs: deps.windowMs ?? 60 * 1000,
    max: deps.max ?? 5,
    keyGenerator: (req: any) => (req as any).user?.uid || req.ip || 'anonymous',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_verify_attempts', retryAfterMs: 60_000 },
  });

  // Mounted AFTER verifyAuth so keyGenerator can read req.user.uid.
  app.post('/api/auth/webauthn/verify', verifyAuth, limiter, async (req: any, res) => {
    const callerUid = req.user.uid;
    const { challengeId, clientDataJSON, authenticatorData, signature } = req.body ?? {};

    if (typeof challengeId !== 'string' || challengeId.length === 0 || challengeId.length > 256) {
      return res.status(400).json({ error: 'challengeId is required' });
    }
    if (typeof clientDataJSON !== 'string' || clientDataJSON.length === 0) {
      return res.status(400).json({ error: 'clientDataJSON is required' });
    }
    if (typeof authenticatorData !== 'string' || authenticatorData.length === 0) {
      return res.status(400).json({ error: 'authenticatorData is required' });
    }
    if (typeof signature !== 'string' || signature.length === 0) {
      return res.status(400).json({ error: 'signature is required' });
    }

    let providedChallenge: Uint8Array;
    try {
      const cdjStr = Buffer.from(clientDataJSON, 'base64').toString('utf8');
      const cdj = JSON.parse(cdjStr);
      const chB64u = String(cdj.challenge ?? '');
      const b64 = chB64u.replace(/-/g, '+').replace(/_/g, '/');
      providedChallenge = new Uint8Array(Buffer.from(b64, 'base64'));
    } catch {
      return res.status(400).json({ error: 'malformed clientDataJSON' });
    }

    const result = await consumeWebAuthnChallenge(
      callerUid,
      challengeId,
      providedChallenge,
      challengesDb,
    );
    if (result.valid === false) {
      return res.status(401).json({ verified: false, reason: result.reason });
    }

    return res.json({ verified: true, uid: callerUid });
  });

  return app;
}

describe('POST /api/auth/webauthn/verify — R19 R6 per-uid rate limiter', () => {
  let fs: InMemoryFirestore;

  beforeEach(() => {
    fs = new InMemoryFirestore();
  });

  /**
   * Helper: build N independent verify request bodies for a given uid.
   * Each body uses a fresh challenge so the request would otherwise
   * succeed with 200 (or a content 401 from a cold store) — the test
   * isolates the rate-limit behavior, not consume semantics.
   */
  async function buildBodies(uid: string, n: number) {
    const bodies = [];
    for (let i = 0; i < n; i++) {
      const issued = await issueChallenge(fs, uid);
      bodies.push({
        challengeId: issued.challengeId,
        clientDataJSON: issued.clientDataJSON,
        authenticatorData: 'aGVsbG8=',
        signature: 'c2ln',
      });
    }
    return bodies;
  }

  it('blocks the 6th verify attempt with 429 after 5 within the window', async () => {
    const app = buildRateLimitedApp({ firestore: fs, auth: FAKE_AUTH });
    const uid = 'uid-rl';
    const auth = `Bearer test:${uid}:rl@test.com`;
    const bodies = await buildBodies(uid, 6);

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/webauthn/verify')
        .set('Authorization', auth)
        .send(bodies[i]);
      // Each is a fresh challenge → 200 (consume succeeds).
      expect(res.status).toBe(200);
    }

    const sixth = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', auth)
      .send(bodies[5]);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe('too_many_verify_attempts');
    expect(sixth.body.retryAfterMs).toBe(60_000);
  });

  it('keeps per-uid quotas independent — uid A exhausting its budget does not throttle uid B', async () => {
    const app = buildRateLimitedApp({ firestore: fs, auth: FAKE_AUTH });
    const uidA = 'uid-A';
    const uidB = 'uid-B';
    const authA = `Bearer test:${uidA}:a@test.com`;
    const authB = `Bearer test:${uidB}:b@test.com`;

    // Burn uid A's full quota (5 successful verifies).
    const bodiesA = await buildBodies(uidA, 5);
    for (const body of bodiesA) {
      const res = await request(app)
        .post('/api/auth/webauthn/verify')
        .set('Authorization', authA)
        .send(body);
      expect(res.status).toBe(200);
    }
    // 6th from uid A → 429.
    const blocked = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', authA)
      .send((await buildBodies(uidA, 1))[0]);
    expect(blocked.status).toBe(429);

    // uid B starts with a fresh budget — first call still succeeds.
    const bodyB = (await buildBodies(uidB, 1))[0];
    const resB = await request(app)
      .post('/api/auth/webauthn/verify')
      .set('Authorization', authB)
      .send(bodyB);
    expect(resB.status).toBe(200);
  });

  it('counts 401 attempts (unknown challenge) against the quota — flooding bad bodies still trips the limiter', async () => {
    // Use a tighter cap (2) to keep the test fast and focused.
    const app = buildRateLimitedApp({ firestore: fs, auth: FAKE_AUTH, max: 2 });
    const uid = 'uid-flood';
    const auth = `Bearer test:${uid}:f@test.com`;
    const garbageBody = {
      challengeId: 'a'.repeat(64),
      clientDataJSON: Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: 'AAAA',
          origin: 'https://app.praeventio.net',
        }),
        'utf8',
      ).toString('base64'),
      authenticatorData: 'aGVsbG8=',
      signature: 'c2ln',
    };

    // First two requests reach the handler → 401 unknown.
    const r1 = await request(app).post('/api/auth/webauthn/verify').set('Authorization', auth).send(garbageBody);
    expect(r1.status).toBe(401);
    const r2 = await request(app).post('/api/auth/webauthn/verify').set('Authorization', auth).send(garbageBody);
    expect(r2.status).toBe(401);
    // Third trips the limiter even though the prior two were "failures".
    const r3 = await request(app).post('/api/auth/webauthn/verify').set('Authorization', auth).send(garbageBody);
    expect(r3.status).toBe(429);
    expect(r3.body.error).toBe('too_many_verify_attempts');
  });

  it('does NOT count requests rejected by verifyAuth (no req.user) against any uid bucket', async () => {
    // verifyAuth rejects → middleware chain stops before the limiter, so
    // unauthenticated floods cannot push a real uid past its quota. We
    // verify by hammering /verify with a missing/invalid Bearer header
    // many times, then confirm the LEGITIMATE caller still has its full
    // budget afterwards.
    const app = buildRateLimitedApp({ firestore: fs, auth: FAKE_AUTH });
    for (let i = 0; i < 20; i++) {
      const r = await request(app).post('/api/auth/webauthn/verify').send({});
      expect(r.status).toBe(401);
    }

    const uid = 'uid-clean';
    const auth = `Bearer test:${uid}:c@test.com`;
    const bodies = await buildBodies(uid, 5);
    for (const body of bodies) {
      const res = await request(app)
        .post('/api/auth/webauthn/verify')
        .set('Authorization', auth)
        .send(body);
      expect(res.status).toBe(200);
    }
  });
});
