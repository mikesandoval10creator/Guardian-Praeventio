// Praeventio Guard — Sprint 14: /api/emergency/sos HTTP tests.
//
// Worker-initiated SOS. The mobile client (SOSButton 3s long-press) calls
// this endpoint with `{type:'sos', uid, projectId, geo, timestamp}`. The
// server must:
//   • verify Bearer auth
//   • assert project membership (cross-tenant SOS is a privacy leak)
//   • write tenants/{tenantId}/emergency_alerts/{id}
//   • emit one audit_logs row
//   • fan out FCM to supervisor/gerente/prevencionista members
//
// We use the same parallel-app pattern as push.test.ts because the real
// router calls `admin.firestore()` which we can't init in tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { InMemoryFirestore, type FakeAuth } from './test-server.js';

interface SosTestDeps {
  firestore: InMemoryFirestore;
  auth: FakeAuth;
  fcmSend: (input: any) => Promise<any>;
  forceFirestoreThrow?: boolean;
}

function buildSosApp(deps: SosTestDeps): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const verifyAuth = async (req: any, res: any, next: any): Promise<void> => {
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

  // Naive rate limiter mirror — track sos count per uid in a Map.
  const rateMap = new Map<string, number[]>();
  const sosLimiter = (req: any, res: any, next: any): void => {
    const uid = req.user?.uid ?? 'anon';
    const now = Date.now();
    const arr = (rateMap.get(uid) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= 10) {
      return res.status(429).json({ error: 'Demasiadas alertas SOS. Espera un momento.' });
    }
    arr.push(now);
    rateMap.set(uid, arr);
    next();
  };

  function isFiniteNumber(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n);
  }
  function validateGeo(g: unknown): { lat: number; lng: number } | null {
    if (g == null || typeof g !== 'object') return null;
    const lat = (g as any).lat;
    const lng = (g as any).lng;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  app.post('/api/emergency/sos', verifyAuth, sosLimiter, async (req, res) => {
    const callerUid = (req as any).user.uid;
    const callerEmail: string | null = (req as any).user.email ?? null;
    const { type, projectId, geo, timestamp } = req.body ?? {};
    if (type !== 'sos') return res.status(400).json({ error: 'invalid_type' });
    if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 128) {
      return res.status(400).json({ error: 'invalid_projectId' });
    }
    if (timestamp !== undefined && timestamp !== null && typeof timestamp !== 'string') {
      return res.status(400).json({ error: 'invalid_timestamp' });
    }
    const validatedGeo = geo == null ? null : validateGeo(geo);
    if (geo != null && validatedGeo === null) {
      return res.status(400).json({ error: 'invalid_geo' });
    }

    // Membership check.
    const projectSnap = await deps.firestore.collection('projects').doc(projectId).get();
    if (!projectSnap.exists) return res.status(403).json({ error: 'forbidden' });
    const pdata = projectSnap.data() ?? {};
    const isMember =
      pdata.createdBy === callerUid ||
      (Array.isArray(pdata.members) && pdata.members.includes(callerUid));
    if (!isMember) return res.status(403).json({ error: 'forbidden' });

    if (deps.forceFirestoreThrow) {
      return res.status(500).json({ error: 'sos_failed' });
    }

    const tenantId: string = pdata.tenantId || projectId;
    const alertRef = await deps.firestore
      .collection(`tenants/${tenantId}/emergency_alerts`)
      .add({
        type: 'sos',
        uid: callerUid,
        userEmail: callerEmail,
        projectId,
        geo: validatedGeo,
        clientTimestamp: timestamp ?? null,
      });
    await deps.firestore.collection('audit_logs').add({
      action: 'emergency.sos',
      module: 'emergency',
      details: { projectId, alertId: alertRef.id, hasGeo: validatedGeo !== null },
      userId: callerUid,
      userEmail: callerEmail,
      projectId,
    });

    // Fan out FCM. Read members of project (separate sub-collection in
    // production; here we read from `projectMembers` keyed by projectId).
    const membersQ = await deps.firestore
      .collection('projectMembers')
      .where('projectId', '==', projectId)
      .get();
    const tokens: string[] = [];
    const SUPER = new Set(['supervisor', 'gerente', 'prevencionista', 'admin']);
    for (const d of membersQ.docs) {
      const mdata = d.data();
      if (SUPER.has(mdata.role) && typeof mdata.fcmToken === 'string' && mdata.fcmToken) {
        tokens.push(mdata.fcmToken);
      }
    }
    let notified = 0;
    if (tokens.length > 0) {
      try {
        await deps.fcmSend({
          tokens,
          notification: { title: '🆘 SOS recibido', body: `Trabajador solicita ayuda en proyecto ${projectId}` },
          data: { projectId, alertId: alertRef.id, type: 'sos', uid: callerUid },
        });
        notified = tokens.length;
      } catch {
        // Swallow — see route comment.
      }
    }

    res.json({ ok: true, alertId: alertRef.id, notified });
  });

  return app;
}

describe('/api/emergency/sos', () => {
  let firestore: InMemoryFirestore;
  let auth: FakeAuth;
  let fcmSend: any;

  beforeEach(() => {
    firestore = new InMemoryFirestore();
    auth = {
      async verifyIdToken(token: string) {
        if (token === 'invalid') throw new Error('bad');
        const [, uid, email] = token.split(':');
        return { uid: uid ?? 'u', email: email || `${uid}@t.com` };
      },
      async getUser(uid) {
        return { uid, email: `${uid}@t.com`, customClaims: {} };
      },
      async getUserByEmail() {
        throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      },
      async setCustomUserClaims() {},
      async revokeRefreshTokens() {},
    };
    fcmSend = vi.fn(async () => ({ successCount: 1 }));
  });

  it('rejects unauthenticated requests with 401', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    const r = await request(app).post('/api/emergency/sos').send({ type: 'sos', projectId: 'p1' });
    expect(r.status).toBe(401);
  });

  it('rejects type !== "sos" with 400', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    const r = await request(app)
      .post('/api/emergency/sos')
      .set('Authorization', 'Bearer test:u1:u1@t.com')
      .send({ type: 'panic', projectId: 'p1' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_type');
  });

  it('rejects missing projectId with 400', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    const r = await request(app)
      .post('/api/emergency/sos')
      .set('Authorization', 'Bearer test:u1:u1@t.com')
      .send({ type: 'sos' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_projectId');
  });

  it('rejects malformed geo with 400', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    firestore.store.set('projects/p1', { createdBy: 'u1', tenantId: 't1', members: ['u1'] });
    const r = await request(app)
      .post('/api/emergency/sos')
      .set('Authorization', 'Bearer test:u1:u1@t.com')
      .send({ type: 'sos', projectId: 'p1', geo: { lat: 999, lng: 0 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_geo');
  });

  it('rejects cross-tenant SOS with 403', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    firestore.store.set('projects/p1', { createdBy: 'other', members: ['other'] });
    const r = await request(app)
      .post('/api/emergency/sos')
      .set('Authorization', 'Bearer test:u1:u1@t.com')
      .send({ type: 'sos', projectId: 'p1' });
    expect(r.status).toBe(403);
  });

  it('happy path: writes emergency_alert + audit row, returns alertId', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    firestore.store.set('projects/p1', { createdBy: 'u1', tenantId: 'tenant-A', members: ['u1'] });
    firestore.store.set('projectMembers/m1', {
      projectId: 'p1',
      role: 'supervisor',
      fcmToken: 'tok-supervisor',
    });
    firestore.store.set('projectMembers/m2', {
      projectId: 'p1',
      role: 'operario',
      fcmToken: 'tok-operario',
    });
    const r = await request(app)
      .post('/api/emergency/sos')
      .set('Authorization', 'Bearer test:u1:u1@t.com')
      .send({
        type: 'sos',
        projectId: 'p1',
        geo: { lat: -33.45, lng: -70.67 },
        timestamp: '2026-05-02T12:00:00Z',
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.alertId).toBe('string');
    expect(r.body.notified).toBe(1); // only supervisor

    // Alert row written under tenants/{tenantId}/emergency_alerts.
    const alertKeys = [...firestore.store.keys()].filter((k) =>
      k.startsWith('tenants/tenant-A/emergency_alerts/'),
    );
    expect(alertKeys.length).toBe(1);
    const alert = firestore.store.get(alertKeys[0]);
    expect(alert.type).toBe('sos');
    expect(alert.uid).toBe('u1');
    expect(alert.projectId).toBe('p1');
    expect(alert.geo).toEqual({ lat: -33.45, lng: -70.67 });

    // Audit row recorded.
    const audit = firestore.audit.find((a) => a.action === 'emergency.sos');
    expect(audit).toBeTruthy();
    expect(audit?.userId).toBe('u1');
    expect(audit?.details.hasGeo).toBe(true);

    // FCM was called only with supervisor token.
    expect(fcmSend).toHaveBeenCalledTimes(1);
    expect(fcmSend.mock.calls[0][0].tokens).toEqual(['tok-supervisor']);
  });

  it('still 200 when no supervisor tokens are registered', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    firestore.store.set('projects/p1', { createdBy: 'u1', tenantId: 't1', members: ['u1'] });
    const r = await request(app)
      .post('/api/emergency/sos')
      .set('Authorization', 'Bearer test:u1:u1@t.com')
      .send({ type: 'sos', projectId: 'p1' });
    expect(r.status).toBe(200);
    expect(r.body.notified).toBe(0);
    expect(fcmSend).not.toHaveBeenCalled();
  });

  it('falls back to projectId when project has no tenantId', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    firestore.store.set('projects/p2', { createdBy: 'u1', members: ['u1'] });
    const r = await request(app)
      .post('/api/emergency/sos')
      .set('Authorization', 'Bearer test:u1:u1@t.com')
      .send({ type: 'sos', projectId: 'p2' });
    expect(r.status).toBe(200);
    const alertKeys = [...firestore.store.keys()].filter((k) =>
      k.startsWith('tenants/p2/emergency_alerts/'),
    );
    expect(alertKeys.length).toBe(1);
  });

  it('rate-limits to 10 SOS per minute per uid', async () => {
    const app = buildSosApp({ firestore, auth, fcmSend });
    firestore.store.set('projects/p1', { createdBy: 'u1', tenantId: 't1', members: ['u1'] });
    for (let i = 0; i < 10; i++) {
      const r = await request(app)
        .post('/api/emergency/sos')
        .set('Authorization', 'Bearer test:u1:u1@t.com')
        .send({ type: 'sos', projectId: 'p1' });
      expect(r.status).toBe(200);
    }
    const blocked = await request(app)
      .post('/api/emergency/sos')
      .set('Authorization', 'Bearer test:u1:u1@t.com')
      .send({ type: 'sos', projectId: 'p1' });
    expect(blocked.status).toBe(429);
  });
});
