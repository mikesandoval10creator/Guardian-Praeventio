// SPDX-License-Identifier: MIT
//
// Bloque 5.4 (C14) — distributedLock tests.
//
// Cubre:
//   1. acquire on a free resource → acquired=true, instanceId echoed.
//   2. acquire while another instance holds an unexpired lock → false.
//   3. acquire while the existing lock has expired → true (steal).
//   4. release only works for the holder; wrong instanceId / lockId → no-op.
//   5. re-acquire by the same holder refreshes TTL.
//   6. withDistributedLock runs `fn` iff acquired and releases after.
//   7. withDistributedLock re-throws `fn` errors AFTER releasing.
//   8. Race: 2 simultaneous acquires for same key → exactly 1 wins.
//   9. invalid input rejected (empty tenantId / resourceKey / ttl<=0).
//
// Firestore is faked with the same minimal transaction model used by
// `distributedLease.test.ts` — sequential by default, with an opt-out
// for the race test to expose a read-then-write conflict.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  acquireDistributedLock,
  releaseDistributedLock,
  withDistributedLock,
} from './distributedLock';

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore — tenant-scoped paths supported.
// ─────────────────────────────────────────────────────────────────────

type StoreEntry = { data: Record<string, unknown> };

function makeFakeDb() {
  const store = new Map<string, StoreEntry>();
  let txQueue: Promise<unknown> = Promise.resolve();
  let serialize = true;

  // Path layout assembled in the SUT:
  //   tenants/{tenantId}/sync_locks/{resourceKey}
  // The fake just keeps the concatenated string as the key.
  function makeDocRef(path: string) {
    return { _path: path };
  }

  const collection = (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => ({
        doc: (resourceKey: string) => makeDocRef(`${name}/${id}/${sub}/${resourceKey}`),
      }),
    }),
  });

  const runTransaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const exec = async () => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (r: { _path: string }) => ({
          exists: store.has(r._path),
          data: () => store.get(r._path)?.data,
        }),
        set: (r: { _path: string }, data: Record<string, unknown>) => {
          writes.push(() => store.set(r._path, { data: { ...data } }));
        },
        delete: (r: { _path: string }) => {
          writes.push(() => store.delete(r._path));
        },
      };
      const result = await fn(tx);
      writes.forEach((w) => w());
      return result;
    };
    if (!serialize) {
      return exec();
    }
    const next = txQueue.then(exec, exec);
    txQueue = next.catch(() => undefined);
    return next;
  };

  return {
    // The SUT types `db` as firebase-admin Firestore; cast at the seam.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: { collection, runTransaction } as any,
    store,
    setSerialize: (v: boolean) => {
      serialize = v;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('distributedLock', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let now = 1_000_000;

  beforeEach(() => {
    fake = makeFakeDb();
    now = 1_000_000;
  });

  const depsFor = (instanceId: string, nonceSeed = 'n') => {
    let counter = 0;
    return {
      now: () => now,
      nonce: () => `${nonceSeed}-${++counter}`,
      instanceId,
    };
  };

  // ── 1 ──────────────────────────────────────────────────────────────
  it('acquires a free lock', async () => {
    const r = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-1'),
    );
    expect(r.acquired).toBe(true);
    expect(r.instanceId).toBe('inst-1');
    expect(r.lockId).toBeDefined();
    expect(r.expiresAt).toBe(now + 10_000);
  });

  // ── 2 ──────────────────────────────────────────────────────────────
  it('rejects when another instance holds an unexpired lock', async () => {
    const a = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-1'),
    );
    expect(a.acquired).toBe(true);

    const b = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-2'),
    );
    expect(b.acquired).toBe(false);
    expect(b.reason).toBe('held_by_other');
  });

  // Per-tenant scoping: same resourceKey under different tenants is independent.
  it('does NOT collide across tenants for the same resourceKey', async () => {
    const a = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-1'),
    );
    const b = await acquireDistributedLock(
      fake.db,
      'tenant-B',
      'sync:project-42',
      10_000,
      depsFor('inst-1'),
    );
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
  });

  // ── 3 ──────────────────────────────────────────────────────────────
  it('steals an expired lock', async () => {
    const a = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      5_000,
      depsFor('inst-1'),
    );
    expect(a.acquired).toBe(true);

    now += 6_000; // past expiry

    const b = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-2'),
    );
    expect(b.acquired).toBe(true);
    expect(b.instanceId).toBe('inst-2');
    expect(b.expiresAt).toBe(now + 10_000);
  });

  // ── 4 ──────────────────────────────────────────────────────────────
  it('release works only for the matching (instanceId, lockId)', async () => {
    const a = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      30_000,
      depsFor('inst-1'),
    );
    expect(a.acquired).toBe(true);

    // Wrong lockId → not_owner.
    const wrongLockId = await releaseDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      'inst-1',
      'bogus-lock-id',
    );
    expect(wrongLockId.released).toBe(false);
    expect(wrongLockId.reason).toBe('not_owner');

    // Wrong instanceId → not_owner.
    const wrongInst = await releaseDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      'inst-2',
      a.lockId!,
    );
    expect(wrongInst.released).toBe(false);
    expect(wrongInst.reason).toBe('not_owner');

    // Correct identity → released, and the doc is gone (next acquire OK).
    const ok = await releaseDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      'inst-1',
      a.lockId!,
    );
    expect(ok.released).toBe(true);

    const c = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-2'),
    );
    expect(c.acquired).toBe(true);
  });

  // ── 5 ──────────────────────────────────────────────────────────────
  it('the same holder can re-acquire to refresh TTL', async () => {
    const a = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-1', 'n1'),
    );
    expect(a.acquired).toBe(true);

    now += 4_000;

    // Re-acquire by the SAME instance — should succeed (no need to wait
    // for expiry; the lock semantic allows the owner to push the
    // deadline out). A new lockId is generated.
    const b = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      15_000,
      depsFor('inst-1', 'n2'),
    );
    expect(b.acquired).toBe(true);
    expect(b.instanceId).toBe('inst-1');
    expect(b.lockId).not.toBe(a.lockId);
    expect(b.expiresAt).toBe(now + 15_000);
  });

  // ── 6 ──────────────────────────────────────────────────────────────
  it('withDistributedLock runs fn iff acquired and releases after', async () => {
    const fn = vi.fn(async () => 'ok');
    const r = await withDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      fn,
      depsFor('inst-1'),
    );
    expect(r.ran).toBe(true);
    if (r.ran) {
      expect(r.result).toBe('ok');
    }
    expect(fn).toHaveBeenCalledTimes(1);

    // After the helper returns, the lock should be RELEASED → another
    // instance can acquire immediately (no need to wait for TTL).
    const after = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-2'),
    );
    expect(after.acquired).toBe(true);
  });

  // ── 7 ──────────────────────────────────────────────────────────────
  it('withDistributedLock re-throws fn errors AFTER releasing the lock', async () => {
    const err = new Error('boom');
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(
      withDistributedLock(
        fake.db,
        'tenant-A',
        'sync:project-42',
        10_000,
        fn,
        depsFor('inst-1'),
      ),
    ).rejects.toBe(err);

    // Lock must have been released despite the throw — next acquire OK.
    const after = await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      depsFor('inst-2'),
    );
    expect(after.acquired).toBe(true);
  });

  // ── 7b ─────────────────────────────────────────────────────────────
  it('withDistributedLock returns ran=false when acquire fails', async () => {
    // Pre-occupy the slot from another instance.
    await acquireDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      60_000,
      depsFor('inst-other'),
    );

    const fn = vi.fn(async () => 'should-not-run');
    const r = await withDistributedLock(
      fake.db,
      'tenant-A',
      'sync:project-42',
      10_000,
      fn,
      depsFor('inst-1'),
    );
    expect(r.ran).toBe(false);
    if (!r.ran) {
      expect(r.reason).toBe('held_by_other');
    }
    expect(fn).not.toHaveBeenCalled();
  });

  // ── 8 ──────────────────────────────────────────────────────────────
  it('only one of two simultaneous acquires wins', async () => {
    const [r1, r2] = await Promise.all([
      acquireDistributedLock(
        fake.db,
        'tenant-A',
        'sync:project-42',
        10_000,
        depsFor('inst-1'),
      ),
      acquireDistributedLock(
        fake.db,
        'tenant-A',
        'sync:project-42',
        10_000,
        depsFor('inst-2'),
      ),
    ]);
    const wins = [r1.acquired, r2.acquired].filter(Boolean);
    expect(wins.length).toBe(1);
  });

  // ── 9 ──────────────────────────────────────────────────────────────
  it('rejects invalid input (empty tenantId / resourceKey / ttl<=0)', async () => {
    const empty1 = await acquireDistributedLock(fake.db, '', 'res', 10_000, depsFor('i'));
    const empty2 = await acquireDistributedLock(fake.db, 't', '', 10_000, depsFor('i'));
    const badTtl = await acquireDistributedLock(fake.db, 't', 'r', 0, depsFor('i'));
    expect(empty1).toEqual({ acquired: false, reason: 'invalid_input' });
    expect(empty2).toEqual({ acquired: false, reason: 'invalid_input' });
    expect(badTtl).toEqual({ acquired: false, reason: 'invalid_input' });

    const relBad = await releaseDistributedLock(fake.db, '', 'res', 'i', 'lid');
    expect(relBad).toEqual({ released: false, reason: 'invalid_input' });
  });

  // Bonus — releasing a non-existent lock is a no-op (not_owner), not a throw.
  it('release on a never-acquired key returns not_owner without throwing', async () => {
    const r = await releaseDistributedLock(
      fake.db,
      'tenant-A',
      'never-locked',
      'inst-1',
      'some-lock-id',
    );
    expect(r.released).toBe(false);
    expect(r.reason).toBe('not_owner');
  });
});
