// Real-router supertest for src/server/routes/commute.ts.
// Mounts the ACTUAL production router (not a handler mirror) via the
// fakeFirestore + adminMock pattern (Plan v3 Fase 1 — server lever).
//
// Endpoints covered:
//   POST /api/commute/start   — validation / membership / tenantId / 200 + audit
//   POST /api/commute/sample  — validation / session lookup / ownership / 200
//   POST /api/commute/end     — validation / session lookup / ownership / 200 + audit
//
// The route calls admin.firestore().collectionGroup('commute_sessions') for
// /sample and /end. FakeFirestore has no collectionGroup, so we bolt it on
// here using the same inline pattern established in externalAuditPortal.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── hoisted holder so db can be re-assigned in beforeEach ─────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin mock with collectionGroup support ──────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock, createFakeFirestore: _cff } = await import('../helpers/fakeFirestore');
  const base = adminMock(() => H.db!);
  const originalFirestoreFn = base.default.firestore;

  function withCollectionGroup(db: ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore>) {
    type AnyDb = typeof db & { collectionGroup?: (name: string) => ReturnType<typeof db.collection> };
    const proxy = db as AnyDb;
    if (proxy.collectionGroup) return proxy;

    proxy.collectionGroup = function (name: string) {
      const allFilters: Array<{ field: string; op: string; value: unknown }> = [];

      function runCgQuery(
        filters: Array<{ field: string; op: string; value: unknown }>,
        lim: number | null,
      ) {
        const store = (db as typeof db & { _store: Map<string, Record<string, unknown>> })._store;
        const matched: Array<{ id: string; path: string; data: Record<string, unknown> }> = [];
        for (const [path, data] of store.entries()) {
          const segs = path.split('/');
          for (let i = 0; i < segs.length - 1; i += 2) {
            if (segs[i] === name) {
              matched.push({ id: segs[i + 1], path, data });
              break;
            }
          }
        }
        const filtered = matched.filter((doc) =>
          filters.every((f) => {
            const v = f.field
              .split('.')
              .reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), doc.data);
            if (f.op === '==') return v === f.value;
            if (f.op === '!=') return v !== f.value;
            return false;
          }),
        );
        const sliced = lim != null ? filtered.slice(0, lim) : filtered;
        const docs = sliced.map(({ id, path, data }) => ({
          id,
          ref: db.doc(path),
          exists: true,
          data: () => ({ ...data }),
          get: (field: string) =>
            field.split('.').reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), data),
        }));
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb: (d: (typeof docs)[0]) => void) => docs.forEach(cb),
        };
      }

      function buildCgQuery(
        filters: Array<{ field: string; op: string; value: unknown }>,
        lim: number | null,
      ): ReturnType<typeof db.collection> {
        return {
          where: (field: string, op: string, value: unknown) =>
            buildCgQuery([...filters, { field, op, value }], lim),
          orderBy: (_f: string, _d?: string) => buildCgQuery(filters, lim),
          limit: (n: number) => buildCgQuery(filters, n),
          get: async () => runCgQuery(filters, lim),
          count: () => ({
            get: async () => ({ data: () => ({ count: runCgQuery(filters, null).size }) }),
          }),
          doc: () => {
            throw new Error('collectionGroup does not support .doc()');
          },
          add: () => {
            throw new Error('collectionGroup does not support .add()');
          },
          path: `__collectionGroup__/${name}`,
        } as unknown as ReturnType<typeof db.collection>;
      }

      return buildCgQuery(allFilters, null);
    };
    return proxy;
  }

  const patchedFirestoreFn = Object.assign(
    () => withCollectionGroup(H.db!),
    originalFirestoreFn,
  );

  const patched = {
    ...base,
    default: { ...base.default, firestore: patchedFirestoreFn },
    firestore: patchedFirestoreFn,
  };
  return patched;
});

// ── middleware mocks ──────────────────────────────────────────────────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: { uid: string; email?: string } }).user = {
      uid,
      email: req.header('x-test-email') ?? `${uid}@test.com`,
    };
    next();
  },
}));

// commuteLimiter is exported and mounted inside the router — pass-through.
vi.mock('express-rate-limit', () => {
  const rl = (_opts: unknown) => (_req: Request, _res: Response, next: NextFunction) => next();
  rl.ipKeyGenerator = () => 'test-ip';
  return { default: rl, ipKeyGenerator: () => 'test-ip' };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// ── imports ───────────────────────────────────────────────────────────────────
import commuteRouter from '../../server/routes/commute.js';
import { createFakeFirestore } from '../helpers/fakeFirestore.js';

// ── app factory ───────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/commute', commuteRouter);
  return app;
}

// ── seed helper ───────────────────────────────────────────────────────────────
// Seeds a project doc + a pre-existing commute session under the tenant path.
// Returns the seeded sessionId so tests can reference it directly.
function seedSession(
  sessionId: string,
  opts: {
    projectId?: string;
    tenantId?: string;
    startedBy?: string;
    endedAt?: string | null;
    samples?: unknown[];
  } = {},
) {
  const {
    projectId = 'proj-A',
    tenantId = 'tenant-1',
    startedBy = 'uid-A',
    endedAt = null,
    samples = [],
  } = opts;
  H.db!._seed(`tenants/${tenantId}/commute_sessions/${sessionId}`, {
    id: sessionId,
    projectId,
    type: 'home-to-site',
    startedBy,
    startedAt: new Date().toISOString(),
    endedAt,
    samples,
  });
  return sessionId;
}

// ── global beforeEach ─────────────────────────────────────────────────────────
beforeEach(() => {
  H.db = createFakeFirestore();
  // Project A — tenant-1, member uid-A (also creator).
  H.db._seed('projects/proj-A', {
    name: 'Faena Norte',
    tenantId: 'tenant-1',
    members: ['uid-A'],
    createdBy: 'uid-A',
  });
  // Project B — tenant-2, member uid-B. Used to verify cross-project isolation.
  H.db._seed('projects/proj-B', {
    name: 'Faena Sur',
    tenantId: 'tenant-2',
    members: ['uid-B'],
    createdBy: 'uid-B',
  });
  // Project C — no tenantId field (edge case for start).
  H.db._seed('projects/proj-no-tenant', {
    name: 'Sin Tenant',
    members: ['uid-A'],
    createdBy: 'uid-A',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/commute/start
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/commute/start', () => {
  it('401 — no token', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .send({ type: 'home-to-site', projectId: 'proj-A' });
    expect(res.status).toBe(401);
  });

  it('400 — missing projectId', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .send({ type: 'home-to-site' });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/projectId/i);
  });

  it('400 — empty string projectId', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .send({ type: 'home-to-site', projectId: '' });
    expect(res.status).toBe(400);
  });

  it('400 — projectId too long (>128 chars)', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .send({ type: 'home-to-site', projectId: 'x'.repeat(129) });
    expect(res.status).toBe(400);
  });

  it('400 — missing type', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .send({ projectId: 'proj-A' });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/type/i);
  });

  it('400 — invalid type value', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .send({ type: 'detour', projectId: 'proj-A' });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/type/i);
  });

  it('403 — non-member caller (uid-Z not in proj-A)', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-Z')
      .send({ type: 'home-to-site', projectId: 'proj-A' });
    expect(res.status).toBe(403);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('forbidden');
  });

  it('403 — project does not exist at all', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .send({ type: 'home-to-site', projectId: 'proj-ghost' });
    expect(res.status).toBe(403);
  });

  it('400 — project missing tenantId', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .send({ type: 'home-to-site', projectId: 'proj-no-tenant' });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/tenantId/i);
  });

  it('200 — happy path: returns sessionId + persists doc + writes audit_log', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .set('x-test-email', 'a@empresa.cl')
      .send({ type: 'home-to-site', projectId: 'proj-A' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(typeof body.sessionId).toBe('string');

    const sid = body.sessionId as string;
    // Session doc persisted under the tenant path.
    const sessionDoc = await H.db!
      .collection('tenants/tenant-1/commute_sessions')
      .doc(sid)
      .get();
    expect(sessionDoc.exists).toBe(true);
    const data = sessionDoc.data() as Record<string, unknown>;
    expect(data.startedBy).toBe('uid-A');
    expect(data.type).toBe('home-to-site');
    expect(data.projectId).toBe('proj-A');
    expect(data.endedAt).toBeNull();
    expect(Array.isArray(data.samples)).toBe(true);

    // Audit log stamped server-side.
    const auditSnap = await H.db!.collection('audit_logs').get();
    expect(auditSnap.empty).toBe(false);
    const audit = auditSnap.docs[0].data() as Record<string, unknown>;
    expect(audit.action).toBe('commute.start');
    expect(audit.userId).toBe('uid-A');
    // Identity MUST come from token, not body.
    expect(audit.userEmail).toBe('a@empresa.cl');
    expect(audit.module).toBe('driving');
  });

  it('200 — all three valid types accepted', async () => {
    for (const type of ['home-to-site', 'site-to-home', 'between-sites']) {
      const res = await request(buildApp())
        .post('/api/commute/start')
        .set('x-test-uid', 'uid-A')
        .send({ type, projectId: 'proj-A' });
      expect(res.status).toBe(200);
    }
  });

  it('200 — sessionId matches cs_<ts>_<uuid> shape', async () => {
    const res = await request(buildApp())
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .send({ type: 'home-to-site', projectId: 'proj-A' });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.sessionId as string).toMatch(
      /^cs_\d+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/commute/sample
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/commute/sample', () => {
  const VALID_SAMPLE = {
    sessionId: 'cs_1000_aaaaaaaa-0000-0000-0000-000000000001',
    lat: -33.4,
    lng: -70.6,
    speedKmh: 60,
    accuracyM: 10,
    timestamp: 1_717_000_000_000,
  };

  beforeEach(() => {
    seedSession(VALID_SAMPLE.sessionId, { startedBy: 'uid-A' });
  });

  it('401 — no token', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .send(VALID_SAMPLE);
    expect(res.status).toBe(401);
  });

  it('400 — missing sessionId', async () => {
    const { sessionId: _omit, ...rest } = VALID_SAMPLE;
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send(rest);
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/sessionId/i);
  });

  it('400 — sessionId fails regex (spaces)', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, sessionId: 'bad id with spaces' });
    expect(res.status).toBe(400);
  });

  it('400 — lat out of range (> 90)', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, lat: 91 });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/lat/i);
  });

  it('400 — lat out of range (< -90)', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, lat: -91 });
    expect(res.status).toBe(400);
  });

  it('400 — lng out of range (> 180)', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, lng: 181 });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/lng/i);
  });

  it('400 — speedKmh negative', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, speedKmh: -1 });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/speedKmh/i);
  });

  it('400 — speedKmh exceeds 500', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, speedKmh: 501 });
    expect(res.status).toBe(400);
  });

  it('400 — accuracyM negative', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, accuracyM: -1 });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/accuracyM/i);
  });

  it('400 — accuracyM exceeds 100 000', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, accuracyM: 100_001 });
    expect(res.status).toBe(400);
  });

  it('400 — timestamp zero or negative', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, timestamp: 0 });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/timestamp/i);
  });

  it('400 — non-finite lat (NaN encoded as null)', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, lat: null });
    expect(res.status).toBe(400);
  });

  it('404 — session does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, sessionId: 'cs_0_aaaaaaaa-0000-0000-0000-000000000099' });
    expect(res.status).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/not found/i);
  });

  it('403 — caller is not the session owner', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-Z') // not uid-A
      .send(VALID_SAMPLE);
    expect(res.status).toBe(403);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('forbidden');
  });

  it('409 — session already ended', async () => {
    // Override the seeded session with endedAt set.
    H.db!._seed(`tenants/tenant-1/commute_sessions/${VALID_SAMPLE.sessionId}`, {
      id: VALID_SAMPLE.sessionId,
      projectId: 'proj-A',
      type: 'home-to-site',
      startedBy: 'uid-A',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(), // already closed
      samples: [],
    });
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send(VALID_SAMPLE);
    expect(res.status).toBe(409);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/ended/i);
  });

  it('200 — appends sample; success:true returned', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send(VALID_SAMPLE);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);

    // Verify the sample was appended in Firestore.
    const snap = await H.db!
      .collection('tenants/tenant-1/commute_sessions')
      .doc(VALID_SAMPLE.sessionId)
      .get();
    const data = snap.data() as Record<string, unknown>;
    const samples = data.samples as unknown[];
    expect(samples).toHaveLength(1);
    const s = samples[0] as Record<string, unknown>;
    expect(s.lat).toBe(-33.4);
    expect(s.lng).toBe(-70.6);
    expect(s.speedKmh).toBe(60);
  });

  it('200 — boundary lat/lng/speed values accepted', async () => {
    const res = await request(buildApp())
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({ ...VALID_SAMPLE, lat: 90, lng: 180, speedKmh: 0 });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/commute/end
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/commute/end', () => {
  const SESSION_ID = 'cs_2000_bbbbbbbb-0000-0000-0000-000000000002';

  beforeEach(() => {
    seedSession(SESSION_ID, { startedBy: 'uid-A', projectId: 'proj-A' });
  });

  it('401 — no token', async () => {
    const res = await request(buildApp())
      .post('/api/commute/end')
      .send({ sessionId: SESSION_ID });
    expect(res.status).toBe(401);
  });

  it('400 — missing sessionId', async () => {
    const res = await request(buildApp())
      .post('/api/commute/end')
      .set('x-test-uid', 'uid-A')
      .send({});
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/sessionId/i);
  });

  it('400 — sessionId fails regex (>128 chars)', async () => {
    const res = await request(buildApp())
      .post('/api/commute/end')
      .set('x-test-uid', 'uid-A')
      .send({ sessionId: 'a'.repeat(129) });
    expect(res.status).toBe(400);
  });

  it('404 — session does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/commute/end')
      .set('x-test-uid', 'uid-A')
      .send({ sessionId: 'cs_0_aaaaaaaa-0000-0000-0000-000000000099' });
    expect(res.status).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toMatch(/not found/i);
  });

  it('403 — non-owner cannot end session', async () => {
    const res = await request(buildApp())
      .post('/api/commute/end')
      .set('x-test-uid', 'uid-Z')
      .send({ sessionId: SESSION_ID });
    expect(res.status).toBe(403);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('forbidden');
  });

  it('200 — sets endedAt + writes audit_log', async () => {
    const res = await request(buildApp())
      .post('/api/commute/end')
      .set('x-test-uid', 'uid-A')
      .set('x-test-email', 'a@empresa.cl')
      .send({ sessionId: SESSION_ID });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);

    // endedAt is now set on the session doc.
    const snap = await H.db!
      .collection('tenants/tenant-1/commute_sessions')
      .doc(SESSION_ID)
      .get();
    const data = snap.data() as Record<string, unknown>;
    expect(data.endedAt).toBeTruthy();

    // Audit log stamped server-side with token identity.
    const auditSnap = await H.db!.collection('audit_logs').get();
    expect(auditSnap.empty).toBe(false);
    const audit = auditSnap.docs[0].data() as Record<string, unknown>;
    expect(audit.action).toBe('commute.end');
    expect(audit.userId).toBe('uid-A');
    expect(audit.userEmail).toBe('a@empresa.cl');
    expect(audit.module).toBe('driving');
    const details = audit.details as Record<string, unknown>;
    expect(details.sessionId).toBe(SESSION_ID);
  });

  it('200 — projectId is carried into the audit log from the session doc', async () => {
    const res = await request(buildApp())
      .post('/api/commute/end')
      .set('x-test-uid', 'uid-A')
      .send({ sessionId: SESSION_ID });
    expect(res.status).toBe(200);

    const auditSnap = await H.db!.collection('audit_logs').get();
    const audit = auditSnap.docs[0].data() as Record<string, unknown>;
    expect(audit.projectId).toBe('proj-A');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-endpoint flow — start → sample → end
// ─────────────────────────────────────────────────────────────────────────────
describe('full commute flow (start → sample → end)', () => {
  it('200 across all three steps; session is closed after /end', async () => {
    const app = buildApp();

    // 1. Start
    const startRes = await request(app)
      .post('/api/commute/start')
      .set('x-test-uid', 'uid-A')
      .set('x-test-email', 'a@empresa.cl')
      .send({ type: 'site-to-home', projectId: 'proj-A' });
    expect(startRes.status).toBe(200);
    const sid = (startRes.body as Record<string, unknown>).sessionId as string;
    expect(typeof sid).toBe('string');

    // 2. Sample
    const sampleRes = await request(app)
      .post('/api/commute/sample')
      .set('x-test-uid', 'uid-A')
      .send({
        sessionId: sid,
        lat: -33.45,
        lng: -70.67,
        speedKmh: 80,
        accuracyM: 5,
        timestamp: Date.now(),
      });
    expect(sampleRes.status).toBe(200);

    // 3. End
    const endRes = await request(app)
      .post('/api/commute/end')
      .set('x-test-uid', 'uid-A')
      .send({ sessionId: sid });
    expect(endRes.status).toBe(200);

    // Session doc has 1 sample + endedAt.
    const snap = await H.db!
      .collection('tenants/tenant-1/commute_sessions')
      .doc(sid)
      .get();
    const data = snap.data() as Record<string, unknown>;
    expect((data.samples as unknown[]).length).toBe(1);
    expect(data.endedAt).toBeTruthy();

    // Two audit_log entries: commute.start and commute.end.
    const auditSnap = await H.db!.collection('audit_logs').get();
    const actions = auditSnap.docs.map((d) => (d.data() as Record<string, unknown>).action);
    expect(actions).toContain('commute.start');
    expect(actions).toContain('commute.end');
  });
});
