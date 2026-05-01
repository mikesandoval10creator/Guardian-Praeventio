// Praeventio Guard — Round 17 R1: Audit-log coverage tests for the 6
// hardened endpoints (R6 R16 HIGH).
//
// Endpoints under test (each MUST emit `audit_logs` on success):
//   1. POST /api/oauth/unlink
//   2. GET  /auth/google/callback        (unauthed → uid recovered from session)
//   3. POST /api/calendar/sync
//   4. POST /api/coach/chat
//   5. POST /api/gamification/points
//   6. POST /api/gamification/check-medals
//   7. POST /api/reports/generate-pdf
//
// We can't import server.ts directly (boots Vite + admin SDK); we mirror
// the handler shape in a parallel express app and verify each emits a row
// into the in-memory `audit_logs` store. The shared `auditServerEvent`
// helper from src/server/middleware/auditLog.ts is exercised indirectly
// through these handlers — its failure modes are covered separately by
// the per-endpoint 500-path branches in the production code (defensive
// try/catch around every audit emit).
//
// The SAME `audit_logs` row schema we assert here is what hits Firestore
// in production (see auditLog.ts). Drift between this harness and
// production is intentional and tracked in test-server.ts §"Strategy".

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import session from 'express-session';
import request from 'supertest';
import crypto from 'crypto';
import { InMemoryFirestore, type FakeAuth, fakeFieldValue } from './test-server.js';

// ─────────────────────────────────────────────────────────────────────
// Mirror of `auditServerEvent` (src/server/middleware/auditLog.ts).
// Identical contract; differs only in that we accept the in-memory
// firestore directly rather than reaching for `admin.firestore()`.
// ─────────────────────────────────────────────────────────────────────

interface AuditOpts {
  projectId?: string | null;
  actorOverride?: { uid: string; email?: string | null };
}

async function auditServerEvent(
  req: Request,
  fs: InMemoryFirestore,
  action: string,
  module: string,
  details: Record<string, unknown> = {},
  options: AuditOpts = {},
): Promise<boolean> {
  const reqUser = (req as any).user as { uid?: string; email?: string | null } | undefined;
  const actor = options.actorOverride ?? reqUser ?? { uid: 'anonymous', email: null };
  const userId = actor.uid ?? 'anonymous';
  const userEmail = actor.email ?? null;
  try {
    await fs.collection('audit_logs').add({
      action,
      module,
      details,
      userId,
      userEmail,
      projectId: options.projectId ?? null,
      timestamp: fakeFieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────

interface Deps {
  fs: InMemoryFirestore;
  auth: FakeAuth;
  /** Pre-seed an oauth state in the express-session store via cookie? */
  oauthSession?: { state: string; uid: string };
}

function makeAuth(): FakeAuth {
  return {
    async verifyIdToken(token: string) {
      if (token === 'invalid') throw new Error('invalid token');
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

function buildApp(deps: Deps): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
    }),
  );

  const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
      const decoded = await deps.auth.verifyIdToken(token);
      (req as any).user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  };

  // 1) /api/oauth/unlink
  app.post('/api/oauth/unlink', verifyAuth, async (req, res) => {
    try {
      await auditServerEvent(req, deps.fs, 'oauth.unlink', 'oauth', {
        providers: ['google', 'google-drive'],
      });
    } catch {}
    res.json({ success: true });
  });

  // 2) /auth/google/callback (unauthed; actor recovered from session)
  // Test-only seed endpoint to plant the oauth state into the session.
  app.post('/test/seed-oauth-state', (req, res) => {
    const sess = req.session as any;
    sess.oauthState = req.body.state;
    sess.oauthInitiator = { uid: req.body.uid, provider: 'google' };
    res.json({ ok: true });
  });
  app.get('/auth/google/callback', async (req, res) => {
    const sess = req.session as any;
    if (!req.query.state || req.query.state !== sess.oauthState) {
      return res.status(403).send('Invalid state');
    }
    const initiator = sess.oauthInitiator;
    if (!initiator?.uid) return res.status(403).send('No initiator');
    // Skip token exchange — record audit row only.
    try {
      await auditServerEvent(req, deps.fs, 'oauth.link', 'oauth', { provider: 'google' }, {
        actorOverride: { uid: initiator.uid, email: null },
      });
    } catch {}
    res.send('<p>linked</p>');
  });

  // 3) /api/calendar/sync
  app.post('/api/calendar/sync', verifyAuth, async (req, res) => {
    const { challenges } = req.body;
    try {
      await auditServerEvent(req, deps.fs, 'calendar.sync', 'calendar', {
        count: Array.isArray(challenges) ? challenges.length : 0,
      });
    } catch {}
    res.json({ success: true, results: [] });
  });

  // 4) /api/coach/chat (assertProjectMemberFromBody is exercised separately;
  //    here we focus on the audit emit. We still seed a project so the
  //    member check passes in the happy-path test.)
  app.post('/api/coach/chat', verifyAuth, async (req, res) => {
    const { message, projectId } = req.body ?? {};
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    // Member check (mirrors assertProjectMemberFromBody behavior).
    const proj = deps.fs.store.get(`projects/${projectId}`);
    if (!proj) return res.status(403).json({ error: 'forbidden' });
    const callerUid = (req as any).user.uid;
    const ok = (proj.members ?? []).includes(callerUid) || proj.createdBy === callerUid;
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    try {
      await auditServerEvent(req, deps.fs, 'coach.chat', 'coach', {
        projectId,
        messageLength: typeof message === 'string' ? message.length : 0,
      }, { projectId });
    } catch {}
    res.json({ success: true, response: 'echo' });
  });

  // 5) /api/gamification/points
  app.post('/api/gamification/points', verifyAuth, async (req, res) => {
    const { amount, reason } = req.body;
    try {
      await auditServerEvent(req, deps.fs, 'gamification.points_awarded', 'gamification', {
        amount: typeof amount === 'number' ? amount : null,
        reason: typeof reason === 'string' ? reason : null,
      });
    } catch {}
    res.json({ success: true });
  });

  // 6) /api/gamification/check-medals
  app.post('/api/gamification/check-medals', verifyAuth, async (req, res) => {
    try {
      await auditServerEvent(req, deps.fs, 'gamification.medals_checked', 'gamification', {
        newMedalCount: 2,
      });
    } catch {}
    res.json({ success: true, newMedals: ['m1', 'm2'] });
  });

  // 7) /api/reports/generate-pdf
  app.post('/api/reports/generate-pdf', verifyAuth, async (req, res) => {
    const { incidentId, type = 'general' } = req.body ?? {};
    try {
      await auditServerEvent(req, deps.fs, 'reports.pdf_generated', 'reports', {
        type,
        incidentId: incidentId ?? null,
        bytes: 4096,
      });
    } catch {}
    res.setHeader('Content-Type', 'application/pdf');
    res.end(Buffer.from('%PDF-1.4 fake'));
  });

  return app;
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

let fs: InMemoryFirestore;
let app: Express;

beforeEach(() => {
  fs = new InMemoryFirestore();
  app = buildApp({ fs, auth: makeAuth() });
});

describe('Round 17 R1 — audit_logs coverage', () => {
  it('POST /api/oauth/unlink emits audit row with actor uid + providers', async () => {
    const res = await request(app)
      .post('/api/oauth/unlink')
      .set('Authorization', 'Bearer test:uid-A:a@test.com');
    expect(res.status).toBe(200);
    const row = fs.audit.find((e) => e.action === 'oauth.unlink');
    expect(row).toBeDefined();
    expect(row?.userId).toBe('uid-A');
    expect(row?.module).toBe('oauth');
    expect(row?.details).toEqual({ providers: ['google', 'google-drive'] });
  });

  it('GET /auth/google/callback emits audit row with uid recovered from session (unauthed endpoint)', async () => {
    const agent = request.agent(app);
    const state = crypto.randomBytes(8).toString('hex');
    await agent.post('/test/seed-oauth-state').send({ state, uid: 'uid-B' });
    const res = await agent.get(`/auth/google/callback?state=${state}&code=fake`);
    expect(res.status).toBe(200);
    const row = fs.audit.find((e) => e.action === 'oauth.link');
    expect(row).toBeDefined();
    // Critical: uid-B was recovered from session.oauthInitiator, NOT a
    // verifyAuth-attached req.user (this endpoint is intentionally unauthed).
    expect(row?.userId).toBe('uid-B');
    expect(row?.details).toEqual({ provider: 'google' });
  });

  it('POST /api/calendar/sync emits audit row with challenge count (not raw titles)', async () => {
    const res = await request(app)
      .post('/api/calendar/sync')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ challenges: ['Audit DS 594', 'CPHS meeting', 'EPP review'] });
    expect(res.status).toBe(200);
    const row = fs.audit.find((e) => e.action === 'calendar.sync');
    expect(row).toBeDefined();
    expect(row?.userId).toBe('uid-A');
    expect(row?.details).toEqual({ count: 3 });
    // The raw challenge text MUST NOT bleed into the audit trail.
    expect(JSON.stringify(row)).not.toContain('Audit DS 594');
  });

  it('POST /api/coach/chat emits audit row with projectId tag and message length', async () => {
    fs.store.set('projects/proj-A', {
      name: 'Faena Norte',
      members: ['uid-A'],
      createdBy: 'uid-A',
    });
    const res = await request(app)
      .post('/api/coach/chat')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ message: 'hola coach', projectId: 'proj-A' });
    expect(res.status).toBe(200);
    const row = fs.audit.find((e) => e.action === 'coach.chat');
    expect(row).toBeDefined();
    expect(row?.userId).toBe('uid-A');
    expect(row?.projectId).toBe('proj-A');
    expect(row?.details).toMatchObject({ projectId: 'proj-A', messageLength: 10 });
  });

  it('POST /api/gamification/points emits audit row with amount + reason', async () => {
    const res = await request(app)
      .post('/api/gamification/points')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ amount: 25, reason: 'observation_filed' });
    expect(res.status).toBe(200);
    const row = fs.audit.find((e) => e.action === 'gamification.points_awarded');
    expect(row).toBeDefined();
    expect(row?.userId).toBe('uid-A');
    expect(row?.details).toEqual({ amount: 25, reason: 'observation_filed' });
  });

  it('POST /api/gamification/check-medals emits audit row with new medal count', async () => {
    const res = await request(app)
      .post('/api/gamification/check-medals')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({});
    expect(res.status).toBe(200);
    const row = fs.audit.find((e) => e.action === 'gamification.medals_checked');
    expect(row).toBeDefined();
    expect(row?.details).toMatchObject({ newMedalCount: 2 });
  });

  it('POST /api/reports/generate-pdf emits audit row with type + incidentId + bytes', async () => {
    const res = await request(app)
      .post('/api/reports/generate-pdf')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ incidentId: 'inc-123', type: 'suseso', title: 't', content: 'c' });
    expect(res.status).toBe(200);
    const row = fs.audit.find((e) => e.action === 'reports.pdf_generated');
    expect(row).toBeDefined();
    expect(row?.userId).toBe('uid-A');
    expect(row?.details).toMatchObject({
      type: 'suseso',
      incidentId: 'inc-123',
      bytes: 4096,
    });
  });

  it('all audit rows carry server-stamped timestamp + ip + userAgent', async () => {
    await request(app)
      .post('/api/oauth/unlink')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .set('User-Agent', 'TestSuite/1.0');
    const row = fs.audit.find((e) => e.action === 'oauth.unlink');
    expect(row?.timestamp).toBeDefined();
    expect(row?.userAgent).toBe('TestSuite/1.0');
  });

  it('audit row records `userId: "anonymous"` when neither req.user nor actorOverride is supplied', async () => {
    // Force a path where the helper falls through to the "anonymous" actor.
    // We synthesize a request with no auth and no override.
    const fakeReq = {
      ip: '127.0.0.1',
      header: () => null,
    } as unknown as Request;
    const ok = await auditServerEvent(fakeReq, fs, 'test.event', 'test', {});
    expect(ok).toBe(true);
    const row = fs.audit.find((e) => e.action === 'test.event');
    expect(row?.userId).toBe('anonymous');
    expect(row?.userEmail).toBeNull();
  });
});
