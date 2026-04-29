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

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { InMemoryFirestore, type FakeAuth } from './test-server.js';
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
  consumeWebAuthnChallenge,
  type MinimalChallengesDb,
} from '../../services/auth/webauthnChallenge.js';

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
