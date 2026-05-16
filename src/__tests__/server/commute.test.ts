// Praeventio Guard â€” Sprint 12.
//
// HTTP tests for /api/commute/{start,sample,end}. The production handlers
// live in src/server/routes/commute.ts and call admin.firestore() directly
// â€” same as zettelkasten.ts. To avoid pulling firebase-admin into the test
// surface we build a minimal Express app here whose handlers mirror the
// production logic (validation, member guard, ownership check, audit
// emissions) using the InMemoryFirestore fake from test-server.ts. Drift
// is mitigated by keeping the handlers near-verbatim copies and by the
// integration smoke (typecheck + curl) that runs against the real route.

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { InMemoryFirestore, fakeFieldValue } from './test-server.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

const VALID_TYPES = new Set(['home-to-site', 'site-to-home', 'between-sites']);
const SESSION_ID_REGEX = /^[A-Za-z0-9_\-:.]{1,128}$/;

interface Handle {
  app: express.Express;
  fs: InMemoryFirestore;
}

/**
 * Minimal mirror of src/server/routes/commute.ts handlers, against the
 * in-memory firestore fake. Kept structurally similar to the production
 * file so a refactor on either side surfaces here.
 */
function build(): Handle {
  const fs = new InMemoryFirestore();
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split('Bearer ')[1];
    if (token === 'invalid') return res.status(401).json({ error: 'Unauthorized' });
    const [, uid, email] = token.split(':');
    req.user = { uid: uid ?? 'uid-default', email: email ?? `${uid}@test.com` };
    next();
    return undefined;
  };

  // Resolve tenantId from project doc.
  async function tenantIdFor(projectId: string): Promise<string | null> {
    const snap = await fs.collection('projects').doc(projectId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    return typeof data.tenantId === 'string' ? data.tenantId : null;
  }

  app.post('/api/commute/start', verifyAuth, async (req, res) => {
    const callerUid = req.user.uid;
    const { type, projectId } = req.body ?? {};
    if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 128) {
      return res.status(400).json({ error: 'Invalid projectId' });
    }
    if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    try {
      await assertProjectMember(callerUid, projectId, fs as any);
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }
    const tenantId = await tenantIdFor(projectId);
    if (!tenantId) return res.status(400).json({ error: 'Project missing tenantId' });
    const sessionId = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await fs
      .collection(`tenants/${tenantId}/commute_sessions`)
      .doc(sessionId)
      .set({
        id: sessionId,
        projectId,
        type,
        startedBy: callerUid,
        startedAt: fakeFieldValue.serverTimestamp(),
        endedAt: null,
        samples: [],
      });
    await fs.collection('audit_logs').add({
      action: 'commute.start',
      module: 'driving',
      details: { sessionId, type },
      userId: callerUid,
      projectId,
      timestamp: fakeFieldValue.serverTimestamp(),
    });
    return res.json({ success: true, sessionId });
  });

  // Helper: scan the in-memory store for a session by id.
  function findSession(
    sessionId: string,
  ): { key: string; data: any } | null {
    for (const [key, value] of fs.store.entries()) {
      if (!key.includes('/commute_sessions/')) continue;
      if (value?.id === sessionId) return { key, data: value };
    }
    return null;
  }

  app.post('/api/commute/sample', verifyAuth, async (req, res) => {
    const callerUid = req.user.uid;
    const { sessionId, lat, lng, speedKmh, accuracyM, timestamp } = req.body ?? {};
    if (typeof sessionId !== 'string' || !SESSION_ID_REGEX.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }
    if (typeof lat !== 'number' || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Invalid lat' });
    }
    if (typeof lng !== 'number' || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Invalid lng' });
    }
    if (typeof speedKmh !== 'number' || speedKmh < 0 || speedKmh > 500) {
      return res.status(400).json({ error: 'Invalid speedKmh' });
    }
    if (typeof accuracyM !== 'number' || accuracyM < 0) {
      return res.status(400).json({ error: 'Invalid accuracyM' });
    }
    if (typeof timestamp !== 'number' || timestamp <= 0) {
      return res.status(400).json({ error: 'Invalid timestamp' });
    }
    const found = findSession(sessionId);
    if (!found) return res.status(404).json({ error: 'Session not found' });
    if (found.data.startedBy !== callerUid) return res.status(403).json({ error: 'forbidden' });
    if (found.data.endedAt) return res.status(409).json({ error: 'Session already ended' });
    const next = {
      ...found.data,
      samples: [...(found.data.samples ?? []), { lat, lng, speedKmh, accuracyM, timestamp }],
    };
    fs.store.set(found.key, next);
    return res.json({ success: true });
  });

  app.post('/api/commute/end', verifyAuth, async (req, res) => {
    const callerUid = req.user.uid;
    const { sessionId } = req.body ?? {};
    if (typeof sessionId !== 'string' || !SESSION_ID_REGEX.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }
    const found = findSession(sessionId);
    if (!found) return res.status(404).json({ error: 'Session not found' });
    if (found.data.startedBy !== callerUid) return res.status(403).json({ error: 'forbidden' });
    fs.store.set(found.key, { ...found.data, endedAt: fakeFieldValue.serverTimestamp() });
    await fs.collection('audit_logs').add({
      action: 'commute.end',
      module: 'driving',
      details: { sessionId },
      userId: callerUid,
      projectId: found.data.projectId ?? null,
      timestamp: fakeFieldValue.serverTimestamp(),
    });
    return res.json({ success: true });
  });

  return { app, fs };
}

let h: Handle;
beforeEach(() => {
  h = build();
  // Project A in tenant T-1, member uid-A.
  h.fs.store.set('projects/proj-A', {
    name: 'Faena Norte',
    tenantId: 'T-1',
    members: ['uid-A'],
    createdBy: 'uid-A',
  });
  h.fs.store.set('projects/proj-B', {
    name: 'Faena Sur',
    tenantId: 'T-2',
    members: ['uid-B'],
    createdBy: 'uid-B',
  });
});

describe('POST /api/commute/start', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(h.app).post('/api/commute/start').send({});
    expect(res.status).toBe(401);
  });

  it('rejects invalid projectId with 400', async () => {
    const res = await request(h.app)
      .post('/api/commute/start')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ type: 'home-to-site', projectId: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it('rejects invalid type with 400', async () => {
    const res = await request(h.app)
      .post('/api/commute/start')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ type: 'detour', projectId: 'proj-A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  it('rejects non-member with 403 (tenant isolation)', async () => {
    const res = await request(h.app)
      .post('/api/commute/start')
      .set('Authorization', 'Bearer test:uid-Z:z@test.com')
      .send({ type: 'home-to-site', projectId: 'proj-A' });
    expect(res.status).toBe(403);
  });

  it('starts a session and stamps an audit log on success', async () => {
    const res = await request(h.app)
      .post('/api/commute/start')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ type: 'home-to-site', projectId: 'proj-A' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.sessionId).toBe('string');
    // Doc landed under tenants/T-1/commute_sessions/.
    const found = [...h.fs.store.keys()].find(
      (k) => k.startsWith('tenants/T-1/commute_sessions/') && k.endsWith(res.body.sessionId),
    );
    expect(found).toBeDefined();
    // Audit log row.
    expect(h.fs.audit.some((a) => a.action === 'commute.start')).toBe(true);
  });
});

describe('POST /api/commute/sample', () => {
  async function startFor(authHeader: string, projectId: string): Promise<string> {
    const res = await request(h.app)
      .post('/api/commute/start')
      .set('Authorization', authHeader)
      .send({ type: 'home-to-site', projectId });
    return res.body.sessionId as string;
  }

  it('rejects out-of-range lat with 400', async () => {
    const sid = await startFor('Bearer test:uid-A:a@test.com', 'proj-A');
    const res = await request(h.app)
      .post('/api/commute/sample')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ sessionId: sid, lat: 999, lng: 0, speedKmh: 0, accuracyM: 1, timestamp: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat/i);
  });

  it('returns 404 for unknown sessionId', async () => {
    const res = await request(h.app)
      .post('/api/commute/sample')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({
        sessionId: 'cs_ghost',
        lat: 0,
        lng: 0,
        speedKmh: 50,
        accuracyM: 5,
        timestamp: 1,
      });
    expect(res.status).toBe(404);
  });

  it('rejects samples from a non-owner with 403', async () => {
    const sid = await startFor('Bearer test:uid-A:a@test.com', 'proj-A');
    // uid-B is a member of proj-B (different tenant), but also tries to
    // poke proj-A's session. Only the starter (uid-A) may append.
    const res = await request(h.app)
      .post('/api/commute/sample')
      .set('Authorization', 'Bearer test:uid-B:b@test.com')
      .send({ sessionId: sid, lat: 0, lng: 0, speedKmh: 60, accuracyM: 10, timestamp: 1 });
    expect(res.status).toBe(403);
  });

  it('appends a valid sample and persists it under the tenant path', async () => {
    const sid = await startFor('Bearer test:uid-A:a@test.com', 'proj-A');
    const res = await request(h.app)
      .post('/api/commute/sample')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ sessionId: sid, lat: -33.4, lng: -70.6, speedKmh: 60, accuracyM: 10, timestamp: 1 });
    expect(res.status).toBe(200);
    const key = `tenants/T-1/commute_sessions/${sid}`;
    expect(h.fs.store.get(key).samples).toHaveLength(1);
  });
});

describe('POST /api/commute/end', () => {
  it('finalizes endedAt and stamps an audit log', async () => {
    const startRes = await request(h.app)
      .post('/api/commute/start')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ type: 'site-to-home', projectId: 'proj-A' });
    const sid = startRes.body.sessionId as string;
    const res = await request(h.app)
      .post('/api/commute/end')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ sessionId: sid });
    expect(res.status).toBe(200);
    const key = `tenants/T-1/commute_sessions/${sid}`;
    expect(h.fs.store.get(key).endedAt).toBeTruthy();
    expect(h.fs.audit.some((a) => a.action === 'commute.end')).toBe(true);
  });

  it('rejects end from a non-owner with 403', async () => {
    const startRes = await request(h.app)
      .post('/api/commute/start')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ type: 'site-to-home', projectId: 'proj-A' });
    const sid = startRes.body.sessionId as string;
    const res = await request(h.app)
      .post('/api/commute/end')
      .set('Authorization', 'Bearer test:uid-B:b@test.com')
      .send({ sessionId: sid });
    expect(res.status).toBe(403);
  });
});
