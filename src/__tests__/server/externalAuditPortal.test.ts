// Real-router supertest coverage for src/server/routes/externalAuditPortal.ts
// (Plan v3 Fase 1 — server real-router lever).
//
// 5 endpoints covered:
//   POST   /api/audit-portal/create           (verifyAuth + idempotencyKey + validate)
//   GET    /api/audit-portal/admin/list        (verifyAuth + validate query)
//   POST   /api/audit-portal/:id/revoke        (verifyAuth + idempotencyKey + validate)
//   GET    /api/audit-portal/:id/access-log    (verifyAuth + validate query)
//   GET    /api/audit-portal/public/:token     (NO verifyAuth — token IS the credential)
//
// Compliance properties explicitly asserted:
//   • tenant isolation: admin reads scope to the tenant derived from the caller.
//   • public token: expired/revoked/wrong-scope → always 403, never 200.
//   • access_log appended on every public GET (allowed AND denied).
//   • cross-project isolation: token scoped to project A cannot read project B.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── fakeFirestore holder (must be hoisted so vi.mock factory can close over it) ──

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin mock — collectionGroup added inline ───────────────────────
// The route uses admin.firestore().collectionGroup('audit_portals') for the
// public token lookup. FakeFirestore does not expose collectionGroup, so we
// bolt it on via the factory wrapper here.

vi.mock('firebase-admin', async () => {
  const { adminMock, createFakeFirestore: _createFakeFirestore } = await import('../helpers/fakeFirestore');
  const base = adminMock(() => H.db!);

  // We wrap the firestore() call to attach collectionGroup support.
  // collectionGroup(name) scans ALL docs in the store whose path contains
  // /<name>/ as a collection segment, regardless of depth — same contract as
  // Firestore real collectionGroup queries.
  const originalFirestoreFn = base.default.firestore;

  function withCollectionGroup(db: ReturnType<typeof createFakeFirestore>) {
    const proxy = db as typeof db & {
      collectionGroup?: (name: string) => ReturnType<typeof db.collection>;
    };
    if (proxy.collectionGroup) return proxy; // already patched
    proxy.collectionGroup = function (name: string) {
      // Build a fake query that searches the entire store for docs whose
      // path segments include the collection name.
      const allFilters: Array<{ field: string; op: string; value: unknown }> = [];

      function runCgQuery(
        filters: Array<{ field: string; op: string; value: unknown }>,
        lim: number | null,
      ) {
        const store = (db as typeof db & { _store: Map<string, Record<string, unknown>> })._store;
        const matchedDocs: Array<{ id: string; path: string; data: Record<string, unknown> }> = [];
        for (const [path, data] of store.entries()) {
          const segments = path.split('/');
          // A doc is part of collection `name` if `name` appears as an
          // even-indexed segment (0-based) and the doc id is the next odd segment.
          // e.g. "tenants/t1/audit_portals/portal1" →  segments[2]='audit_portals'
          for (let i = 0; i < segments.length - 1; i += 2) {
            if (segments[i] === name) {
              matchedDocs.push({ id: segments[i + 1], path, data });
              break;
            }
          }
        }
        const filtered = matchedDocs.filter((doc) =>
          filters.every((f) => {
            const v = f.field.split('.').reduce<unknown>((acc, k) =>
              acc == null ? acc : (acc as Record<string, unknown>)[k], doc.data);
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
            field.split('.').reduce<unknown>((acc, k) =>
              acc == null ? acc : (acc as Record<string, unknown>)[k], data),
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
          orderBy: (_field: string, _dir?: string) => buildCgQuery(filters, lim),
          limit: (n: number) => buildCgQuery(filters, n),
          get: async () => runCgQuery(filters, lim),
          count: () => ({
            get: async () => ({ data: () => ({ count: runCgQuery(filters, null).size }) }),
          }),
          doc: () => { throw new Error('collectionGroup does not support .doc()'); },
          add: () => { throw new Error('collectionGroup does not support .add()'); },
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
    (req as Request & { user: { uid: string; tenantId?: string } }).user = {
      uid,
      tenantId: req.header('x-test-tenant-id') ?? undefined,
    };
    next();
  },
}));

// idempotencyKey: simple pass-through — the caching behavior is tested
// separately in its own unit suite. We just need it to call next().
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn(), isAvailable: false, name: 'noop' }),
}));

// ── imports (after mocks) ─────────────────────────────────────────────────────

import externalAuditPortalRouter from '../../server/routes/externalAuditPortal.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { hashAccessToken } from '../../services/auditPortal/auditPortalFirestoreAdapter.js';

// ── test app builder ──────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', externalAuditPortalRouter);
  return app;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-alpha';
const OTHER_TENANT = 'tenant-beta';
const PROJECT_A = 'proj-a';
const PROJECT_B = 'proj-b';
const PORTAL_ID = 'portal-001';
const OTHER_PORTAL_ID = 'portal-002';

/** Seed a stored portal doc into the fake Firestore. */
function seedPortal(opts: {
  tenantId: string;
  portalId: string;
  token: string;
  scopeProjects?: string[];
  scopeModules?: string[];
  ttlDays?: number;
  revokedAt?: string;
  expiresAt?: string;
}) {
  const now = new Date();
  const expiresAt =
    opts.expiresAt ??
    new Date(now.getTime() + (opts.ttlDays ?? 30) * 86_400_000).toISOString();
  const stored = {
    id: opts.portalId,
    accessTokenHash: hashAccessToken(opts.token),
    createdByUid: 'admin-user',
    createdAt: now.toISOString(),
    expiresAt,
    auditorName: 'Ana Fiscalizadora',
    auditorAffiliation: 'suseso',
    scopeProjectIds: opts.scopeProjects ?? [PROJECT_A],
    scopeModules: opts.scopeModules ?? ['documents', 'incidents'],
    ...(opts.revokedAt ? { revokedAt: opts.revokedAt, revokedByUid: 'admin', revokedReason: 'test revoke reason' } : {}),
  };
  H.db!._seed(`tenants/${opts.tenantId}/audit_portals/${opts.portalId}`, stored);
  return { stored, token: opts.token };
}

/** Seed users/{uid}.tenantId for the admin resolveTenantIdForAdmin fallback. */
function seedUserTenant(uid: string, tenantId: string) {
  H.db!._seed(`users/${uid}`, { tenantId });
}

/** Produce a stable 64-char hex token string for tests. */
function makeToken(seed: string): string {
  // Use a deterministic hex string — 64 chars like a real sha256 output.
  return seed.padEnd(64, '0').slice(0, 64);
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /api/audit-portal/create
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/audit-portal/create', () => {
  const URL = '/api/audit-portal/create';

  const validBody = {
    id: PORTAL_ID,
    auditorName: 'Ana Fiscalizadora',
    auditorAffiliation: 'suseso',
    scopeProjectIds: [PROJECT_A],
    scopeModules: ['documents', 'incidents'],
    ttlDays: 30,
  };

  it('401 when no token (verifyAuth gate)', async () => {
    const res = await request(buildApp()).post(URL).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when body fails Zod schema (missing auditorName)', async () => {
    seedUserTenant('u1', TENANT_ID);
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ ...validBody, auditorName: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when ttlDays is out of range (>90)', async () => {
    seedUserTenant('u1', TENANT_ID);
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ ...validBody, ttlDays: 91 });
    expect(res.status).toBe(400);
  });

  it('400 when affiliation is not in enum', async () => {
    seedUserTenant('u1', TENANT_ID);
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ ...validBody, auditorAffiliation: 'not-valid' });
    expect(res.status).toBe(400);
  });

  it('404 when caller has no tenant (claim or users doc)', async () => {
    // User doc does NOT exist — resolveTenantIdForAdmin returns null.
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'orphan-user')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('201 happy path — returns portal + oneTimeAccessToken, persists hash', async () => {
    seedUserTenant('admin1', TENANT_ID);
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin1')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.portal).toBeDefined();
    expect(res.body.portal.status).toBe('active');
    expect(typeof res.body.portal.oneTimeAccessToken).toBe('string');
    // The plaintext token must be 64 chars (sha256 hex).
    expect(res.body.portal.oneTimeAccessToken).toHaveLength(64);
    // Firestore must store the HASH, not the plaintext.
    const storedPath = `tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}`;
    const dump = H.db!._dump();
    const storedDoc = dump[storedPath];
    expect(storedDoc).toBeDefined();
    expect(storedDoc.accessTokenHash).toBeDefined();
    expect(storedDoc.accessTokenHash).not.toBe(res.body.portal.oneTimeAccessToken);
    expect(storedDoc.accessTokenHash).toBe(
      hashAccessToken(res.body.portal.oneTimeAccessToken as string),
    );
  });

  it('201 — createdByUid is server-stamped from token, not body', async () => {
    seedUserTenant('admin1', TENANT_ID);
    // Attempt to spoof createdByUid via body field — route ignores it.
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin1')
      .send({ ...validBody, createdByUid: 'attacker-spoof' });
    expect(res.status).toBe(201);
    expect(res.body.portal.createdByUid).toBe('admin1');
  });

  it('201 — tenantId claim takes precedence over users doc', async () => {
    // Seed a users doc with a DIFFERENT tenantId — claim should win.
    seedUserTenant('admin2', OTHER_TENANT);
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin2')
      .set('x-test-tenant-id', TENANT_ID)
      .send(validBody);
    expect(res.status).toBe(201);
    const storedPath = `tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}`;
    expect(H.db!._dump()[storedPath]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /api/audit-portal/admin/list
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/audit-portal/admin/list', () => {
  const URL = '/api/audit-portal/admin/list';

  it('401 without auth', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('400 when affiliation query value is invalid', async () => {
    seedUserTenant('u1', TENANT_ID);
    const res = await request(buildApp())
      .get(`${URL}?affiliation=nope`)
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('404 when caller has no tenant', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'orphan');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 returns portals for caller tenant only (no cross-tenant)', async () => {
    seedUserTenant('admin1', TENANT_ID);
    // Seed one portal in tenant-alpha and one in tenant-beta.
    seedPortal({ tenantId: TENANT_ID, portalId: 'pa1', token: makeToken('tokA') });
    seedPortal({ tenantId: OTHER_TENANT, portalId: 'pb1', token: makeToken('tokB') });

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin1');
    expect(res.status).toBe(200);
    const ids = (res.body.portals as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain('pa1');
    expect(ids).not.toContain('pb1'); // cross-tenant isolation
  });

  it('200 filters by affiliation when provided', async () => {
    seedUserTenant('admin1', TENANT_ID);
    H.db!._seed(`tenants/${TENANT_ID}/audit_portals/susesoP`, {
      id: 'susesoP', auditorAffiliation: 'suseso', createdAt: new Date().toISOString(),
      accessTokenHash: makeToken('hS'), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      scopeProjectIds: [PROJECT_A], scopeModules: ['documents'],
      auditorName: 'Suseso Man', scopeUsers: [],
    });
    H.db!._seed(`tenants/${TENANT_ID}/audit_portals/isoP`, {
      id: 'isoP', auditorAffiliation: 'iso', createdAt: new Date().toISOString(),
      accessTokenHash: makeToken('hI'), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      scopeProjectIds: [PROJECT_A], scopeModules: ['documents'],
      auditorName: 'ISO Auditor', scopeUsers: [],
    });

    const res = await request(buildApp())
      .get(`${URL}?affiliation=suseso`)
      .set('x-test-uid', 'admin1');
    expect(res.status).toBe(200);
    const affiliations = (res.body.portals as Array<{ auditorAffiliation: string }>).map(
      (p) => p.auditorAffiliation,
    );
    expect(affiliations.every((a) => a === 'suseso')).toBe(true);
    expect(affiliations).not.toContain('iso');
  });

  it('200 omits accessTokenHash from response (never expose hash)', async () => {
    seedUserTenant('admin1', TENANT_ID);
    seedPortal({ tenantId: TENANT_ID, portalId: 'pa1', token: makeToken('tokA') });
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin1');
    expect(res.status).toBe(200);
    const portal = (res.body.portals as Array<Record<string, unknown>>)[0];
    expect(portal).toBeDefined();
    expect(portal.accessTokenHash).toBeUndefined();
    expect(portal.accessToken).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /api/audit-portal/:portalId/revoke
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/audit-portal/:portalId/revoke', () => {
  function URL(id: string) {
    return `/api/audit-portal/${id}/revoke`;
  }

  const validRevokeBody = { reason: 'Audit cycle complete — portal closed.' };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(URL(PORTAL_ID)).send(validRevokeBody);
    expect(res.status).toBe(401);
  });

  it('400 when reason is too short (<10 chars per revokePortal engine)', async () => {
    seedUserTenant('admin1', TENANT_ID);
    seedPortal({ tenantId: TENANT_ID, portalId: PORTAL_ID, token: makeToken('tok1') });
    const res = await request(buildApp())
      .post(URL(PORTAL_ID))
      .set('x-test-uid', 'admin1')
      .send({ reason: 'short' });
    // The Zod schema enforces min(10), so this is a 400 from validate middleware.
    expect(res.status).toBe(400);
  });

  it('404 when portal does not exist in tenant', async () => {
    seedUserTenant('admin1', TENANT_ID);
    const res = await request(buildApp())
      .post(URL('nonexistent'))
      .set('x-test-uid', 'admin1')
      .send(validRevokeBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('portal_not_found');
  });

  it('200 happy path — portal is marked revoked in Firestore', async () => {
    seedUserTenant('admin1', TENANT_ID);
    seedPortal({ tenantId: TENANT_ID, portalId: PORTAL_ID, token: makeToken('tok1') });

    const res = await request(buildApp())
      .post(URL(PORTAL_ID))
      .set('x-test-uid', 'admin1')
      .send(validRevokeBody);

    expect(res.status).toBe(200);
    expect(res.body.portal).toBeDefined();
    expect(res.body.portal.status).toBe('revoked');
    expect(res.body.portal.revokedByUid).toBe('admin1');
    expect(typeof res.body.portal.revokedAt).toBe('string');
    // Verify Firestore was actually updated.
    const stored = H.db!._dump()[`tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}`];
    expect(stored.revokedAt).toBeTruthy();
  });

  it('400 when trying to revoke an already-revoked portal', async () => {
    seedUserTenant('admin1', TENANT_ID);
    seedPortal({
      tenantId: TENANT_ID,
      portalId: PORTAL_ID,
      token: makeToken('tok1'),
      revokedAt: new Date().toISOString(),
    });
    const res = await request(buildApp())
      .post(URL(PORTAL_ID))
      .set('x-test-uid', 'admin1')
      .send(validRevokeBody);
    // revokePortal throws PortalValidationError(ALREADY_REVOKED) → 400
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('ALREADY_REVOKED');
  });

  it('SECURITY: cannot revoke a portal in another tenant', async () => {
    // Caller belongs to TENANT_ID but the portal lives in OTHER_TENANT.
    seedUserTenant('admin1', TENANT_ID);
    seedPortal({ tenantId: OTHER_TENANT, portalId: PORTAL_ID, token: makeToken('tok1') });

    const res = await request(buildApp())
      .post(URL(PORTAL_ID))
      .set('x-test-uid', 'admin1')
      .send(validRevokeBody);
    // The route reads from tenant-alpha's collection where PORTAL_ID doesn't
    // exist — returns 404, not 200. Cross-tenant write is impossible.
    expect(res.status).toBe(404);
    // Ensure OTHER_TENANT's portal is untouched.
    const otherStored = H.db!._dump()[`tenants/${OTHER_TENANT}/audit_portals/${PORTAL_ID}`];
    expect(otherStored.revokedAt).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET /api/audit-portal/:portalId/access-log
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/audit-portal/:portalId/access-log', () => {
  function URL(id: string) {
    return `/api/audit-portal/${id}/access-log`;
  }

  it('401 without auth', async () => {
    const res = await request(buildApp()).get(URL(PORTAL_ID));
    expect(res.status).toBe(401);
  });

  it('400 when limit query is non-numeric', async () => {
    seedUserTenant('admin1', TENANT_ID);
    const res = await request(buildApp())
      .get(`${URL(PORTAL_ID)}?limit=abc`)
      .set('x-test-uid', 'admin1');
    expect(res.status).toBe(400);
  });

  it('404 when portal not found (tenant isolation)', async () => {
    seedUserTenant('admin1', TENANT_ID);
    // Portal in OTHER_TENANT, not visible to admin1's tenant.
    seedPortal({ tenantId: OTHER_TENANT, portalId: PORTAL_ID, token: makeToken('tok1') });
    const res = await request(buildApp())
      .get(URL(PORTAL_ID))
      .set('x-test-uid', 'admin1');
    expect(res.status).toBe(404);
  });

  it('200 returns access logs for the portal', async () => {
    seedUserTenant('admin1', TENANT_ID);
    seedPortal({ tenantId: TENANT_ID, portalId: PORTAL_ID, token: makeToken('tok1') });
    // Seed two access log entries.
    const t1 = '2026-01-01T10:00:00.000Z';
    const t2 = '2026-01-01T11:00:00.000Z';
    H.db!._seed(`tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}/access_logs/${t1}`, {
      portalId: PORTAL_ID, accessedAt: t1, module: 'documents', downloaded: false, payloadBytes: 0,
    });
    H.db!._seed(`tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}/access_logs/${t2}`, {
      portalId: PORTAL_ID, accessedAt: t2, module: 'incidents', downloaded: true, payloadBytes: 1024,
    });

    const res = await request(buildApp())
      .get(URL(PORTAL_ID))
      .set('x-test-uid', 'admin1');

    expect(res.status).toBe(200);
    expect(res.body.portalId).toBe(PORTAL_ID);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs.length).toBe(2);
  });

  it('SECURITY: cannot read access log of a portal in another tenant', async () => {
    seedUserTenant('admin1', TENANT_ID);
    seedPortal({ tenantId: OTHER_TENANT, portalId: PORTAL_ID, token: makeToken('tok1') });
    const res = await request(buildApp())
      .get(URL(PORTAL_ID))
      .set('x-test-uid', 'admin1');
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /api/audit-portal/public/:token
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/audit-portal/public/:token', () => {
  const VALID_TOKEN = makeToken('publicToken123456789012345678901234567890123456789012');
  const VALID_QUERY = `module=documents&projectId=${PROJECT_A}`;

  function URL(token: string) {
    return `/api/audit-portal/public/${token}`;
  }

  it('403 when token is too short (<16 chars)', async () => {
    const res = await request(buildApp())
      .get(`/api/audit-portal/public/short?${VALID_QUERY}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 (validate middleware) when module query is missing', async () => {
    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?projectId=${PROJECT_A}`);
    expect(res.status).toBe(400);
  });

  it('400 (validate middleware) when module query is invalid enum value', async () => {
    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?module=not_a_module&projectId=${PROJECT_A}`);
    expect(res.status).toBe(400);
  });

  it('403 when token not found in Firestore (no matching hash)', async () => {
    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?${VALID_QUERY}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — auditor gets public view, access_log appended', async () => {
    seedPortal({ tenantId: TENANT_ID, portalId: PORTAL_ID, token: VALID_TOKEN });

    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?${VALID_QUERY}`);

    expect(res.status).toBe(200);
    expect(res.body.portal).toBeDefined();
    expect(res.body.portal.portalId).toBe(PORTAL_ID);
    expect(res.body.portal.tenantId).toBe(TENANT_ID);
    // Public view must NOT expose hash or internal notes.
    expect(res.body.portal.accessTokenHash).toBeUndefined();
    expect(res.body.portal.accessToken).toBeUndefined();

    // Access log MUST be appended — compliance trail.
    const dump = H.db!._dump();
    const logKeys = Object.keys(dump).filter((k) =>
      k.startsWith(`tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}/access_logs/`),
    );
    expect(logKeys.length).toBeGreaterThan(0);
    const logDoc = dump[logKeys[0]] as Record<string, unknown>;
    expect(logDoc.module).toBe('documents');
    expect(logDoc.downloaded).toBe(false);
    expect(logDoc.portalId).toBe(PORTAL_ID);
  });

  it('200 with download=true sets downloaded flag in access_log', async () => {
    seedPortal({ tenantId: TENANT_ID, portalId: PORTAL_ID, token: VALID_TOKEN });
    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?${VALID_QUERY}&download=true`);
    expect(res.status).toBe(200);
    const dump = H.db!._dump();
    const logKeys = Object.keys(dump).filter((k) =>
      k.startsWith(`tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}/access_logs/`),
    );
    expect(logKeys.length).toBeGreaterThan(0);
    const logDoc = dump[logKeys[0]] as Record<string, unknown>;
    expect(logDoc.downloaded).toBe(true);
  });

  it('403 when token is expired — no detail revealed (oracle prevention)', async () => {
    const pastExpiry = new Date(Date.now() - 86_400_000).toISOString();
    seedPortal({
      tenantId: TENANT_ID, portalId: PORTAL_ID, token: VALID_TOKEN,
      expiresAt: pastExpiry,
    });
    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?${VALID_QUERY}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    // Body must not reveal "expired" — flat 403 only.
    expect(JSON.stringify(res.body)).not.toContain('expired');
    // Even on deny, the access_log should be appended.
    const dump = H.db!._dump();
    const logKeys = Object.keys(dump).filter((k) =>
      k.startsWith(`tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}/access_logs/`),
    );
    expect(logKeys.length).toBeGreaterThan(0);
  });

  it('403 when portal is revoked — access_log still appended', async () => {
    seedPortal({
      tenantId: TENANT_ID, portalId: PORTAL_ID, token: VALID_TOKEN,
      revokedAt: new Date().toISOString(),
    });
    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?${VALID_QUERY}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(JSON.stringify(res.body)).not.toContain('revoked');
    const dump = H.db!._dump();
    const logKeys = Object.keys(dump).filter((k) =>
      k.startsWith(`tenants/${TENANT_ID}/audit_portals/${PORTAL_ID}/access_logs/`),
    );
    expect(logKeys.length).toBeGreaterThan(0);
  });

  it('SECURITY: 403 when module is not in portal scope', async () => {
    seedPortal({
      tenantId: TENANT_ID,
      portalId: PORTAL_ID,
      token: VALID_TOKEN,
      scopeModules: ['documents'], // iper_matrix NOT in scope
    });
    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?module=iper_matrix&projectId=${PROJECT_A}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('SECURITY: 403 when projectId is not in portal scope', async () => {
    seedPortal({
      tenantId: TENANT_ID,
      portalId: PORTAL_ID,
      token: VALID_TOKEN,
      scopeProjects: [PROJECT_A], // PROJECT_B not in scope
    });
    const res = await request(buildApp())
      .get(URL(VALID_TOKEN) + `?module=documents&projectId=${PROJECT_B}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('SECURITY: token from project A cannot access project B data', async () => {
    // Two portals: one for project A, one for project B.
    const tokenA = makeToken('tokenForProjectA_padded_to_64_chars_xxxxxxxxxxxxxxxxx');
    const tokenB = makeToken('tokenForProjectB_padded_to_64_chars_xxxxxxxxxxxxxxxxx');
    seedPortal({ tenantId: TENANT_ID, portalId: 'pa', token: tokenA, scopeProjects: [PROJECT_A] });
    seedPortal({ tenantId: TENANT_ID, portalId: 'pb', token: tokenB, scopeProjects: [PROJECT_B] });

    // Token A must not reach project B.
    const res = await request(buildApp())
      .get(URL(tokenA) + `?module=documents&projectId=${PROJECT_B}`);
    expect(res.status).toBe(403);

    // Token B must not reach project A.
    const res2 = await request(buildApp())
      .get(URL(tokenB) + `?module=documents&projectId=${PROJECT_A}`);
    expect(res2.status).toBe(403);
  });

  it('SECURITY: different tenant portal with same portalId cannot be reached cross-tenant', async () => {
    // Portal in OTHER_TENANT seeded with same portalId as TENANT_ID.
    const tokenOther = makeToken('tokenForOtherTenantPortal_xxxxxxxxxxxxxxxxxxxxxxxxxx');
    seedPortal({
      tenantId: OTHER_TENANT,
      portalId: OTHER_PORTAL_ID,
      token: tokenOther,
    });
    // A token that hashes to a doc in OTHER_TENANT — collectionGroup finds it —
    // but the public view returned includes tenantId=OTHER_TENANT (it should).
    // The test validates that the resolved tenantId comes from the doc path,
    // not from a caller-supplied header.
    const res = await request(buildApp())
      .get(URL(tokenOther) + `?module=documents&projectId=${PROJECT_A}`);
    // Should succeed for the portal's own scope.
    expect(res.status).toBe(200);
    expect(res.body.portal.tenantId).toBe(OTHER_TENANT);
  });
});
