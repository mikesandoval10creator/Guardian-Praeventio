// SPDX-License-Identifier: MIT
//
// Bucket W.6 — Tests for `replicateCriticalData`.
//
// We mock Firestore with a minimal collection→where→get fake and the
// uploader with a vi.fn so we can observe path + payload shape without
// touching real GCS or firebase-admin. Four canonical scenarios match
// the W.6 spec exactly:
//   1. No docs in the last hour → zero uploads.
//   2. Docs present → JSONL payload at the correct path.
//   3. Multiple collections → independent uploads, stable order.
//   4. Error in one collection → other collections still run.

import { describe, it, expect, vi } from 'vitest';
import {
  replicateCriticalData,
  CRITICAL_COLLECTIONS,
} from './firestoreCriticalReplicate';

interface FakeDoc {
  id: string;
  data: Record<string, unknown>;
}

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
      return {
        where(_field: string, _op: string, _value: unknown) {
          // The fake assumes the test data has already been windowed —
          // we don't simulate `createdAt >= oneHourAgo` here because the
          // production query is the contract under test, not Firestore
          // itself.
          return this;
        },
        get: async () => ({
          empty: docs.length === 0,
          docs: docs.map((d) => ({
            id: d.id,
            data: () => d.data,
          })),
        }),
      };
    },
  };
}

const NOW = Date.UTC(2026, 4, 4, 12, 0, 0); // 2026-05-04T12:00:00Z
const HOUR_SLUG = '2026-05-04T12';

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
      audit_logs: [
        { id: 'a1', data: { actor: 'u1', action: 'login', createdAt: NOW - 100 } },
        { id: 'a2', data: { actor: 'u2', action: 'logout', createdAt: NOW - 200 } },
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
    expect(JSON.parse(lines[0]!)).toEqual({
      id: 'a1',
      actor: 'u1',
      action: 'login',
      createdAt: NOW - 100,
    });
    expect(JSON.parse(lines[1]!)).toEqual({
      id: 'a2',
      actor: 'u2',
      action: 'logout',
      createdAt: NOW - 200,
    });

    expect(result.collections[0]).toEqual({
      collection: 'audit_logs',
      docs: 2,
      path: `audit_logs/${HOUR_SLUG}.jsonl`,
    });
  });

  it('replicates each critical collection independently in stable order', async () => {
    const db = makeFakeDb({
      audit_logs: [{ id: 'a1', data: { actor: 'u1' } }],
      invoices: [
        { id: 'i1', data: { amount: 100 } },
        { id: 'i2', data: { amount: 200 } },
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
        invoices: [{ id: 'i1', data: { amount: 50 } }],
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
});
