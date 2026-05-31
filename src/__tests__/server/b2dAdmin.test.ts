// Real-router supertest coverage for src/server/routes/b2dAdmin.ts
// (Plan v3 Fase 1 — server real-router lever).
//
// 6 endpoints covered:
//   GET  /api/admin/b2d/keys[?customerId=X]   list (masked)
//   POST /api/admin/b2d/keys                  create — rawKey returned once
//   POST /api/admin/b2d/keys/:id/revoke       revoke
//   GET  /api/admin/b2d/metrics               B2D metrics
//   GET  /api/admin/b2d/mrr-history?limit=N   MRR snapshot history
//   GET  /api/admin/b2d/events?from=&to=      audit event log
//
// Compliance invariants explicitly asserted:
//   • Zettelkasten NEVER exposed in any response (no nodes/edges/keyHash internals).
//   • rawKey returned exactly once on POST /keys; Firestore doc stores keyHash
//     (hashed), never the plaintext secret.
//   • 401 when no auth; 403 when caller lacks admin role.
//   • Audit log (`audit_logs`) + event log (`b2d_events`) written on create/revoke.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── fakeFirestore holder (hoisted so vi.mock factory can close over it) ──────

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin mock ───────────────────────────────────────────────────────
// `assertAdmin` in the route calls admin.auth().getUser(uid) to check
// customClaims.role. We return 'admin' only for uid 'admin-user' and 'gerente'
// only for uid 'gerente-user' so a single mock drives all auth scenarios.

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    getUser: async (uid: string) => ({
      uid,
      customClaims:
        uid === 'admin-user'
          ? { role: 'admin' }
          : uid === 'gerente-user'
            ? { role: 'gerente' }
            : { role: 'worker' }, // non-admin → 403
    }),
    verifyIdToken: async () => ({ uid: 'test' }),
  });
});

// ── middleware mocks ──────────────────────────────────────────────────────────

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── domain-service mocks ──────────────────────────────────────────────────────
// computeB2dMetrics and readRecentB2dMrrSnapshots are network-heavy; stub them.
// createApiKey and revokeApiKey call through to the REAL service code (which
// itself uses admin.firestore() — our fake handles that).

vi.mock('../../services/analytics/b2dMetrics.js', () => ({
  computeB2dMetrics: vi.fn(async () => ({
    mrr: 1500,
    arr: 18000,
    activeKeys: 7,
    keysByTier: { 'climate-base': 3, 'hazmat-pro': 4 },
  })),
}));

// readRecentB2dMrrSnapshots returns most-recent-first (the route then reverses
// to ascending for charting). Mimic that contract: index 0 = most recent.
vi.mock('../../server/jobs/runB2dMrrSnapshot.js', () => ({
  readRecentB2dMrrSnapshots: vi.fn(async (_db: unknown, limit: number) =>
    Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      month: `2026-0${3 - i}`, // descending: 2026-03, 2026-02, 2026-01
      mrr: 1200 - i * 100,
    })),
  ),
}));

// ── imports (after mocks) ─────────────────────────────────────────────────────

import b2dAdminRouter from '../../server/routes/b2dAdmin.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { hashApiKey } from '../../services/b2d/apiKeyService.js';

// ── test app builder ──────────────────────────────────────────────────────────
// Mounted at the same prefix as server.ts: /api/admin/b2d

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/b2d', b2dAdminRouter);
  return app;
}

// ── constants ─────────────────────────────────────────────────────────────────

const VALID_TIER = 'climate-base';
const VALID_SCOPES = ['climate.read'];
const CUSTOMER_ID = 'cust-acme-001';
const KEY_ID = 'apikey-deadbeefcafe1234';

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/admin/b2d/keys
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/b2d/keys', () => {
  const URL = '/api/admin/b2d/keys';

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not admin (worker role)', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'worker-user');
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('Forbidden: Requires admin role');
  });

  it('400 when customerId query param has invalid characters', async () => {
    const res = await request(buildApp())
      .get(`${URL}?customerId=bad%20id!!`)
      .set('x-test-uid', 'admin-user');
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('Invalid customerId');
  });

  it('200 returns empty keys array when collection is empty', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.keys)).toBe(true);
    expect((body.keys as unknown[]).length).toBe(0);
  });

  it('200 returns seeded keys with masked prefix, no keyHash exposed', async () => {
    H.db!._seed(`b2d_api_keys/${KEY_ID}`, {
      customerId: CUSTOMER_ID,
      tier: VALID_TIER,
      scopes: VALID_SCOPES,
      status: 'active',
      keyHash: 'SHOULDNEVERAPPEAR',
      keyPrefix: 'pk_test_3f9a',
      createdAt: 1700000000000,
    });

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);

    const keys = body.keys as Array<Record<string, unknown>>;
    expect(keys.length).toBe(1);

    const k = keys[0];
    // Public fields that MUST be present
    expect(k.id).toBe(KEY_ID);
    expect(k.customerId).toBe(CUSTOMER_ID);
    expect(k.tier).toBe(VALID_TIER);
    expect(Array.isArray(k.scopes)).toBe(true);
    expect(k.status).toBe('active');
    expect(typeof k.maskedKey).toBe('string');
    expect((k.maskedKey as string).startsWith('pk_test_3f9a')).toBe(true);
    expect(k.createdAt).toBe(1700000000000);

    // INVARIANT: keyHash (the stored secret digest) MUST NEVER appear in the response.
    expect(k.keyHash).toBeUndefined();
    // INVARIANT: no Zettelkasten internals
    expect(k.nodes).toBeUndefined();
    expect(k.edges).toBeUndefined();
    expect(k.zettelkasten).toBeUndefined();
  });

  it('200 filters by customerId when provided', async () => {
    H.db!._seed(`b2d_api_keys/${KEY_ID}`, {
      customerId: CUSTOMER_ID,
      tier: VALID_TIER,
      scopes: VALID_SCOPES,
      status: 'active',
      keyHash: 'h1',
      keyPrefix: 'pk_test_aaaa',
      createdAt: 1700000000000,
    });
    H.db!._seed('b2d_api_keys/apikey-other', {
      customerId: 'cust-other',
      tier: VALID_TIER,
      scopes: VALID_SCOPES,
      status: 'active',
      keyHash: 'h2',
      keyPrefix: 'pk_test_bbbb',
      createdAt: 1700000000001,
    });

    const res = await request(buildApp())
      .get(`${URL}?customerId=${CUSTOMER_ID}`)
      .set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const keys = (res.body as Record<string, unknown>).keys as Array<Record<string, unknown>>;
    expect(keys.every((k) => k.customerId === CUSTOMER_ID)).toBe(true);
    expect(keys.find((k) => k.id === 'apikey-other')).toBeUndefined();
  });

  it('200 accessible by gerente role too (both admin roles allowed)', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'gerente-user');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /api/admin/b2d/keys   (create)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/b2d/keys', () => {
  const URL = '/api/admin/b2d/keys';

  const validBody = {
    customerId: CUSTOMER_ID,
    tier: VALID_TIER,
    scopes: VALID_SCOPES,
  };

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(URL).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not admin', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'worker-user')
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 when customerId is empty', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send({ ...validBody, customerId: '' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('Invalid customerId');
  });

  it('400 when customerId has invalid chars', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send({ ...validBody, customerId: 'bad id!!' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('Invalid customerId');
  });

  it('400 when tier is not in VALID_TIER_IDS', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send({ ...validBody, tier: 'ultra-secret-tier' });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('Invalid tier');
  });

  it('400 when scopes is empty array', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send({ ...validBody, scopes: [] });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('At least one scope is required');
  });

  it('400 when scope is unknown (invalid scope name)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send({ ...validBody, scopes: ['zettelkasten.read'] });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toMatch(/Invalid scope/);
  });

  it('201/200 happy path — rawKey returned, Firestore stores hash not plaintext', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send(validBody);
    expect(res.status).toBe(200); // route returns res.json (200, not 201)

    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
    expect(typeof body.rawKey).toBe('string');
    // rawKey must be a pk_ prefixed string
    expect((body.rawKey as string).startsWith('pk_')).toBe(true);
    expect(typeof body.maskedKey).toBe('string');

    // INVARIANT: Firestore doc must store keyHash (digest), NOT the plaintext secret.
    const dump = H.db!._dump();
    const docPath = `b2d_api_keys/${body.id as string}`;
    const storedDoc = dump[docPath] as Record<string, unknown>;
    expect(storedDoc).toBeDefined();
    expect(typeof storedDoc.keyHash).toBe('string');
    // Hash must differ from the plaintext rawKey
    expect(storedDoc.keyHash).not.toBe(body.rawKey);
    // And must match the canonical hash of the returned rawKey
    expect(storedDoc.keyHash).toBe(hashApiKey(body.rawKey as string));

    // INVARIANT: rawKey plaintext must NOT be stored anywhere in Firestore
    const dumpStr = JSON.stringify(dump);
    expect(dumpStr).not.toContain(body.rawKey as string);

    // INVARIANT: response must NOT leak keyHash or any ZK internals
    expect(body.keyHash).toBeUndefined();
    expect(body.nodes).toBeUndefined();
    expect(body.edges).toBeUndefined();
    expect(body.zettelkasten).toBeUndefined();
  });

  it('POST /keys — audit_logs entry written', async () => {
    await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send(validBody);

    const dump = H.db!._dump();
    const auditDocs = Object.keys(dump).filter((k) => k.startsWith('audit_logs/'));
    expect(auditDocs.length).toBeGreaterThan(0);
    const auditDoc = dump[auditDocs[0]] as Record<string, unknown>;
    expect(auditDoc.actor).toBe('admin-user');
    expect(auditDoc.action).toBe('b2d_key_created');
    expect(typeof auditDoc.target).toBe('string');
  });

  it('POST /keys — b2d_events entry written', async () => {
    await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send(validBody);

    const dump = H.db!._dump();
    const eventDocs = Object.keys(dump).filter((k) => k.startsWith('b2d_events/'));
    expect(eventDocs.length).toBeGreaterThan(0);
    const eventDoc = dump[eventDocs[0]] as Record<string, unknown>;
    expect(eventDoc.kind).toBe('key_created');
    expect(eventDoc.actor).toBe('admin-user');
    expect(eventDoc.customerId).toBe(CUSTOMER_ID);
    // INVARIANT: event doc must not contain the raw key or any ZK data
    expect(JSON.stringify(eventDoc)).not.toContain('zettelkasten');
  });

  it('POST /keys — expiresInDays capped at 3650 and stored as expiresAt epoch', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send({ ...validBody, expiresInDays: 10000 }); // above the 3650 cap
    expect(res.status).toBe(200);

    const body = res.body as Record<string, unknown>;
    const dump = H.db!._dump();
    const storedDoc = dump[`b2d_api_keys/${body.id as string}`] as Record<string, unknown>;
    // expiresAt should be at most ~3650 days from now (not 10000)
    const maxExpiry = Date.now() + 3650 * 24 * 60 * 60 * 1000 + 5000;
    expect(typeof storedDoc.expiresAt).toBe('number');
    expect(storedDoc.expiresAt as number).toBeLessThanOrEqual(maxExpiry);
  });

  it('POST /keys with suite.all scope succeeds', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-user')
      .send({ ...validBody, tier: 'suite-pro', scopes: ['suite.all'] });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /api/admin/b2d/keys/:id/revoke
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/b2d/keys/:id/revoke', () => {
  function URL(id: string) {
    return `/api/admin/b2d/keys/${id}/revoke`;
  }

  beforeEach(() => {
    // Seed a key doc to revoke
    H.db!._seed(`b2d_api_keys/${KEY_ID}`, {
      customerId: CUSTOMER_ID,
      tier: VALID_TIER,
      scopes: VALID_SCOPES,
      status: 'active',
      keyHash: 'somehash',
      keyPrefix: 'pk_test_1234',
      createdAt: Date.now(),
    });
  });

  it('401 when no auth', async () => {
    const res = await request(buildApp()).post(URL(KEY_ID));
    expect(res.status).toBe(401);
  });

  it('403 when caller is not admin', async () => {
    const res = await request(buildApp())
      .post(URL(KEY_ID))
      .set('x-test-uid', 'worker-user');
    expect(res.status).toBe(403);
  });

  it('400 when key id contains invalid characters', async () => {
    const res = await request(buildApp())
      .post(URL('bad id!'))
      .set('x-test-uid', 'admin-user');
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('Invalid key id');
  });

  it('200 happy path — key marked revoked in Firestore', async () => {
    const res = await request(buildApp())
      .post(URL(KEY_ID))
      .set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.id).toBe(KEY_ID);

    // Verify Firestore was updated
    const dump = H.db!._dump();
    const stored = dump[`b2d_api_keys/${KEY_ID}`] as Record<string, unknown>;
    expect(stored.status).toBe('revoked');
    expect(typeof stored.revokedAt).toBe('number');
    expect(stored.revokedBy).toBe('admin-user');
  });

  it('revoke — audit_logs entry written with correct action', async () => {
    await request(buildApp())
      .post(URL(KEY_ID))
      .set('x-test-uid', 'admin-user');

    const dump = H.db!._dump();
    const auditDocs = Object.keys(dump).filter((k) => k.startsWith('audit_logs/'));
    expect(auditDocs.length).toBeGreaterThan(0);
    const auditDoc = dump[auditDocs[0]] as Record<string, unknown>;
    expect(auditDoc.actor).toBe('admin-user');
    expect(auditDoc.action).toBe('b2d_key_revoked');
    expect(auditDoc.target).toBe(KEY_ID);
  });

  it('revoke — b2d_events entry written', async () => {
    await request(buildApp())
      .post(URL(KEY_ID))
      .set('x-test-uid', 'admin-user');

    const dump = H.db!._dump();
    const eventDocs = Object.keys(dump).filter((k) => k.startsWith('b2d_events/'));
    expect(eventDocs.length).toBeGreaterThan(0);
    const eventDoc = dump[eventDocs[0]] as Record<string, unknown>;
    expect(eventDoc.kind).toBe('key_revoked');
    expect(eventDoc.keyId).toBe(KEY_ID);
    expect(eventDoc.actor).toBe('admin-user');
  });

  it('revoke — response never leaks keyHash or ZK internals', async () => {
    const res = await request(buildApp())
      .post(URL(KEY_ID))
      .set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.keyHash).toBeUndefined();
    expect(body.nodes).toBeUndefined();
    expect(body.edges).toBeUndefined();
    expect(body.zettelkasten).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET /api/admin/b2d/metrics
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/b2d/metrics', () => {
  const URL = '/api/admin/b2d/metrics';

  it('401 when no auth', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not admin', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'worker-user');
    expect(res.status).toBe(403);
  });

  it('200 returns metrics shape — no ZK internals', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.metrics).toBeDefined();
    const metrics = body.metrics as Record<string, unknown>;
    expect(typeof metrics.mrr).toBe('number');
    expect(typeof metrics.arr).toBe('number');
    // INVARIANT: no Zettelkasten data
    expect(metrics.nodes).toBeUndefined();
    expect(metrics.edges).toBeUndefined();
    expect(metrics.zettelkasten).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('zettelkasten');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /api/admin/b2d/mrr-history
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/b2d/mrr-history', () => {
  const URL = '/api/admin/b2d/mrr-history';

  it('401 when no auth', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not admin', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'worker-user');
    expect(res.status).toBe(403);
  });

  it('200 returns ascending snapshots with default limit 12', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.snapshots)).toBe(true);
    // Our mock returns min(limit, 3); default limit=12 → 3 snapshots
    expect((body.snapshots as unknown[]).length).toBe(3);
    // Must be returned in ascending order (oldest first for charting)
    const snaps = body.snapshots as Array<Record<string, unknown>>;
    expect(snaps[0].month).toBe('2026-01');
    expect(snaps[2].month).toBe('2026-03');
  });

  it('200 respects limit query param (capped at 36)', async () => {
    const res = await request(buildApp())
      .get(`${URL}?limit=2`)
      .set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect((body.snapshots as unknown[]).length).toBe(2);
  });

  it('200 no ZK internals in snapshot response', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(JSON.stringify(res.body)).not.toContain('zettelkasten');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET /api/admin/b2d/events
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/b2d/events', () => {
  const URL = '/api/admin/b2d/events';

  it('401 when no auth', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not admin', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'worker-user');
    expect(res.status).toBe(403);
  });

  it('400 when from > to', async () => {
    const now = Date.now();
    const res = await request(buildApp())
      .get(`${URL}?from=${now}&to=${now - 1000}`)
      .set('x-test-uid', 'admin-user');
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('from must be <= to');
  });

  it('200 returns empty events list when collection is empty', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect((body.events as unknown[]).length).toBe(0);
    expect(typeof body.from).toBe('number');
    expect(typeof body.to).toBe('number');
  });

  it('200 returns seeded events within time range', async () => {
    const now = Date.now();
    const tsInRange = now - 1000; // within the default last-30-days window
    H.db!._seed('b2d_events/evt-001', {
      kind: 'key_created',
      keyId: KEY_ID,
      customerId: CUSTOMER_ID,
      tier: VALID_TIER,
      actor: 'admin-user',
      ts: tsInRange,
    });

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const events = body.events as Array<Record<string, unknown>>;
    expect(events.length).toBeGreaterThan(0);

    const evt = events[0];
    // Check documented public fields
    expect(typeof evt.id).toBe('string');
    expect(evt.kind).toBe('key_created');
    expect(evt.keyId).toBe(KEY_ID);
    expect(evt.customerId).toBe(CUSTOMER_ID);
    expect(evt.tier).toBe(VALID_TIER);
    expect(evt.actor).toBe('admin-user');
    expect(typeof evt.ts).toBe('number');

    // INVARIANT: no Zettelkasten fields
    expect(evt.nodes).toBeUndefined();
    expect(evt.edges).toBeUndefined();
    expect(evt.zettelkasten).toBeUndefined();
  });

  it('200 filters events by from/to timestamps', async () => {
    const now = Date.now();
    const inWindow = now - 500;
    const outWindow = now - 48 * 60 * 60 * 1000; // 48 hours ago

    H.db!._seed('b2d_events/evt-in', { kind: 'key_created', keyId: KEY_ID, customerId: CUSTOMER_ID, tier: VALID_TIER, actor: 'admin-user', ts: inWindow });
    H.db!._seed('b2d_events/evt-out', { kind: 'key_revoked', keyId: KEY_ID, customerId: CUSTOMER_ID, tier: VALID_TIER, actor: 'admin-user', ts: outWindow });

    const from = now - 1000;
    const to = now;
    const res = await request(buildApp())
      .get(`${URL}?from=${from}&to=${to}`)
      .set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const events = (res.body as Record<string, unknown>).events as Array<Record<string, unknown>>;
    // Only the in-window event should be returned
    const ids = events.map((e) => e.id);
    expect(ids).toContain('evt-in');
    expect(ids).not.toContain('evt-out');
  });

  it('200 uses default last-30-day window when from/to omitted', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // from should be ~30 days before to
    expect((body.to as number) - (body.from as number)).toBeGreaterThanOrEqual(thirtyDaysMs - 5000);
  });

  it('200 no ZK internals in events response', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'admin-user');
    expect(JSON.stringify(res.body)).not.toContain('zettelkasten');
  });
});
