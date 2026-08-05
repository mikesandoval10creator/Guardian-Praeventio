// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// [P0][datos] Offline DELETEs must route through the conflict engine. Before
// this fix the executor called deleteDoc() blindly: a doc edited server-side
// while we were offline was silently destroyed (destructive evidence loss for
// safety-critical collections). Now the delete reads the remote doc first and
// diverts to the human-resolution flow (sync-critical-conflict event, no
// delete) whenever the remote doc exists and requires manual resolution.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const deleteDocCalls: string[] = [];
const dispatched: unknown[] = [];

const pendingActions: unknown[] = [];

vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

vi.mock('../utils/pwa-offline', () => ({
  getPendingActions: vi.fn(async () => pendingActions),
  removeSyncedAction: vi.fn(async () => undefined),
  syncWithFirebase: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({
  db: {},
  storage: {},
  handleFirestoreError: (err: unknown) => {
    throw err;
  },
  OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
}));

/** Remote doc state controlled per-test. */
const remoteDoc: { exists: boolean; data: Record<string, unknown> | null } = {
  exists: false,
  data: null,
};

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collectionName: string, id: string) => ({
    path: `${collectionName}/${id}`,
  }),
  setDoc: vi.fn(async () => undefined),
  updateDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async (ref: { path: string }) => {
    deleteDocCalls.push(ref.path);
  }),
  getDoc: vi.fn(async () => ({
    exists: () => remoteDoc.exists,
    data: () => remoteDoc.data,
  })),
}));

vi.mock('../services/sync/syncStateMachine', () => ({
  offlineSync: {
    setExecutor: vi.fn(),
    syncNow: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
  },
}));

vi.mock('../services/zettelkasten/graphMutations', () => ({
  ZETTELKASTEN_GRAPH_SYNC_COLLECTION: 'zettelkasten_graph_mutations',
  executeGraphSyncOperation: vi.fn(async () => undefined),
  enqueueGraphNode: vi.fn(async () => undefined),
}));

// Real conflict kernel semantics would be ideal, but the component imports
// the module — a partial mock keeps the delete path deterministic. The
// requiresManualResolution flag is what decides divert-vs-delete.
vi.mock('../services/sync/conflictResolver', () => ({
  detectConflicts: vi.fn(() => [{ fields: [{ field: 'status', reason: 'diverged' }] }]),
  partitionFields: vi.fn(() => ({ auto: [], manual: [] })),
  resolveLww: vi.fn(() => ({})),
  buildAuditRow: vi.fn(() => ({})),
  requiresManualResolution: vi.fn(() => true),
}));

vi.mock('../services/auditService', () => ({ logAuditAction: vi.fn() }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => null) }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { OfflineSyncManager } from './OfflineSyncManager';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('OfflineSyncManager — offline DELETE routes through the conflict engine', () => {
  beforeEach(() => {
    deleteDocCalls.length = 0;
    dispatched.length = 0;
    pendingActions.length = 0;
    remoteDoc.exists = false;
    remoteDoc.data = null;
    // Capture the sync-critical-conflict event.
    window.addEventListener('sync-critical-conflict', (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
  });

  it('deletes normally when the remote doc does NOT exist (no conflict)', async () => {
    remoteDoc.exists = false;
    pendingActions.push({
      id: 1,
      type: 'delete',
      collection: 'incidents',
      data: { id: 'inc-1' },
    });
    render(<OfflineSyncManager />);
    await flush();
    expect(deleteDocCalls).toContain('incidents/inc-1');
    expect(dispatched).toHaveLength(0);
  });

  it('DIVERTS the delete (no deleteDoc) when the remote doc diverged and requires manual resolution', async () => {
    remoteDoc.exists = true;
    remoteDoc.data = { status: 'open', updatedAt: '2026-08-05T12:00:00.000Z' };
    pendingActions.push({
      id: 2,
      type: 'delete',
      collection: 'incidents',
      data: { id: 'inc-2' },
    });
    render(<OfflineSyncManager />);
    await flush();
    // The delete must NOT execute — evidence survives until a human decides.
    expect(deleteDocCalls).not.toContain('incidents/inc-2');
    // The human-resolution flow was notified.
    expect(dispatched.length).toBeGreaterThan(0);
  });

  it('still deletes when the remote doc exists but resolution is NOT manual', async () => {
    remoteDoc.exists = true;
    remoteDoc.data = { status: 'open', updatedAt: '2026-08-05T12:00:00.000Z' };
    // Override: requiresManualResolution -> false for this test.
    const resolver = await import('../services/sync/conflictResolver');
    vi.mocked(resolver.requiresManualResolution).mockReturnValue(false as never);
    pendingActions.push({
      id: 3,
      type: 'delete',
      collection: 'incidents',
      data: { id: 'inc-3' },
    });
    render(<OfflineSyncManager />);
    await flush();
    expect(deleteDocCalls).toContain('incidents/inc-3');
    expect(dispatched).toHaveLength(0);
  });
});
