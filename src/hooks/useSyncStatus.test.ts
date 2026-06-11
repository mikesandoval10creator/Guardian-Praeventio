// @vitest-environment jsdom
//
// B16 wire (2026-06) — useSyncQueueStatus must read the REAL offline queue
// (OfflineSyncStateMachine, src/services/sync/syncStateMachine.ts — the
// central queue OfflineSyncManager drains) and derive the visible summary +
// badge via the PURE engine (syncQueueTracker), entirely on-device: the
// badge exists precisely for when the worker is OFFLINE, so no HTTP hop is
// allowed in the derivation path. The 5 HTTP wrappers in useSyncStatus.ts
// remain for server-verified flows; the hook does NOT use them.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const memStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => memStore.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    memStore.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    memStore.delete(key);
  }),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { OfflineSyncStateMachine } = await import('../services/sync/syncStateMachine');
const { useSyncQueueStatus } = await import('./useSyncStatus');

const QUEUE_KEY = 'guardian_offline_sync_v1';

beforeEach(() => {
  memStore.clear();
});

describe('useSyncQueueStatus — real offline queue → visible badge (B16)', () => {
  it('empty queue → green badge, 0 items', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => true);
    await sm.ready();

    const { result } = renderHook(() => useSyncQueueStatus(sm));
    expect(result.current.summary.totalItems).toBe(0);
    expect(result.current.badge.color).toBe('green');
    sm._dispose();
  });

  it('ops enqueued offline surface as pending (amber badge, saved_local)', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => false);
    await sm.ready();

    const { result } = renderHook(() => useSyncQueueStatus(sm));
    await act(async () => {
      await sm.enqueue({ type: 'create', collection: 'incidents', data: { id: 'i1' } });
      await sm.enqueue({ type: 'update', collection: 'checklists', data: { id: 'c1' } });
    });

    await waitFor(() => {
      expect(result.current.summary.totalItems).toBe(2);
    });
    expect(result.current.summary.byStatus.saved_local).toBe(2);
    expect(result.current.badge.color).toBe('amber');
    expect(result.current.badge.count).toBe(2);
    sm._dispose();
  });

  it('dead-lettered ops surface as sync_failed (red badge + failedItems)', async () => {
    // Hydrate a machine whose persisted queue already holds a dead-letter —
    // exactly what a worker sees after an op exhausted MAX_ATTEMPTS.
    memStore.set(QUEUE_KEY, [
      {
        id: 'op-dead',
        type: 'create',
        collection: 'incidents',
        data: { id: 'i9' },
        attempts: 6,
        createdAt: Date.now(),
        lastError: 'permission-denied',
        deadLettered: true,
      },
    ]);
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => true);
    await sm.ready();

    const { result } = renderHook(() => useSyncQueueStatus(sm));
    await waitFor(() => {
      expect(result.current.summary.byStatus.sync_failed).toBe(1);
    });
    expect(result.current.badge.color).toBe('red');
    expect(result.current.summary.failedItems).toHaveLength(1);
    expect(result.current.summary.failedItems[0].collection).toBe('incidents');
    sm._dispose();
  });

  it('retry() drives the REAL machine (syncNow drains via executor)', async () => {
    const sm = new OfflineSyncStateMachine();
    let online = false;
    sm.setOnlineGetter(() => online);
    const executor = vi.fn(async () => {});
    sm.setExecutor(executor);
    await sm.ready();
    await sm.enqueue({ type: 'create', collection: 'incidents', data: { id: 'i1' } });

    const { result } = renderHook(() => useSyncQueueStatus(sm));
    await waitFor(() => {
      expect(result.current.summary.totalItems).toBe(1);
    });

    online = true;
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(executor).toHaveBeenCalledTimes(1);
      expect(result.current.summary.totalItems).toBe(0);
      expect(result.current.badge.color).toBe('green');
    });
    sm._dispose();
  });
});
