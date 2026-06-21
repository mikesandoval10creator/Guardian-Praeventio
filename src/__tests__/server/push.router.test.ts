// Real-router supertest for src/server/routes/push.ts — POST /api/push/register-token.
//
// FCM device-token registration. The Capacitor push plugin acquires a device
// token at runtime and calls this endpoint so the server can `arrayUnion` it
// onto `users/{uid}.fcmTokens` for targeted notifications (Modo Crisis, safety
// alerts, compliance reminders). This is a life-safety delivery path.
//
// This is the BEHAVIORAL (real-router) test: it mounts the REAL exported
// router and exercises it through supertest with a Firestore-backed fake, so
// the REAL handler — input validation, arrayUnion/serverTimestamp writes, the
// audit row, and the 500 path — is the code under test. (The pre-existing
// src/__tests__/server/push.test.ts is a parallel-copy harness that re-declares
// a verbatim handler; it does NOT import the real router and therefore leaves
// push.ts "uncovered" in the router-test ratchet.)
//
// Critical security invariant (header comment of push.ts): the audit row
// records `{ platform }` ONLY. The raw FCM token is a push credential and MUST
// NOT land in append-only audit_logs — leaking it there would let anyone with
// read-audit privileges push to that device until the token rotates. Pinned
// below with a real assertion over the persisted audit row.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// Real verifyAuth is infra (touches Firebase Auth at boot) — mock to the
// minimal 401-or-attach-user contract. The handler reads BOTH uid and email
// off req.user, so the mock surfaces both from test headers.
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'Unauthorized: No token provided' });
    const email = req.header('x-test-email');
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: email ?? null,
    };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import pushRouter from '../../server/routes/push.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { captureRouteError } from '../../server/middleware/captureRouteError.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/push', pushRouter);
  return app;
}

const WORKER = 'uid-worker';
const asUser = (uid: string, email?: string) => ({
  'x-test-uid': uid,
  ...(email ? { 'x-test-email': email } : {}),
});
const ENDPOINT = '/api/push/register-token';

function userDoc(uid: string) {
  return H.db!._dump()[`users/${uid}`] as Record<string, unknown> | undefined;
}
function auditRows() {
  return Object.entries(H.db!._dump())
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v as Record<string, unknown>)
    .filter((r) => r.action === 'push.token.registered');
}

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.clearAllMocks();
});

describe('POST /api/push/register-token (real router)', () => {
  it('401 without an auth token', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send({ token: 'fcm-abc', platform: 'android' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
    expect(userDoc(WORKER)).toBeUndefined();
    expect(auditRows().length).toBe(0);
  });

  it('400 for a missing token', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER))
      .send({ platform: 'android' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
    expect(auditRows().length).toBe(0);
  });

  it('400 for an empty-string token', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER))
      .send({ token: '', platform: 'android' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('400 for a non-string token', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER))
      .send({ token: 12345, platform: 'android' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it('400 for a token longer than 512 chars', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER))
      .send({ token: 'a'.repeat(513), platform: 'ios' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
    expect(userDoc(WORKER)).toBeUndefined();
  });

  it('accepts a token at exactly the 512-char boundary', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER))
      .send({ token: 'a'.repeat(512), platform: 'ios' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((userDoc(WORKER)!.fcmTokens as string[])).toEqual(['a'.repeat(512)]);
  });

  it('400 for an invalid platform', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER))
      .send({ token: 'fcm-abc', platform: 'symbian' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platform/i);
    expect(userDoc(WORKER)).toBeUndefined();
  });

  it('400 for a missing platform', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER))
      .send({ token: 'fcm-abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platform/i);
  });

  it.each(['ios', 'android', 'web'])('200 happy path accepts platform=%s', async (platform) => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER, 'w@test.com'))
      .send({ token: `fcm-${platform}`, platform });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('200 happy path: real arrayUnion write to users/{uid} + serverTimestamp', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER, 'w@test.com'))
      .send({ token: 'fcm-token-abc', platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The REAL handler used admin.firestore.FieldValue.arrayUnion + merge:true,
    // resolved by the fake's FieldValue engine.
    const doc = userDoc(WORKER);
    expect(doc).toBeDefined();
    expect(doc!.fcmTokens).toEqual(['fcm-token-abc']);
    expect(doc!.lastTokenRegisteredAt).toBeTruthy(); // serverTimestamp resolved
  });

  it('200 happy path: audit row records platform + token actor, NEVER the raw token', async () => {
    await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER, 'w@test.com'))
      .send({ token: 'fcm-secret-credential', platform: 'android' });

    const rows = auditRows();
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.module).toBe('push');
    expect(row.details).toEqual({ platform: 'android' });
    expect(row.userId).toBe(WORKER); // server-stamped from the token (CLAUDE.md #3)
    expect(row.userEmail).toBe('w@test.com');
    expect(row.timestamp).toBeTruthy();
    // CRITICAL: the raw FCM token is a push credential and MUST NOT appear in
    // the append-only audit row.
    expect(JSON.stringify(row)).not.toContain('fcm-secret-credential');
  });

  it('stamps the actor uid from the token even if the body carries a different uid', async () => {
    // An attacker tries to register a token attributed to someone else.
    await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER, 'w@test.com'))
      .send({ token: 'fcm-x', platform: 'web', uid: 'someone-else', userId: 'someone-else' });
    // Token landed on the caller's own doc, not the spoofed one.
    expect(userDoc(WORKER)).toBeDefined();
    expect(userDoc('someone-else')).toBeUndefined();
    expect(auditRows()[0].userId).toBe(WORKER);
  });

  it('idempotent: registering the same token twice keeps a single arrayUnion entry', async () => {
    const send = () =>
      request(buildApp())
        .post(ENDPOINT)
        .set(asUser(WORKER, 'w@test.com'))
        .send({ token: 'fcm-dup', platform: 'ios' });
    const r1 = await send();
    const r2 = await send();
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(userDoc(WORKER)!.fcmTokens).toEqual(['fcm-dup']);
    expect((userDoc(WORKER)!.fcmTokens as string[]).length).toBe(1);
    // Each successful registration still writes its own audit row.
    expect(auditRows().length).toBe(2);
  });

  it('appends multiple distinct tokens for the same user', async () => {
    await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER, 'w@test.com'))
      .send({ token: 'tok-A', platform: 'android' });
    await request(buildApp())
      .post(ENDPOINT)
      .set(asUser(WORKER, 'w@test.com'))
      .send({ token: 'tok-B', platform: 'ios' });
    expect(userDoc(WORKER)!.fcmTokens).toEqual(['tok-A', 'tok-B']);
  });

  it('500 when Firestore throws, body does not leak internals (production)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // Force the users/{uid}.set() write to reject.
      const db = H.db!;
      const realCollection = db.collection.bind(db);
      vi.spyOn(db, 'collection').mockImplementation((path: string) => {
        const ref = realCollection(path);
        if (path === 'users') {
          return {
            ...ref,
            doc: () =>
              ({
                set: async () => {
                  throw new Error('boom: internal firestore detail');
                },
              }) as never,
          } as never;
        }
        return ref;
      });

      const res = await request(buildApp())
        .post(ENDPOINT)
        .set(asUser(WORKER, 'w@test.com'))
        .send({ token: 'fcm-abc', platform: 'android' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      // CLAUDE.md #8: 5xx bodies never leak internals in production.
      expect(JSON.stringify(res.body)).not.toContain('boom');
      expect(res.body.details).toBeUndefined();
      // No audit row on the failed write.
      expect(auditRows().length).toBe(0);
      // The error was forwarded to the error tracker.
      expect(captureRouteError).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('500 leaks the message only in non-production (dev ergonomics)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const db = H.db!;
      const realCollection = db.collection.bind(db);
      vi.spyOn(db, 'collection').mockImplementation((path: string) => {
        const ref = realCollection(path);
        if (path === 'users') {
          return {
            ...ref,
            doc: () =>
              ({
                set: async () => {
                  throw new Error('dev-visible detail');
                },
              }) as never,
          } as never;
        }
        return ref;
      });

      const res = await request(buildApp())
        .post(ENDPOINT)
        .set(asUser(WORKER, 'w@test.com'))
        .send({ token: 'fcm-abc', platform: 'android' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(res.body.details).toBe('dev-visible detail');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
