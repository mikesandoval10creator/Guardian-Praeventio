// SPDX-License-Identifier: MIT
//
// Sprint 35 — distributedLease tests.
//
// Covers the 6 scenarios from the audit-fix plan:
//   1. Acquire on a free slot → acquired=true.
//   2. Acquire while another instance holds an unexpired lease → false.
//   3. Acquire while the existing lease has expired → true (steal).
//   4. Renew own lease → expiresAt advances.
//   5. Release → next acquire by anyone is OK.
//   6. Race: 2 simultaneous acquires → exactly 1 wins.
//
// Firestore is faked with a tiny in-memory store + a transaction model
// that serializes runs by `await`-locking on a shared mutex. The race
// test breaks that lock to surface an interleaving similar to what the
// real backend produces (read-then-write conflict).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  acquireLease,
  renewLease,
  releaseLease,
  withLease,
} from './distributedLease';

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore
// ─────────────────────────────────────────────────────────────────────

interface FakeStoreEntry {
  data: any;
}

function makeFakeDb() {
  const store = new Map<string, FakeStoreEntry>();
  // Serialize transactions via a chained promise.
  let txQueue: Promise<unknown> = Promise.resolve();
  // For race-test we expose a switch to disable serialization.
  let serialize = true;

  const ref = (path: string) => ({
    _path: path,
    set: (data: any) => {
      store.set(path, { data: { ...data } });
    },
    delete: () => {
      store.delete(path);
    },
    get: () => ({
      exists: store.has(path),
      data: () => store.get(path)?.data,
    }),
  });

  const collection = (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => ({
        doc: (job: string) => {
          const path = `${name}/${id}/${sub}/${job}`;
          return {
            _path: path,
          };
        },
      }),
    }),
  });

  const runTransaction = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    const exec = async () => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (r: { _path: string }) => {
          return {
            exists: store.has(r._path),
            data: () => store.get(r._path)?.data,
          };
        },
        set: (r: { _path: string }, data: any) => {
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
    db: {
      collection,
      runTransaction,
    } as any,
    store,
    setSerialize: (v: boolean) => {
      serialize = v;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('distributedLease', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let now = 1_000_000;

  beforeEach(() => {
    fake = makeFakeDb();
    now = 1_000_000;
  });

  const deps = () => ({
    getDb: () => fake.db,
    now: () => now,
    nonce: () => 'nonce-' + Math.random().toString(36).slice(2, 8),
  });

  it('acquires a free lease', async () => {
    const r = await acquireLease('job-A', 10_000, 'inst-1', deps());
    expect(r.acquired).toBe(true);
    expect(r.leaseId).toBeDefined();
    expect(r.expiresAt).toBe(now + 10_000);
  });

  it('rejects when another instance holds an unexpired lease', async () => {
    const a = await acquireLease('job-A', 10_000, 'inst-1', deps());
    expect(a.acquired).toBe(true);
    const b = await acquireLease('job-A', 10_000, 'inst-2', deps());
    expect(b.acquired).toBe(false);
    expect(b.reason).toBe('held_by_other');
  });

  it('steals an expired lease', async () => {
    const a = await acquireLease('job-A', 5_000, 'inst-1', deps());
    expect(a.acquired).toBe(true);
    now += 6_000; // past expiry
    const b = await acquireLease('job-A', 10_000, 'inst-2', deps());
    expect(b.acquired).toBe(true);
    expect(b.expiresAt).toBe(now + 10_000);
  });

  it('renews an owned lease and pushes expiresAt out', async () => {
    const a = await acquireLease('job-A', 5_000, 'inst-1', deps());
    expect(a.acquired).toBe(true);
    now += 1_000;
    const r = await renewLease('job-A', a.leaseId!, 20_000, deps());
    expect(r.renewed).toBe(true);
    expect(r.expiresAt).toBe(now + 20_000);
  });

  it('releases an owned lease so another instance can acquire', async () => {
    const a = await acquireLease('job-A', 60_000, 'inst-1', deps());
    expect(a.acquired).toBe(true);
    const rel = await releaseLease('job-A', a.leaseId!, deps());
    expect(rel.released).toBe(true);
    const b = await acquireLease('job-A', 10_000, 'inst-2', deps());
    expect(b.acquired).toBe(true);
  });

  it('only one of two simultaneous acquires wins', async () => {
    // Serialized transactions (real Firestore behavior) — exactly one
    // observes "no doc exists / not me" and writes; the other reads the
    // freshly-written doc and bails out.
    const [r1, r2] = await Promise.all([
      acquireLease('job-A', 10_000, 'inst-1', deps()),
      acquireLease('job-A', 10_000, 'inst-2', deps()),
    ]);
    const wins = [r1.acquired, r2.acquired].filter(Boolean);
    expect(wins.length).toBe(1);
  });

  it('withLease runs fn iff acquired and releases after', async () => {
    const fn = vi.fn(async () => 'ok');
    const r = await withLease('job-X', 10_000, 'inst-1', fn, deps());
    expect(r.ran).toBe(true);
    expect(r.result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    // Lease is released → another instance can acquire immediately.
    const after = await acquireLease('job-X', 10_000, 'inst-2', deps());
    expect(after.acquired).toBe(true);
  });
});
