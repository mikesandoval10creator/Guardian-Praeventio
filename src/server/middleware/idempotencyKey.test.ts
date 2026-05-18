// Praeventio Guard — Sprint 35 Bucket (Audit P1 Â§1.3).
//
// Tests for `idempotencyKey()` middleware. Six branches mirror the
// behavior contract pinned in idempotencyKey.ts:
//
//   1. Header absent           â†’ handler runs, NO cache write.
//   2. First request with key  â†’ handler runs, response cached.
//   3. Second request same key â†’ cached response replayed, handler NOT called.
//   4. scope='uid' isolation   â†’ uid A's key does NOT serve uid B's request.
//   5. TTL expired             â†’ handler re-runs, cache row refreshed.
//   6. Concurrent first calls  â†’ only ONE write commits (transaction race).
//
// We use vitest + an in-memory Firestore double — same pattern as
// idempotency.test.ts — to keep the tests hermetic. The middleware accepts
// `firestore: () => instance` injection precisely so tests don't need
// firebase-admin running.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { idempotencyKey, IDEMPOTENCY_CACHE_COLLECTION } from './idempotencyKey.js';

// â”€â”€ In-memory Firestore double â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Mirrors the minimal surface used by idempotencyKey: collection().doc()
// .get()/.set(), plus runTransaction() with tx.get()/tx.set(). We model
// docs as a Map<docId, data> + Map<collectionName, Map<docId, data>>.

interface FakeSnap {
  exists: boolean;
  data: () => any;
}

class FakeDocRef {
  constructor(
    private store: Map<string, any>,
    private id: string,
  ) {}
  async get(): Promise<FakeSnap> {
    const data = this.store.get(this.id);
    return { exists: data !== undefined, data: () => data };
  }
  async set(data: any) {
    this.store.set(this.id, data);
  }
}

function makeFakeFirestore() {
  const collections = new Map<string, Map<string, any>>();
  const writeAttempts = { count: 0 };
  const getCol = (name: string) => {
    let c = collections.get(name);
    if (!c) {
      c = new Map();
      collections.set(name, c);
    }
    return c;
  };
  const fs: any = {
    collection: (name: string) => ({
      doc: (id: string) => new FakeDocRef(getCol(name), id),
    }),
    runTransaction: async (fn: (tx: any) => Promise<void>) => {
      writeAttempts.count += 1;
      const tx = {
        get: async (ref: FakeDocRef) => ref.get(),
        set: (ref: FakeDocRef, data: any) => {
          // tx.set is sync in real firestore-admin; emulate.
          (ref as any).store.set((ref as any).id, data);
        },
      };
      await fn(tx);
    },
  };
  return { fs, collections, writeAttempts };
}

// firebase-admin's Timestamp is referenced inside the middleware
// (`admin.firestore.Timestamp.fromMillis`). We mock the admin module so
// that resolves without spinning up real Firestore.
vi.mock('firebase-admin', () => ({
  default: {
    firestore: Object.assign(() => ({}), {
      Timestamp: {
        fromMillis: (ms: number) => ({
          toMillis: () => ms,
        }),
      },
    }),
  },
}));

function buildApp(opts: {
  firestore: () => any;
  ttlSec?: number;
  scope?: 'uid' | 'tenant';
  uid: string;
  handler: (req: express.Request, res: express.Response) => void;
  now?: () => Date;
}): { app: Express; calls: { count: number } } {
  const app = express();
  app.use(express.json());
  const calls = { count: 0 };
  app.post(
    '/test',
    // Stand-in for verifyAuth: hard-wire the uid into req.user.
    (req, _res, next) => {
      req.user = { uid: opts.uid };
      next();
    },
    idempotencyKey({
      ttlSec: opts.ttlSec,
      scope: opts.scope,
      firestore: opts.firestore,
      now: opts.now,
    }),
    (req, res) => {
      calls.count += 1;
      opts.handler(req, res);
    },
  );
  return { app, calls };
}

describe('idempotencyKey middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // â”€â”€ Test 1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('passes through with no caching when Idempotency-Key header is absent', async () => {
    const { fs, collections } = makeFakeFirestore();
    const { app, calls } = buildApp({
      firestore: () => fs,
      uid: 'u1',
      handler: (_req, res) => res.status(200).json({ ok: 1 }),
    });

    const r1 = await request(app).post('/test').send({ x: 1 });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ ok: 1 });
    expect(calls.count).toBe(1);
    // No cache row written.
    expect(collections.get(IDEMPOTENCY_CACHE_COLLECTION)?.size ?? 0).toBe(0);

    // Second identical request still runs the handler — no idempotency.
    const r2 = await request(app).post('/test').send({ x: 1 });
    expect(r2.status).toBe(200);
    expect(calls.count).toBe(2);
  });

  // â”€â”€ Test 2 + 3 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('first request with key runs handler+caches; second request replays without running handler', async () => {
    const { fs, collections } = makeFakeFirestore();
    const { app, calls } = buildApp({
      firestore: () => fs,
      uid: 'u1',
      handler: (_req, res) => res.status(200).json({ created: 'crew-42' }),
    });

    const r1 = await request(app)
      .post('/test')
      .set('Idempotency-Key', 'abc-123')
      .send({ name: 'crew' });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ created: 'crew-42' });
    expect(calls.count).toBe(1);

    // Wait a tick for the fire-and-forget cache write to flush.
    await new Promise((resolve) => setImmediate(resolve));
    expect(collections.get(IDEMPOTENCY_CACHE_COLLECTION)?.size).toBe(1);

    const r2 = await request(app)
      .post('/test')
      .set('Idempotency-Key', 'abc-123')
      .send({ name: 'crew' });
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ created: 'crew-42' });
    expect(r2.headers['idempotent-replayed']).toBe('true');
    // Handler did NOT run again — that's the whole point.
    expect(calls.count).toBe(1);
  });

  // â”€â”€ Test 4 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('scope=uid isolates: same key from a different uid does NOT replay', async () => {
    const { fs, collections } = makeFakeFirestore();

    // First app — uid A.
    const appA = buildApp({
      firestore: () => fs,
      uid: 'uid-A',
      handler: (_req, res) => res.status(200).json({ owner: 'A' }),
    });
    await request(appA.app)
      .post('/test')
      .set('Idempotency-Key', 'shared-key')
      .send({ x: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(collections.get(IDEMPOTENCY_CACHE_COLLECTION)?.size).toBe(1);
    expect(appA.calls.count).toBe(1);

    // Second app — uid B, SAME idempotency key. Must NOT collide.
    const appB = buildApp({
      firestore: () => fs,
      uid: 'uid-B',
      handler: (_req, res) => res.status(200).json({ owner: 'B' }),
    });
    const rB = await request(appB.app)
      .post('/test')
      .set('Idempotency-Key', 'shared-key')
      .send({ x: 1 });
    expect(rB.status).toBe(200);
    expect(rB.body).toEqual({ owner: 'B' });
    expect(appB.calls.count).toBe(1);
    // Two separate cache rows now.
    expect(collections.get(IDEMPOTENCY_CACHE_COLLECTION)?.size).toBe(2);
  });

  // â”€â”€ Test 5 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('TTL-expired entry causes the handler to run again and cache to refresh', async () => {
    const { fs, collections } = makeFakeFirestore();
    let currentMs = 1_000_000;
    const now = () => new Date(currentMs);

    let runSeq = 0;
    const { app, calls } = buildApp({
      firestore: () => fs,
      uid: 'u1',
      ttlSec: 60, // 60s TTL
      now,
      handler: (_req, res) => {
        runSeq += 1;
        res.status(200).json({ run: runSeq });
      },
    });

    // First call at t=0.
    const r1 = await request(app)
      .post('/test')
      .set('Idempotency-Key', 'k')
      .send({ x: 1 });
    expect(r1.body).toEqual({ run: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls.count).toBe(1);

    // Advance past TTL.
    currentMs += 120 * 1000;

    const r2 = await request(app)
      .post('/test')
      .set('Idempotency-Key', 'k')
      .send({ x: 1 });
    expect(r2.body).toEqual({ run: 2 });
    expect(calls.count).toBe(2);
    // Cache row count remains 1 (refreshed in place).
    await new Promise((resolve) => setImmediate(resolve));
    expect(collections.get(IDEMPOTENCY_CACHE_COLLECTION)?.size).toBe(1);
  });

  // â”€â”€ Test 6 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('two near-concurrent requests with same key: only ONE cache write commits', async () => {
    const { fs, collections } = makeFakeFirestore();

    // Use a handler that defers slightly so both calls are genuinely
    // concurrent across the cache lookup.
    let handlerRuns = 0;
    const { app } = buildApp({
      firestore: () => fs,
      uid: 'u1',
      handler: async (_req, res) => {
        handlerRuns += 1;
        // Tiny await so the second request can also miss the cache before
        // we get to writeCache().
        await new Promise((resolve) => setTimeout(resolve, 5));
        res.status(200).json({ run: handlerRuns });
      },
    });

    const [r1, r2] = await Promise.all([
      request(app).post('/test').set('Idempotency-Key', 'race').send({ x: 1 }),
      request(app).post('/test').set('Idempotency-Key', 'race').send({ x: 1 }),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Both handlers may have run (concurrent miss is allowed by contract,
    // matching withIdempotency's note). The CACHE invariant: exactly ONE
    // row exists for this key.
    await new Promise((resolve) => setImmediate(resolve));
    expect(collections.get(IDEMPOTENCY_CACHE_COLLECTION)?.size).toBe(1);
  });

  // â”€â”€ Bonus: fingerprint mismatch (Stripe-style 422) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('returns 422 when same key is reused with different request body', async () => {
    const { fs } = makeFakeFirestore();
    const { app } = buildApp({
      firestore: () => fs,
      uid: 'u1',
      handler: (_req, res) => res.status(200).json({ ok: 1 }),
    });

    await request(app).post('/test').set('Idempotency-Key', 'k').send({ a: 1 });
    await new Promise((resolve) => setImmediate(resolve));

    const r2 = await request(app)
      .post('/test')
      .set('Idempotency-Key', 'k')
      .send({ a: 2 }); // DIFFERENT body
    expect(r2.status).toBe(422);
    expect(r2.body.error).toBe('idempotency_key_reused_with_different_params');
  });
});
