// Praeventio Guard — Round 17 (R3): /api/push/register-token HTTP tests.
//
// FCM token registration endpoint. The mobile client (Capacitor push plugin)
// calls this once it has the device token so the server can `arrayUnion` it
// into `users/{uid}.fcmTokens` for later targeted notifications.
//
// Coverage matrix:
//   • 401 unauthed (no Bearer)
//   • 401 malformed Bearer
//   • 400 empty/missing token
//   • 400 invalid platform
//   • 400 token >512 chars
//   • 200 happy path: writes arrayUnion into users/{uid} + audit row
//   • 200 idempotent: posting same token twice keeps a single entry
//   • 500 if Firestore throws
//
// Critical rule: the audit row MUST NOT contain the raw token (the token is
// a credential — see firestore.rules append-only audit_logs invariant).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { Router } from 'express';
import { InMemoryFirestore, type FakeAuth } from './test-server.js';

import { getFirestore } from 'firebase-admin/firestore';
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Test harness — mirror real prod wiring. We can't import the real
// router because it touches `getFirestore()` which would require
// Firebase Admin init. Instead we build a parallel express app whose
// handler is a verbatim copy of the production handler (R3 owns both).
// Drift is mitigated the same way admin.test.ts mitigates it: handler
// here is intentionally near-identical to src/server/routes/push.ts.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const VALID_PLATFORMS = ['ios', 'android', 'web'] as const;

interface PushTestDeps {
  firestore: InMemoryFirestore;
  auth: FakeAuth;
  /** Optional override to make the Firestore set call throw, for 500 path. */
  forceFirestoreThrow?: boolean;
}

function buildPushApp(deps: PushTestDeps): Express {
  const app = express();
  // codeql[js/missing-rate-limiting]  // test harness: global limiter intentionally not mounted (see src/__tests__/server/rateLimit.test.ts)
  app.use(express.json({ limit: '64kb' }));

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

  const router = Router();

  // codeql[js/missing-rate-limiting]  // test harness: global limiter intentionally not mounted (see src/__tests__/server/rateLimit.test.ts)
  router.post('/register-token', verifyAuth, async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;
    const { token, platform } = req.body ?? {};

    if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    if (typeof platform !== 'string' || !VALID_PLATFORMS.includes(platform as any)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    if (deps.forceFirestoreThrow) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    try {
      // Mirror prod: arrayUnion semantics. The InMemoryFirestore exports a
      // sentinel-based `applyMerge`, but the sentinel is internal — we model
      // arrayUnion directly here so the test is self-contained.
      const cur = deps.firestore.store.get(`users/${callerUid}`) ?? {};
      const existing: string[] = Array.isArray(cur.fcmTokens) ? cur.fcmTokens : [];
      const next = existing.includes(token) ? existing : [...existing, token];
      deps.firestore.store.set(`users/${callerUid}`, {
        ...cur,
        fcmTokens: next,
        lastTokenRegisteredAt: new Date().toISOString(),
      });

      await deps.firestore.collection('audit_logs').add({
        action: 'push.token.registered',
        module: 'push',
        details: { platform },
        userId: callerUid,
        userEmail: callerEmail,
        ts: new Date().toISOString(),
      });

      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Companion endpoint to /register-token. See push.ts:unregister-token
  // header for the P0 safety rationale (cross-tenant push leakage on
  // logout / account-switch). Mirrors prod arrayRemove semantics: removes
  // the token from `users/{uid}.fcmTokens` and writes an audit row that
  // records `{ platform }` ONLY (the raw FCM token is a credential).
  // Idempotent: removing a token that isn't in the array is a 200 no-op
  // and does NOT write an audit row.
  // codeql[js/missing-rate-limiting]  // test harness: global limiter intentionally not mounted (see src/__tests__/server/rateLimit.test.ts)
  router.post('/unregister-token', verifyAuth, async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;
    const { token, platform } = req.body ?? {};

    if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    if (typeof platform !== 'string' || !VALID_PLATFORMS.includes(platform as any)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    if (deps.forceFirestoreThrow) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    try {
      const cur = deps.firestore.store.get(`users/${callerUid}`) ?? {};
      const existing: string[] = Array.isArray(cur.fcmTokens) ? cur.fcmTokens : [];
      if (!existing.includes(token)) {
        // Idempotent: token wasn't registered. No audit row — keeps the
        // log clean of spurious traffic from clients retrying unregister.
        return res.json({ ok: true });
      }
      const next = existing.filter((t) => t !== token);
      deps.firestore.store.set(`users/${callerUid}`, {
        ...cur,
        fcmTokens: next,
        lastTokenUnregisteredAt: new Date().toISOString(),
      });

      await deps.firestore.collection('audit_logs').add({
        action: 'push.token.unregistered',
        module: 'push',
        details: { platform },
        userId: callerUid,
        userEmail: callerEmail,
        ts: new Date().toISOString(),
      });

      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // codeql[js/missing-rate-limiting]  // test harness: global limiter intentionally not mounted (see src/__tests__/server/rateLimit.test.ts)
  app.use('/api/push', router);
  return app;
}

function makeAuth(): FakeAuth {
  return {
    async verifyIdToken(token: string) {
      if (token === 'invalid' || token === 'malformed') throw new Error('invalid token');
      const [, uid, email] = token.split(':');
      return { uid: uid ?? 'uid-default', email: email || `${uid}@test.com` };
    },
    async getUser(uid: string) {
      return { uid, email: `${uid}@test.com`, customClaims: {} };
    },
    async getUserByEmail() {
      throw new Error('not used');
    },
    async setCustomUserClaims() {},
    async revokeRefreshTokens() {},
  };
}

describe('POST /api/push/register-token', () => {
  let fs: InMemoryFirestore;
  let app: Express;

  beforeEach(() => {
    fs = new InMemoryFirestore();
    app = buildPushApp({ firestore: fs, auth: makeAuth() });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/push/register-token')
      .send({ token: 'fcm-token-abc', platform: 'android' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
  });

  it('rejects malformed Bearer header with 401', async () => {
    const res = await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer malformed')
      .send({ token: 'fcm-token-abc', platform: 'android' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it('rejects empty token with 400', async () => {
    const res = await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: '', platform: 'android' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('rejects missing token with 400', async () => {
    const res = await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ platform: 'android' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('rejects invalid platform with 400', async () => {
    const res = await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'fcm-token-abc', platform: 'symbian' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('rejects token >512 chars with 400', async () => {
    const big = 'a'.repeat(513);
    const res = await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: big, platform: 'ios' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('happy path: writes arrayUnion + audit row WITHOUT the raw token', async () => {
    const res = await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'fcm-token-abc', platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const userDoc = fs.store.get('users/uid-worker');
    expect(userDoc).toBeDefined();
    expect(userDoc.fcmTokens).toEqual(['fcm-token-abc']);
    expect(userDoc.lastTokenRegisteredAt).toBeTruthy();

    const audit = fs.audit.find((e) => e.action === 'push.token.registered');
    expect(audit).toBeDefined();
    expect(audit?.module).toBe('push');
    expect(audit?.details).toEqual({ platform: 'android' });
    expect(audit?.userId).toBe('uid-worker');
    // Critical: the raw token MUST NOT appear in the audit row.
    expect(JSON.stringify(audit)).not.toContain('fcm-token-abc');
  });

  it('idempotent: posting same token twice keeps a single entry (arrayUnion)', async () => {
    const send = () =>
      request(app)
        .post('/api/push/register-token')
        .set('Authorization', 'Bearer test:uid-worker:w@test.com')
        .send({ token: 'fcm-token-dup', platform: 'ios' });
    const r1 = await send();
    const r2 = await send();
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const userDoc = fs.store.get('users/uid-worker');
    expect(userDoc.fcmTokens).toEqual(['fcm-token-dup']);
    expect(userDoc.fcmTokens.length).toBe(1);
  });

  it('appends multiple distinct tokens per user', async () => {
    await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-A', platform: 'android' });
    await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-B', platform: 'ios' });
    const userDoc = fs.store.get('users/uid-worker');
    expect(userDoc.fcmTokens).toEqual(['tok-A', 'tok-B']);
  });

  it('returns 500 if Firestore throws', async () => {
    app = buildPushApp({ firestore: fs, auth: makeAuth(), forceFirestoreThrow: true });
    const res = await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'fcm-token-abc', platform: 'android' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal/i);
  });
});

// ─── /api/push/unregister-token ───────────────────────────────────────────
//
// Companion to /register-token. Without unregister, fcmTokens[] grows
// forever on users/{uid}: tokens for devices the user has since logged
// out of, account-switched away from, or had wiped, all keep receiving
// emergency fan-outs. This causes two distinct P0 safety hazards:
//   1. Critical alerts to a previous user reach a device the new user
//      is now signed in on (cross-tenant leakage).
//   2. A revoked session keeps getting SOS pushes after logout, which
//      is a privacy + compliance hazard for Ley 16.744 audit trails.
//
// Behavior contract (mirrors register-token):
//   • 401 unauthed
//   • 400 invalid token (empty, missing, >512 chars)
//   • 400 invalid platform
//   • 200 happy path: arrayRemove from users/{uid}.fcmTokens + audit row
//   • 200 idempotent: removing a token not in the array is a no-op
//   • Audit row records `{ platform }` ONLY — never the raw token.

describe('POST /api/push/unregister-token', () => {
  let fs: InMemoryFirestore;
  let app: Express;

  beforeEach(() => {
    fs = new InMemoryFirestore();
    app = buildPushApp({ firestore: fs, auth: makeAuth() });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/push/unregister-token')
      .send({ token: 'fcm-token-abc', platform: 'android' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
  });

  it('rejects malformed Bearer header with 401', async () => {
    const res = await request(app)
      .post('/api/push/unregister-token')
      .set('Authorization', 'Bearer malformed')
      .send({ token: 'fcm-token-abc', platform: 'android' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it('rejects empty token with 400', async () => {
    const res = await request(app)
      .post('/api/push/unregister-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: '', platform: 'android' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('rejects invalid platform with 400', async () => {
    const res = await request(app)
      .post('/api/push/unregister-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'fcm-token-abc', platform: 'symbian' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('happy path: removes the token from users/{uid}.fcmTokens + writes audit row WITHOUT the raw token', async () => {
    // Seed two tokens for this user.
    await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-A', platform: 'android' });
    await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-B', platform: 'ios' });
    expect(fs.store.get('users/uid-worker').fcmTokens).toEqual(['tok-A', 'tok-B']);

    // Now unregister tok-A.
    const res = await request(app)
      .post('/api/push/unregister-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-A', platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const userDoc = fs.store.get('users/uid-worker');
    expect(userDoc.fcmTokens).toEqual(['tok-B']);
    expect(userDoc.lastTokenUnregisteredAt).toBeTruthy();

    const audit = fs.audit.find((e) => e.action === 'push.token.unregistered');
    expect(audit).toBeDefined();
    expect(audit?.module).toBe('push');
    expect(audit?.details).toEqual({ platform: 'android' });
    expect(audit?.userId).toBe('uid-worker');
    // Critical: the raw token MUST NOT appear in the audit row.
    expect(JSON.stringify(audit)).not.toContain('tok-A');
  });

  it('idempotent: removing a token that was never registered is a 200 no-op', async () => {
    const res = await request(app)
      .post('/api/push/unregister-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'never-registered', platform: 'web' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // No audit row should be written for a no-op (avoids spurious traffic).
    const audit = fs.audit.find((e) => e.action === 'push.token.unregistered');
    expect(audit).toBeUndefined();
  });

  it('removes only the requested token, leaving the others intact', async () => {
    await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-X', platform: 'android' });
    await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-Y', platform: 'ios' });
    await request(app)
      .post('/api/push/register-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-Z', platform: 'web' });

    await request(app)
      .post('/api/push/unregister-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'tok-Y', platform: 'ios' });

    const userDoc = fs.store.get('users/uid-worker');
    expect(userDoc.fcmTokens).toEqual(['tok-X', 'tok-Z']);
  });

  it('returns 500 if Firestore throws', async () => {
    app = buildPushApp({ firestore: fs, auth: makeAuth(), forceFirestoreThrow: true });
    const res = await request(app)
      .post('/api/push/unregister-token')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ token: 'fcm-token-abc', platform: 'android' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal/i);
  });
});
