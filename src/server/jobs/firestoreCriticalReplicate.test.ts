// SPDX-License-Identifier: MIT
//
// Bucket W.6 — Tests for `replicateCriticalData`.
//
// We mock Firestore with a collection→where→get fake and the uploader with a
// vi.fn so we can observe path + payload shape without touching real GCS or
// firebase-admin. Five scenarios:
//   1. No docs in the last hour → zero uploads.
//   2. Docs present → JSONL payload at the correct path.
//   3. Multiple collections → independent uploads, stable order.
//   4. Error in one collection → other collections still run.
//   5. Windowing is REAL: the fake honours the (field, op, value) of the
//      production query, so a wrong timestamp field or a non-Timestamp window
//      value drops the docs. This is what makes the DR replica actually carry
//      data (Phase 5 fix) — the previous fake ignored the query entirely, which
//      let `where('createdAt', '>=', <epoch-ms number>)` ship an empty replica
//      while every test stayed green (audit_logs uses `timestamp`, not
//      `createdAt`, and both fields are Firestore Timestamps, not numbers).

import { describe, it, expect, vi } from 'vitest';
import {
  replicateCriticalData,
  CRITICAL_COLLECTIONS,
} from './firestoreCriticalReplicate';

interface FakeDoc {
  id: string;
  data: Record<string, unknown>;
}

/** Coerce a stored field / query value to epoch ms, or null if not a temporal. */
function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/**
 * Fake Firestore that ACTUALLY applies the windowing predicate, so the
 * production query is under test (not bypassed). A doc is returned only when
 * its `field` value is temporal AND `>= value`. A non-temporal window value
 * (e.g. a raw epoch-ms number) matches nothing — mirroring Firestore, where a
 * Timestamp field cannot be windowed by a plain number.
 */
function makeFakeDb(byCollection: Record<string, FakeDoc[]>, opts: { throwOn?: string } = {}) {
  return {
    collection(name: string) {
      if (opts.throwOn === name) {
        return {
          where() {
            return this;
          },
          get: async () => {
            throw new Error(`boom: ${name}`);
          },
        };
      }
      const docs = byCollection[name] ?? [];
      let field = '';
      let op = '';
      let value: unknown;
      const q = {
        where(f: string, o: string, v: unknown) {
          field = f;
          op = o;
          value = v;
          return q;
        },
        get: async () => {
          const valueMs = toMs(value);
          const matched =
            op === '>=' && valueMs !== null
              ? docs.filter((d) => {
                  const fvMs = toMs(d.data[field]);
                  return fvMs !== null && fvMs >= valueMs;
                })
              : [];
          return {
            empty: matched.length === 0,
            docs: matched.map((d) => ({ id: d.id, data: () => d.data })),
          };
        },
      };
      return q;
    },
  };
}

const NOW = Date.UTC(2026, 4, 4, 12, 0, 0); // 2026-05-04T12:00:00Z
const HOUR_SLUG = '2026-05-04T12';
const inWindow = (msAgo: number) => new Date(NOW - msAgo);
const outOfWindow = new Date(NOW - 3_600_000 - 60_000); // 1h + 1min ago

describe('replicateCriticalData', () => {
  it('does not upload when no docs match the last-hour window', async () => {
    const db = makeFakeDb({ audit_logs: [], invoices: [] });
    const upload = vi.fn();

    const result = await replicateCriticalData({
      getDb: () => db as any,
      uploadToStorage: upload,
      now: () => NOW,
    });

    expect(upload).not.toHaveBeenCalled();
    expect(result.collections).toEqual([
      { collection: 'audit_logs', docs: 0, path: null },
      { collection: 'invoices', docs: 0, path: null },
    ]);
    expect(result.windowEnd - result.windowStart).toBe(3_600_000);
  });

  it('writes JSONL with id+data at <collection>/<hour>.jsonl when docs exist', async () => {
    const db = makeFakeDb({
      // audit_logs window on the `timestamp` field (Firestore Timestamp).
      audit_logs: [
        { id: 'a1', data: { actor: 'u1', action: 'login', timestamp: inWindow(100) } },
        { id: 'a2', data: { actor: 'u2', action: 'logout', timestamp: inWindow(200) } },
      ],
      invoices: [],
    });
    const upload = vi.fn().mockResolvedValue(undefined);

    const result = await replicateCriticalData({
      getDb: () => db as any,
      uploadToStorage: upload,
      now: () => NOW,
      bucket: 'test-bucket',
    });

    // Only audit_logs should have uploaded; invoices was empty.
    expect(upload).toHaveBeenCalledTimes(1);
    const [bucket, path, payload] = upload.mock.calls[0]!;
    expect(bucket).toBe('test-bucket');
    expect(path).toBe(`audit_logs/${HOUR_SLUG}.jsonl`);

    const lines = (payload as string).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ id: 'a1', actor: 'u1', action: 'login' });
    expect(JSON.parse(lines[1]!)).toMatchObject({ id: 'a2', actor: 'u2', action: 'logout' });

    expect(result.collections[0]).toEqual({
      collection: 'audit_logs',
      docs: 2,
      path: `audit_logs/${HOUR_SLUG}.jsonl`,
    });
  });

  it('replicates each critical collection independently in stable order', async () => {
    const db = makeFakeDb({
      audit_logs: [{ id: 'a1', data: { actor: 'u1', timestamp: inWindow(10) } }],
      invoices: [
        { id: 'i1', data: { amount: 100, createdAt: inWindow(20) } },
        { id: 'i2', data: { amount: 200, createdAt: inWindow(30) } },
      ],
    });
    const upload = vi.fn().mockResolvedValue(undefined);

    const result = await replicateCriticalData({
      getDb: () => db as any,
      uploadToStorage: upload,
      now: () => NOW,
      bucket: 'test-bucket',
    });

    expect(upload).toHaveBeenCalledTimes(2);
    // Stable order: audit_logs first, invoices second (matches CRITICAL_COLLECTIONS).
    expect(upload.mock.calls[0]![1]).toBe(`audit_logs/${HOUR_SLUG}.jsonl`);
    expect(upload.mock.calls[1]![1]).toBe(`invoices/${HOUR_SLUG}.jsonl`);

    expect(result.collections.map((c) => c.collection)).toEqual([
      'audit_logs',
      'invoices',
    ]);
    expect(result.collections[0]?.docs).toBe(1);
    expect(result.collections[1]?.docs).toBe(2);

    // Sanity: the export catalog matches the runtime constant.
    expect([...CRITICAL_COLLECTIONS]).toEqual(['audit_logs', 'invoices']);
  });

  it('continues with the next collection when one fails', async () => {
    const db = makeFakeDb(
      {
        // audit_logs will throw via throwOn; invoices must still upload.
        invoices: [{ id: 'i1', data: { amount: 50, createdAt: inWindow(15) } }],
      },
      { throwOn: 'audit_logs' },
    );
    const upload = vi.fn().mockResolvedValue(undefined);

    const result = await replicateCriticalData({
      getDb: () => db as any,
      uploadToStorage: upload,
      now: () => NOW,
      bucket: 'test-bucket',
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![1]).toBe(`invoices/${HOUR_SLUG}.jsonl`);

    expect(result.collections[0]?.collection).toBe('audit_logs');
    expect(result.collections[0]?.error).toMatch(/boom: audit_logs/);
    expect(result.collections[0]?.path).toBeNull();
    expect(result.collections[1]).toEqual({
      collection: 'invoices',
      docs: 1,
      path: `invoices/${HOUR_SLUG}.jsonl`,
    });
  });

  it('windows on the correct per-collection Timestamp field and drops out-of-window docs', async () => {
    // audit_logs is keyed on `timestamp`; invoices on `createdAt`. Each has one
    // doc inside the last hour and one older than it. The old impl
    // (`where('createdAt', '>=', <number>)`) finds NOTHING here: audit_logs has
    // no `createdAt`, and the raw-number value can't window a Timestamp field.
    const db = makeFakeDb({
      audit_logs: [
        { id: 'fresh', data: { actor: 'u1', timestamp: inWindow(5_000) } },
        { id: 'stale', data: { actor: 'u1', timestamp: outOfWindow } },
      ],
      invoices: [
        { id: 'fresh-inv', data: { amount: 9, createdAt: inWindow(5_000) } },
        { id: 'stale-inv', data: { amount: 9, createdAt: outOfWindow } },
      ],
    });
    const upload = vi.fn().mockResolvedValue(undefined);

    const result = await replicateCriticalData({
      getDb: () => db as any,
      uploadToStorage: upload,
      now: () => NOW,
      bucket: 'test-bucket',
    });

    // Exactly the in-window doc from each collection is replicated.
    expect(result.collections[0]).toMatchObject({ collection: 'audit_logs', docs: 1 });
    expect(result.collections[1]).toMatchObject({ collection: 'invoices', docs: 1 });

    const auditPayload = upload.mock.calls.find((c) => String(c[1]).startsWith('audit_logs/'))![2];
    const invoicePayload = upload.mock.calls.find((c) => String(c[1]).startsWith('invoices/'))![2];
    expect(JSON.parse(String(auditPayload))).toMatchObject({ id: 'fresh' });
    expect(JSON.parse(String(invoicePayload))).toMatchObject({ id: 'fresh-inv' });
  });
});
