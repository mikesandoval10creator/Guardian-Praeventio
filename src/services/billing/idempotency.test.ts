// Praeventio Guard — withIdempotency() unit tests.
//
// We mock the Firestore Admin SDK with the absolute minimum chained-call
// surface that `withIdempotency` exercises:
//   db.collection(name).doc(key).get() / .set() / .update()
//
// The contract under test is the lock-then-complete dance documented in
// `idempotency.ts`. Each test pins one branch of the state machine.
//
// We do NOT pull in firebase-admin here — that keeps these tests fast and
// avoids the real SDK's lazy-init paths. The helper accepts any object that
// matches the minimal `.collection().doc()` shape (see `MinimalFirestore`).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  withIdempotency,
  IDEMPOTENCY_DEFAULT_STALE_MS,
  type MinimalFirestore,
} from './idempotency.js';

// ───────────────────────────────────────────────────────────────────────────
// Tiny in-memory Firestore fake. Each test gets its own instance so state
// never leaks between cases.
// ───────────────────────────────────────────────────────────────────────────

interface FakeDoc {
  data: Record<string, any> | undefined;
}

function makeFakeFirestore(): {
  db: MinimalFirestore;
  store: Map<string, FakeDoc>;
  getSpy: ReturnType<typeof vi.fn>;
  setSpy: ReturnType<typeof vi.fn>;
  updateSpy: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, FakeDoc>();
  const getSpy = vi.fn();
  const setSpy = vi.fn();
  const updateSpy = vi.fn();

  const db: MinimalFirestore = {
    collection(collectionName: string) {
      return {
        doc(key: string) {
          const path = `${collectionName}/${key}`;
          return {
            get: async () => {
              getSpy(path);
              const entry = store.get(path);
              return {
                exists: !!entry,
                data: () => entry?.data,
              };
            },
            set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
              setSpy(path, data, options);
              const prev = store.get(path);
              if (options?.merge && prev?.data) {
                store.set(path, { data: { ...prev.data, ...data } });
              } else {
                store.set(path, { data: { ...data } });
              }
            },
            update: async (data: Record<string, any>) => {
              updateSpy(path, data);
              const prev = store.get(path);
              if (!prev) {
                throw new Error('cannot update missing doc');
              }
              store.set(path, { data: { ...prev.data, ...data } });
            },
          };
        },
      };
    },
  };

  return { db, store, getSpy, setSpy, updateSpy };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-28T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withIdempotency — fresh key (doc absent)', () => {
  it('writes in_progress lock, runs work, marks done, returns fresh-success', async () => {
    const { db, store, setSpy, updateSpy } = makeFakeFirestore();
    const work = vi.fn(async () => 'ok-result');

    const outcome = await withIdempotency(
      db,
      { collection: 'processed_pubsub', key: 'msg-1' },
      work,
    );

    expect(work).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'fresh-success', result: 'ok-result' });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(store.get('processed_pubsub/msg-1')?.data?.status).toBe('done');
  });
});

describe('withIdempotency — existing done doc', () => {
  it('skips work entirely and returns duplicate with previousResult', async () => {
    const { db, store } = makeFakeFirestore();
    store.set('processed_pubsub/msg-2', {
      data: { status: 'done', result: { foo: 'bar' }, completedAtMs: Date.now() },
    });

    const work = vi.fn(async () => 'should-not-run');
    const outcome = await withIdempotency(
      db,
      { collection: 'processed_pubsub', key: 'msg-2' },
      work,
    );

    expect(work).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('duplicate');
    if (outcome.kind === 'duplicate') {
      expect(outcome.previousResult).toEqual({ foo: 'bar' });
    }
  });
});

describe('withIdempotency — existing in_progress fresh', () => {
  it('returns in-flight without running work when lock is < 5 min old', async () => {
    const { db, store } = makeFakeFirestore();
    const lockedAtMs = Date.now() - 60_000; // 1 minute ago
    store.set('processed_pubsub/msg-3', {
      data: { status: 'in_progress', lockedAtMs },
    });

    const work = vi.fn(async () => 'unreachable');
    const outcome = await withIdempotency(
      db,
      { collection: 'processed_pubsub', key: 'msg-3' },
      work,
    );

    expect(work).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'in-flight' });
  });
});

describe('withIdempotency — existing in_progress stale', () => {
  it('steals the lock, runs work, returns stale-retry', async () => {
    const { db, store, setSpy } = makeFakeFirestore();
    const lockedAtMs = Date.now() - 10 * 60 * 1000; // 10 min ago > 5 min default
    store.set('processed_pubsub/msg-4', {
      data: { status: 'in_progress', lockedAtMs },
    });

    const work = vi.fn(async () => 'recovered');
    const outcome = await withIdempotency(
      db,
      { collection: 'processed_pubsub', key: 'msg-4' },
      work,
    );

    expect(work).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'stale-retry', result: 'recovered' });
    // The set call must overwrite/refresh the lock (fresh in_progress write).
    expect(setSpy).toHaveBeenCalled();
    expect(store.get('processed_pubsub/msg-4')?.data?.status).toBe('done');
  });
});

describe('withIdempotency — work throws', () => {
  it('leaves doc as in_progress and propagates the exception', async () => {
    const { db, store, updateSpy } = makeFakeFirestore();
    const boom = new Error('processing exploded');
    const work = vi.fn(async () => {
      throw boom;
    });

    await expect(
      withIdempotency(
        db,
        { collection: 'processed_pubsub', key: 'msg-5' },
        work,
      ),
    ).rejects.toBe(boom);

    expect(work).toHaveBeenCalledTimes(1);
    // The doc must remain in 'in_progress' so the staleness window allows
    // retry on the next redelivery.
    expect(store.get('processed_pubsub/msg-5')?.data?.status).toBe('in_progress');
    // Critically: we did NOT update to 'done'.
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('withIdempotency — custom staleAfterMs', () => {
  it('honors a tighter staleness window (1 min)', async () => {
    const { db, store } = makeFakeFirestore();
    const lockedAtMs = Date.now() - 90_000; // 90s ago
    store.set('processed_pubsub/msg-6', {
      data: { status: 'in_progress', lockedAtMs },
    });

    const work = vi.fn(async () => 'tight-recovered');
    const outcome = await withIdempotency(
      db,
      {
        collection: 'processed_pubsub',
        key: 'msg-6',
        staleAfterMs: 60_000, // 1-min staleness window
      },
      work,
    );

    // 90s > 60s → lock is stale → we steal.
    expect(work).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('stale-retry');
  });

  it('treats a fresh lock as in-flight under a relaxed window', async () => {
    const { db, store } = makeFakeFirestore();
    const lockedAtMs = Date.now() - 6 * 60 * 1000; // 6 min
    store.set('processed_pubsub/msg-7', {
      data: { status: 'in_progress', lockedAtMs },
    });

    const work = vi.fn();
    const outcome = await withIdempotency(
      db,
      {
        collection: 'processed_pubsub',
        key: 'msg-7',
        staleAfterMs: 30 * 60 * 1000, // 30-min window
      },
      work,
    );

    expect(work).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'in-flight' });
  });
});

describe('withIdempotency — concurrent simulation', () => {
  it('first caller writes lock; second caller sees in_progress and returns in-flight', async () => {
    const { db, store } = makeFakeFirestore();

    let firstWorkResolve: (() => void) | null = null;
    const firstWorkPromise = new Promise<void>((resolve) => {
      firstWorkResolve = resolve;
    });

    const firstWork = vi.fn(async () => {
      await firstWorkPromise;
      return 'first-done';
    });
    const secondWork = vi.fn(async () => 'second-done');

    // Kick off the first call but don't await it yet — work() is suspended.
    const firstP = withIdempotency(
      db,
      { collection: 'processed_pubsub', key: 'msg-concurrent' },
      firstWork,
    );

    // Yield once so the first call has time to write the in_progress lock.
    await Promise.resolve();
    await Promise.resolve();

    // Second caller arrives while the first is still running.
    const secondP = withIdempotency(
      db,
      { collection: 'processed_pubsub', key: 'msg-concurrent' },
      secondWork,
    );

    const secondOutcome = await secondP;
    expect(secondWork).not.toHaveBeenCalled();
    expect(secondOutcome).toEqual({ kind: 'in-flight' });

    // Now let the first finish.
    firstWorkResolve!();
    const firstOutcome = await firstP;
    expect(firstOutcome.kind).toBe('fresh-success');
    expect(store.get('processed_pubsub/msg-concurrent')?.data?.status).toBe('done');
  });
});

describe('withIdempotency — missing lockedAtMs treated as stale', () => {
  it('proceeds and steals when in_progress doc has no lockedAtMs', async () => {
    const { db, store } = makeFakeFirestore();
    store.set('processed_pubsub/msg-8', {
      data: { status: 'in_progress' /* lockedAtMs missing */ },
    });

    const work = vi.fn(async () => 'salvaged');
    const outcome = await withIdempotency(
      db,
      { collection: 'processed_pubsub', key: 'msg-8' },
      work,
    );

    expect(work).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('stale-retry');
  });
});

describe('withIdempotency — IDEMPOTENCY_DEFAULT_STALE_MS', () => {
  it('exports a 5 minute default', () => {
    expect(IDEMPOTENCY_DEFAULT_STALE_MS).toBe(5 * 60 * 1000);
  });
});

describe('withIdempotency — different collections do not collide', () => {
  it('uses the supplied collection name in the doc path', async () => {
    const { db, getSpy } = makeFakeFirestore();
    const work = vi.fn(async () => 'ok');

    await withIdempotency(
      db,
      { collection: 'processed_webpay', key: 'TKN_XYZ' },
      work,
    );

    expect(getSpy).toHaveBeenCalledWith('processed_webpay/TKN_XYZ');
  });
});
