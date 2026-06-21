// Real-router supertest for the Sync Status (offline queue tracker) HTTP
// surface (src/server/routes/syncStatus.ts). Five stateless POST endpoints
// over the pure engine in src/services/syncStatus/syncQueueTracker.ts:
//
//   POST /:projectId/sync-status/create-item
//   POST /:projectId/sync-status/transition       (syncing|synced|error)
//   POST /:projectId/sync-status/summarize        (items[]) → QueueSummary
//   POST /:projectId/sync-status/find-ready       (items[]) → ready for retry
//   POST /:projectId/sync-status/derive-badge     (summary) → SyncBadge
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the
// project (never by mocking the gate). verifyAuth + logger + observability
// are mocked; the engine runs unmocked so response shapes are real compute.
//
// All engine functions are pure (no Firestore, no money, no Gemini, no
// Math.random, no audit log), so the 200 assertions re-derive against the
// real engine. The lifecycle transitions stamp `new Date()` timestamps that
// the router cannot pin, so those fields are asserted structurally (valid
// ISO / monotonic relationships) while the deterministic fields (status,
// attempts, content-addressed id, derived badge/summary) are compared exact.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import syncStatusRouter from '../../server/routes/syncStatus.js';
import {
  createItem,
  markSyncError,
  summarizeQueue,
  findItemsReadyForRetry,
  deriveBadge,
  computeItemId,
  type SyncItem,
} from '../../services/syncStatus/syncQueueTracker.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', syncStatusRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A valid, fully-shaped SyncItem we can mutate per case. Built via the real
// engine so the `id` is the actual content-address (no hand-rolled hash).
function baseItem(overrides: Partial<SyncItem> = {}): SyncItem {
  const created = createItem({
    collection: 'incidents',
    op: 'create',
    payload: { title: 'fuga gas', severity: 3 },
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  return { ...created, ...overrides };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ────────────────────────────────────────────────────────────────────────
// 1. create-item
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/sync-status/create-item', () => {
  const url = '/api/p1/sync-status/create-item';
  const body = { collection: 'incidents', op: 'create', payload: { title: 'x', n: 1 } };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 returns a real saved_local item with the content-addressed id', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    const item = res.body.item;
    // Deterministic fields re-derived against the real engine.
    expect(item.id).toBe(computeItemId('incidents', 'create', { title: 'x', n: 1 }));
    expect(item.collection).toBe('incidents');
    expect(item.op).toBe('create');
    expect(item.payload).toEqual({ title: 'x', n: 1 });
    expect(item.status).toBe('saved_local');
    expect(item.attempts).toBe(0);
    // createdAt is engine-stamped (new Date()) — assert it is a real ISO time.
    expect(item.createdAt).toMatch(ISO);
    // A fresh item has no sync timestamps yet.
    expect(item.syncedAt).toBeUndefined();
    expect(item.nextRetryAt).toBeUndefined();
  });

  it('200 the id is idempotent for identical payloads (content-addressed)', async () => {
    const a = await request(buildApp()).post(url).set(uid).send(body);
    const b = await request(buildApp()).post(url).set(uid).send(body);
    expect(a.body.item.id).toBe(b.body.item.id);
  });

  it('400 on missing collection', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ op: 'create', payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an invalid op (not create|update|delete)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ collection: 'c', op: 'upsert', payload: {} });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/sync-status/create-item')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/sync-status/create-item')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. transition
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/sync-status/transition', () => {
  const url = '/api/p1/sync-status/transition';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ transition: 'syncing', item: baseItem() });
    expect(res.status).toBe(401);
  });

  it('200 syncing increments attempts and stamps lastAttemptAt', async () => {
    const item = baseItem({ status: 'saved_local', attempts: 0 });
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ transition: 'syncing', item });
    expect(res.status).toBe(200);
    // Re-derive the deterministic portion via the real engine.
    expect(res.body.item.status).toBe('syncing');
    expect(res.body.item.attempts).toBe(1);
    expect(res.body.item.id).toBe(item.id);
    expect(res.body.item.lastAttemptAt).toMatch(ISO);
  });

  it('200 syncing on an already-synced item is a no-op (engine short-circuit)', async () => {
    // markSyncing returns the item unchanged if status === 'synced'.
    const item = baseItem({ status: 'synced', attempts: 2, syncedAt: '2026-01-02T00:00:00.000Z' });
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ transition: 'syncing', item });
    expect(res.status).toBe(200);
    expect(res.body.item).toEqual(item);
    expect(res.body.item.attempts).toBe(2); // NOT incremented
  });

  it('200 synced clears retry/error fields', async () => {
    const item = baseItem({
      status: 'sync_error',
      attempts: 1,
      nextRetryAt: '2026-01-01T00:00:30.000Z',
      lastError: 'boom',
    });
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ transition: 'synced', item });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('synced');
    expect(res.body.item.syncedAt).toMatch(ISO);
    // markSynced wipes these — they must not survive in the JSON output.
    expect(res.body.item.nextRetryAt).toBeUndefined();
    expect(res.body.item.lastError).toBeUndefined();
  });

  it('200 error before max attempts → sync_error with a future nextRetryAt', async () => {
    // attempts=1 < MAX_ATTEMPTS(5): backoff = 30s * 2^(1-1) = 30s.
    const item = baseItem({ status: 'syncing', attempts: 1 });
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ transition: 'error', item, errorMessage: 'network down' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('sync_error');
    expect(res.body.item.lastError).toBe('network down');
    expect(res.body.item.nextRetryAt).toMatch(ISO);
    // nextRetryAt must be in the future relative to the request.
    expect(new Date(res.body.item.nextRetryAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('200 error at/over max attempts → sync_failed with no nextRetryAt', async () => {
    // attempts=5 >= MAX_ATTEMPTS(5): terminal failure, no retry scheduled.
    const item = baseItem({ status: 'syncing', attempts: 5 });
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ transition: 'error', item, errorMessage: 'gave up' });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('sync_failed');
    expect(res.body.item.nextRetryAt).toBeUndefined();
    // Cross-check against the real engine for the terminal-failure shape.
    const expected = markSyncError(item, 'gave up');
    expect(res.body.item.status).toBe(expected.status);
    expect(res.body.item.nextRetryAt).toBe(expected.nextRetryAt);
  });

  it('400 on an unknown transition value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ transition: 'teleport', item: baseItem() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on error transition missing the required errorMessage', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ transition: 'error', item: baseItem() });
    expect(res.status).toBe(400);
  });

  it('400 when the item fails schema (bad status enum)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ transition: 'syncing', item: baseItem({ status: 'bogus' as never }) });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/sync-status/transition')
      .set(uid)
      .send({ transition: 'syncing', item: baseItem() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. summarize
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/sync-status/summarize', () => {
  const url = '/api/p1/sync-status/summarize';

  const items: SyncItem[] = [
    baseItem({ id: 'a', status: 'saved_local' }),
    baseItem({ id: 'b', status: 'syncing' }),
    baseItem({ id: 'c', status: 'synced' }),
    baseItem({ id: 'd', status: 'sync_error', nextRetryAt: '2026-01-01T00:05:00.000Z' }),
    baseItem({ id: 'e', status: 'sync_error', nextRetryAt: '2026-01-01T00:01:00.000Z' }),
    baseItem({ id: 'f', status: 'sync_failed' }),
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ items });
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine summary (counts, earliest retry, failed list)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ items });
    expect(res.status).toBe(200);
    // Compare against the REAL engine — never reimplement the counting here.
    expect(res.body.summary).toEqual(summarizeQueue(items));
    // Cross-check salient derived facts so a hollow toEqual can't hide breakage.
    expect(res.body.summary.totalItems).toBe(6);
    expect(res.body.summary.byStatus).toEqual({
      saved_local: 1,
      syncing: 1,
      synced: 1,
      sync_error: 2,
      sync_failed: 1,
    });
    // earliest nextRetryAt across the two sync_error items.
    expect(res.body.summary.nextRetryAt).toBe('2026-01-01T00:01:00.000Z');
    // Only the sync_failed item is surfaced for user attention.
    expect(res.body.summary.failedItems).toHaveLength(1);
    expect(res.body.summary.failedItems[0].id).toBe('f');
  });

  it('200 empty queue yields an all-zero summary (honest empty)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ items: [] });
    expect(res.status).toBe(200);
    expect(res.body.summary.totalItems).toBe(0);
    expect(res.body.summary.nextRetryAt).toBeUndefined();
    expect(res.body.summary.failedItems).toEqual([]);
    expect(res.body.summary.byStatus).toEqual(summarizeQueue([]).byStatus);
  });

  it('400 when items is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ items: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when an item in the array is malformed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ items: [{ id: 'x' }] });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/sync-status/summarize')
      .set(uid)
      .send({ items });
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. find-ready
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/sync-status/find-ready', () => {
  const url = '/api/p1/sync-status/find-ready';

  // Two ready (sync_error, retry in the past), in reverse createdAt order so we
  // can prove the engine FIFO-sorts. Plus distractors that must be excluded.
  const past = '2020-01-01T00:00:00.000Z';
  const future = '2099-01-01T00:00:00.000Z';
  const items: SyncItem[] = [
    baseItem({ id: 'ready-late', status: 'sync_error', nextRetryAt: past, createdAt: '2026-01-01T00:00:02.000Z' }),
    baseItem({ id: 'ready-early', status: 'sync_error', nextRetryAt: past, createdAt: '2026-01-01T00:00:01.000Z' }),
    baseItem({ id: 'not-yet', status: 'sync_error', nextRetryAt: future, createdAt: '2026-01-01T00:00:00.000Z' }),
    baseItem({ id: 'failed', status: 'sync_failed', nextRetryAt: past, createdAt: '2026-01-01T00:00:00.000Z' }),
    baseItem({ id: 'synced', status: 'synced', createdAt: '2026-01-01T00:00:00.000Z' }),
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ items });
    expect(res.status).toBe(401);
  });

  it('200 returns only retry-due sync_error items, FIFO by createdAt', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ items });
    expect(res.status).toBe(200);
    // Compare against the REAL engine.
    expect(res.body.ready).toEqual(findItemsReadyForRetry(items));
    // Salient facts: the two past-retry sync_error items, earliest-created first;
    // not-yet / sync_failed / synced are all excluded.
    expect(res.body.ready.map((i: SyncItem) => i.id)).toEqual(['ready-early', 'ready-late']);
  });

  it('200 nothing ready yields an empty list (honest empty)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ items: [baseItem({ id: 'not-yet', status: 'sync_error', nextRetryAt: future })] });
    expect(res.status).toBe(200);
    expect(res.body.ready).toEqual([]);
  });

  it('400 when items is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/sync-status/find-ready')
      .set(uid)
      .send({ items });
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. derive-badge
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/sync-status/derive-badge', () => {
  const url = '/api/p1/sync-status/derive-badge';

  function summary(over: Partial<{
    saved_local: number; syncing: number; synced: number; sync_error: number; sync_failed: number;
    totalItems: number; nextRetryAt: string;
  }> = {}) {
    const byStatus = {
      saved_local: over.saved_local ?? 0,
      syncing: over.syncing ?? 0,
      synced: over.synced ?? 0,
      sync_error: over.sync_error ?? 0,
      sync_failed: over.sync_failed ?? 0,
    };
    const totalItems = over.totalItems ?? Object.values(byStatus).reduce((a, b) => a + b, 0);
    return {
      totalItems,
      byStatus,
      ...(over.nextRetryAt ? { nextRetryAt: over.nextRetryAt } : {}),
      failedItems: [],
    };
  }

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ summary: summary() });
    expect(res.status).toBe(401);
  });

  it('200 red badge when any item failed (highest priority)', async () => {
    // Even with syncing + pending present, sync_failed wins → red.
    const s = summary({ sync_failed: 2, syncing: 1, saved_local: 3, synced: 4 });
    const res = await request(buildApp()).post(url).set(uid).send({ summary: s });
    expect(res.status).toBe(200);
    expect(res.body.badge).toEqual(deriveBadge(s as never));
    expect(res.body.badge.color).toBe('red');
    expect(res.body.badge.count).toBe(2);
  });

  it('200 blue badge when syncing and nothing failed', async () => {
    const s = summary({ syncing: 3, saved_local: 1, synced: 1 });
    const res = await request(buildApp()).post(url).set(uid).send({ summary: s });
    expect(res.status).toBe(200);
    expect(res.body.badge).toEqual(deriveBadge(s as never));
    expect(res.body.badge.color).toBe('blue');
    expect(res.body.badge.count).toBe(3);
  });

  it('200 amber badge when pending but not syncing/failed', async () => {
    // pending = totalItems - synced = 4 - 1 = 3.
    const s = summary({ saved_local: 3, synced: 1 });
    const res = await request(buildApp()).post(url).set(uid).send({ summary: s });
    expect(res.status).toBe(200);
    expect(res.body.badge).toEqual(deriveBadge(s as never));
    expect(res.body.badge.color).toBe('amber');
    expect(res.body.badge.count).toBe(3);
  });

  it('200 green badge when everything is synced', async () => {
    const s = summary({ synced: 5 });
    const res = await request(buildApp()).post(url).set(uid).send({ summary: s });
    expect(res.status).toBe(200);
    expect(res.body.badge).toEqual(deriveBadge(s as never));
    expect(res.body.badge.color).toBe('green');
    expect(res.body.badge.count).toBe(0);
  });

  it('400 when byStatus is missing a required status key', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ summary: { totalItems: 0, byStatus: { syncing: 0 }, failedItems: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a negative count', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ summary: summary({ totalItems: -1 }) });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/sync-status/derive-badge')
      .set(uid)
      .send({ summary: summary({ synced: 1 }) });
    expect(res.status).toBe(403);
  });
});
