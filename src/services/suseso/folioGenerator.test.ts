// Praeventio Guard — Sprint 28 Bucket B6.
//
// Tests for the SUSESO folio generator.
//
// Strategy: build an in-memory `MinimalFolioStore` that simulates the
// firebase-admin transaction-retry semantics. We CAN inject artificial
// contention (a counter that "moves" between get and set) to exercise
// the retry path the same way a real concurrent run would.

import { describe, it, expect } from 'vitest';
import {
  formatFolio,
  parseFolio,
  tenantSlug,
  nextFolio,
  type MinimalFolioStore,
} from './folioGenerator';

/**
 * Build an in-memory store that:
 *   - Persists `{ lastSeq }` per path in a Map.
 *   - Optionally injects a "ghost write" mid-transaction the FIRST time
 *     a path is touched, simulating a competing writer.
 */
function buildStore(opts?: { ghostWriteOnFirstRead?: boolean }): {
  store: MinimalFolioStore;
  data: Map<string, { lastSeq: number }>;
  txAttempts: number;
} {
  const data = new Map<string, { lastSeq: number }>();
  let ghostUsed = false;
  const wrapper = {
    txAttempts: 0,
    data,
    store: {
      async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        // Naive "retry once if ghostWriteOnFirstRead is set" semantics.
        // First attempt: read, then a ghost writer bumps the counter
        // before we set, so we discard and retry. Real Firestore does
        // this via OCC; for tests it's enough to retry a single time.
        for (let attempt = 0; attempt < 5; attempt++) {
          wrapper.txAttempts += 1;
          let pendingWrite: { path: string; value: { lastSeq: number } } | null = null;
          let collided = false;
          const tx = {
            async get(path: string) {
              const cur = data.get(path);
              return cur
                ? { exists: true, data: { lastSeq: cur.lastSeq } }
                : { exists: false };
            },
            set(path: string, value: { lastSeq: number }) {
              pendingWrite = { path, value };
            },
          };
          const result = await fn(tx);
          if (opts?.ghostWriteOnFirstRead && !ghostUsed && pendingWrite) {
            ghostUsed = true;
            // Inject a competing write that lands BEFORE our commit.
            // TS narrowing of `pendingWrite` (declared `let`) is lost
            // across the next statement under strictNullChecks; capture
            // in a const to preserve the non-null narrowing.
            const ghostTarget = pendingWrite;
            const cur = data.get(ghostTarget.path)?.lastSeq ?? 0;
            data.set(ghostTarget.path, { lastSeq: cur + 1 });
            collided = true;
          }
          if (!collided && pendingWrite) {
            // pendingWrite is non-null inside this branch (TS narrowing).
            const w = pendingWrite as { path: string; value: { lastSeq: number } };
            data.set(w.path, w.value);
            return result;
          }
        }
        throw new Error('exceeded retry limit');
      },
    },
  };
  return wrapper;
}

describe('formatFolio + parseFolio', () => {
  it('produces the documented shape', () => {
    const f = formatFolio('DIAT', 2026, 'praeventio', 42);
    expect(f).toBe('DIAT-2026-praevent-000042');
  });

  it('round-trips through parseFolio', () => {
    const original = formatFolio('DIEP', 2027, 'tenant_xyz_more_chars', 9);
    const parsed = parseFolio(original);
    expect(parsed).toEqual({
      kind: 'DIEP',
      year: 2027,
      tenantSlug: 'tenantxy',
      seq: 9,
    });
  });

  it('rejects malformed folios', () => {
    expect(parseFolio('not-a-folio')).toBeNull();
    expect(parseFolio('XXXX-2026-praevent-000001')).toBeNull();
    expect(parseFolio('DIAT-2026-PRAEVENT-000001')).toBeNull(); // upper-case slug
    expect(parseFolio('DIAT-2026-praevent-42')).toBeNull(); // unpadded seq
  });

  it('pads short tenantIds to 8 chars', () => {
    expect(tenantSlug('abc')).toBe('abc00000');
    expect(tenantSlug('')).toBe('00000000');
    expect(tenantSlug('Praevent-1!')).toBe('praevent');
  });
});

describe('nextFolio (sequential)', () => {
  it('starts at 1 for an unknown tenant/year/kind', async () => {
    const { store } = buildStore();
    const folio = await nextFolio(store, 'praeventio', 'DIAT', 2026);
    expect(folio).toBe('DIAT-2026-praevent-000001');
  });

  it('increments monotonically across calls in the same year', async () => {
    const { store } = buildStore();
    const f1 = await nextFolio(store, 'praeventio', 'DIAT', 2026);
    const f2 = await nextFolio(store, 'praeventio', 'DIAT', 2026);
    const f3 = await nextFolio(store, 'praeventio', 'DIAT', 2026);
    expect([f1, f2, f3]).toEqual([
      'DIAT-2026-praevent-000001',
      'DIAT-2026-praevent-000002',
      'DIAT-2026-praevent-000003',
    ]);
  });

  it('keeps DIAT and DIEP counters independent', async () => {
    const { store } = buildStore();
    const a = await nextFolio(store, 'praeventio', 'DIAT', 2026);
    const b = await nextFolio(store, 'praeventio', 'DIEP', 2026);
    const c = await nextFolio(store, 'praeventio', 'DIEP', 2026);
    expect(a).toBe('DIAT-2026-praevent-000001');
    expect(b).toBe('DIEP-2026-praevent-000001');
    expect(c).toBe('DIEP-2026-praevent-000002');
  });

  it('keeps counters independent across years', async () => {
    const { store } = buildStore();
    const a = await nextFolio(store, 'praeventio', 'DIAT', 2026);
    const b = await nextFolio(store, 'praeventio', 'DIAT', 2027);
    expect(a).toBe('DIAT-2026-praevent-000001');
    expect(b).toBe('DIAT-2027-praevent-000001');
  });

  it('keeps counters independent across tenants', async () => {
    const { store } = buildStore();
    const a = await nextFolio(store, 'praeventio', 'DIAT', 2026);
    const b = await nextFolio(store, 'acme_corp', 'DIAT', 2026);
    expect(a).toBe('DIAT-2026-praevent-000001');
    expect(b).toBe('DIAT-2026-acmecorp-000001');
  });
});

describe('nextFolio (concurrency)', () => {
  it('retries on contention and never collides', async () => {
    const { store, txAttempts: _ } = buildStore({ ghostWriteOnFirstRead: true });
    const folio = await nextFolio(store, 'praeventio', 'DIAT', 2026);
    // Ghost writer bumped to 1 before our write would have committed,
    // so our retry reads 1 and writes 2 → seq 2 is what we get.
    expect(folio).toBe('DIAT-2026-praevent-000002');
  });

  it('never produces duplicate folios under sequential awaits (regression for OCC)', async () => {
    const { store } = buildStore();
    const folios = new Set<string>();
    for (let i = 0; i < 20; i++) {
      folios.add(await nextFolio(store, 'praeventio', 'DIAT', 2026));
    }
    expect(folios.size).toBe(20);
  });

  it('produces a contiguous sequence with no gaps', async () => {
    const { store } = buildStore();
    const seqs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const f = await nextFolio(store, 'praeventio', 'DIEP', 2026);
      seqs.push(Number(f.split('-').pop()));
    }
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });
});
