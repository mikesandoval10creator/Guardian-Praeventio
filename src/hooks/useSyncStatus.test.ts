// @vitest-environment jsdom
//
// B16 wire (2026-06) — useSyncQueueStatus must read the REAL offline queue
// (OfflineSyncStateMachine, src/services/sync/syncStateMachine.ts — the
// central queue OfflineSyncManager drains) and derive the visible summary +
// badge via the PURE engine (syncQueueTracker), entirely on-device: the
// badge exists precisely for when the worker is OFFLINE, so no HTTP hop is
// allowed in the derivation path. The 5 HTTP wrappers in useSyncStatus.ts
// remain for server-verified flows; the hook does NOT use them.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type {
  LegacyQuarantineRecord,
  SyncOperation,
  SyncQueuePersistence,
} from '../services/sync/syncStateMachine';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { OfflineSyncStateMachine } = await import('../services/sync/syncStateMachine');
const { useSyncQueueStatus } = await import('./useSyncStatus');

const TEST_IDENTITY = {
  ownerUid: 'u1',
  tenantId: 'tenant-1',
  installationId: 'installation-1',
  schemaVersion: 2 as const,
};

function createPersistence(initial: SyncOperation[] = []): SyncQueuePersistence {
  let operations = [...initial];
  let quarantine: LegacyQuarantineRecord[] = [];
  let lastSuccessMs: number | null = null;
  return {
    loadOperations: async () => operations,
    saveOperations: async (next) => { operations = [...next]; },
    loadQuarantine: async () => quarantine,
    saveQuarantine: async (next) => { quarantine = [...next]; },
    loadLastSuccessMs: async () => lastSuccessMs,
    saveLastSuccessMs: async (value) => { lastSuccessMs = value; },
    loadLegacyOperations: async () => null,
    deleteLegacyOperations: async () => undefined,
    clearAll: async () => { operations = []; quarantine = []; lastSuccessMs = null; },
  };
}

function createMachine(initial: SyncOperation[] = []) {
  return new OfflineSyncStateMachine({
    identityResolver: async () => TEST_IDENTITY,
    persistence: createPersistence(initial),
  });
}

describe('useSyncQueueStatus — real offline queue → visible badge (B16)', () => {
  it('empty queue → green badge, 0 items', async () => {
    const sm = createMachine();
    sm.setOnlineGetter(() => true);
    await sm.ready();

    const { result } = renderHook(() => useSyncQueueStatus(sm));
    expect(result.current.summary.totalItems).toBe(0);
    expect(result.current.badge.color).toBe('green');
    sm._dispose();
  });

  it('ops enqueued offline surface as pending (amber badge, saved_local)', async () => {
    const sm = createMachine();
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
    const sm = createMachine([{
      ...TEST_IDENTITY,
      id: 'op-dead',
      type: 'create',
      collection: 'incidents',
      data: { id: 'i9' },
      queueClass: 'generic',
      attempts: 6,
      createdAt: Date.now(),
      lastError: 'permission-denied',
      deadLettered: true,
      deadLetterReason: 'max_attempts',
    }]);
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
    const sm = createMachine();
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
