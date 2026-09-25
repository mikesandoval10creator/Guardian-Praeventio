// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// Regression test for the double-execution bug: saveForSync() enqueues each
// operation into BOTH the legacy IndexedDB/SQLite queue and the central state
// machine, and OfflineSyncManager drains the two through separate executors.
// Before the fix each executor called addDoc(), so one hazard report filed
// offline became two documents on reconnect.
//
// This pins the invariant end-to-end through the component's REAL executors:
// whichever queue drains, and in whatever order, one operation must touch
// exactly one document.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { SyncOperation } from '../services/sync/syncStateMachine';

const setDocCalls: Array<{ path: string; data: Record<string, unknown> }> = [];
const graphNodeCalls: Array<{ projectId: string; nodeId: string }> = [];

/** Captures the executor the component registers on the state machine. */
let registeredExecutor: ((op: SyncOperation) => Promise<void>) | null = null;
const { quarantineLegacyOperation } = vi.hoisted(() => ({
  quarantineLegacyOperation: vi.fn(async () => undefined),
}));
const { uploadBytesMock } = vi.hoisted(() => ({
  uploadBytesMock: vi.fn(async () => undefined),
}));

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

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collectionName: string, id: string) => ({
    path: `${collectionName}/${id}`,
  }),
  setDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
    setDocCalls.push({ path: ref.path, data });
  }),
  updateDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  uploadBytes: uploadBytesMock,
  getDownloadURL: vi.fn(async () => 'unused'),
}));

vi.mock('../services/sync/syncStateMachine', () => ({
  offlineSync: {
    setExecutor: (fn: (op: SyncOperation) => Promise<void>) => {
      registeredExecutor = fn;
    },
    syncNow: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
    quarantineLegacyOperation,
  },
}));

vi.mock('../services/sync/queueIdentity', () => ({
  resolveCurrentQueueIdentity: vi.fn(async () => ({
    ownerUid: 'current-user',
    tenantId: 'current-tenant',
    installationId: 'current-installation',
    schemaVersion: 2,
  })),
  queueIdentitiesMatch: (
    left: { ownerUid: string; tenantId: string; installationId: string },
    right: { ownerUid: string; tenantId: string; installationId: string },
  ) => left.ownerUid === right.ownerUid &&
    left.tenantId === right.tenantId &&
    left.installationId === right.installationId,
}));

vi.mock('../services/zettelkasten/graphMutations', () => ({
  ZETTELKASTEN_GRAPH_SYNC_COLLECTION: 'zettelkasten_graph_mutations',
  executeGraphSyncOperation: vi.fn(async () => undefined),
  enqueueGraphNode: vi.fn(
    async (_node: Record<string, unknown>, projectId: string, nodeId: string) => {
      graphNodeCalls.push({ projectId, nodeId });
    },
  ),
}));

vi.mock('../services/sync/conflictResolver', () => ({
  detectConflicts: vi.fn(() => []),
  partitionFields: vi.fn(() => ({ auto: [], manual: [] })),
  resolveLww: vi.fn(() => ({})),
  buildAuditRow: vi.fn(() => ({})),
  requiresManualResolution: vi.fn(() => false),
}));

vi.mock('../services/auditService', () => ({ logAuditAction: vi.fn() }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => null) }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { OfflineSyncManager } from './OfflineSyncManager';

/** The payload saveForSync() persists — identical content in both queues. */
const payload = { title: 'Casco faltante', localUpdatedAt: '2026-07-20T06:00:00.000Z' };

/** Lets the component's effect run its async drain to completion. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The state machine's copy of an operation, with its control keys intact. */
const stateMachineOp = (data: Record<string, unknown>): SyncOperation =>
  ({
    id: 'op_1',
    type: 'create',
    collection: 'incidents',
    data,
    ownerUid: 'current-user',
    tenantId: 'current-tenant',
    installationId: 'current-installation',
    schemaVersion: 2,
    queueClass: 'generic',
    attempts: 0,
    createdAt: Date.now(),
  }) as SyncOperation;

describe('OfflineSyncManager — one operation, one document', () => {
  beforeEach(() => {
    setDocCalls.length = 0;
    graphNodeCalls.length = 0;
    pendingActions.length = 0;
    registeredExecutor = null;
    quarantineLegacyOperation.mockClear();
    uploadBytesMock.mockClear();
  });

  it('writes a single document when BOTH queues carry the same create', async () => {
    // The legacy queue's copy...
    pendingActions.push({
      id: 1,
      type: 'create',
      collection: 'incidents',
      data: { ...payload },
    });

    render(<OfflineSyncManager />);
    await flush();

    // ...and the state machine's copy, which keeps the control keys the
    // legacy executor strips. Same operation, different payload shape.
    expect(registeredExecutor).toBeTypeOf('function');
    await registeredExecutor!(
      stateMachineOp({
        ...payload,
        createNode: true,
        nodeData: { kind: 'hazard', projectId: 'project-1' },
      }),
    );

    // Both queues drained. Two writes, but to ONE document — that is the fix.
    expect(quarantineLegacyOperation).toHaveBeenCalledOnce();
    expect(setDocCalls).toHaveLength(1);
  });

  it('stores the same fields no matter which queue wins the race', async () => {
    pendingActions.push({
      id: 1,
      type: 'create',
      collection: 'incidents',
      data: { ...payload, createNode: true, nodeData: { kind: 'hazard' } },
    });

    render(<OfflineSyncManager />);
    await flush();

    await registeredExecutor!(
      stateMachineOp({
        ...payload,
        createNode: true,
        nodeData: { kind: 'hazard', projectId: 'project-1' },
      }),
    );

    // Control keys steer the executors; they must not be written to the
    // document, or the surviving row would depend on drain order.
    const incidentWrites = setDocCalls.filter((c) => c.path.startsWith('incidents/'));
    expect(incidentWrites).toHaveLength(1);
    for (const call of incidentWrites) {
      expect(call.data).not.toHaveProperty('createNode');
      expect(call.data).not.toHaveProperty('nodeData');
      expect(call.data).toMatchObject({ title: 'Casco faltante' });
    }
  });

  it('attaches one Risk Network node per document, even across replays', async () => {
    // The node id used to be crypto.randomUUID(), so every re-sync of the
    // same action hung another orphaned node off the same document.
    const action = {
      id: 1,
      type: 'create',
      collection: 'incidents',
      data: {
        ...payload,
        createNode: true,
        nodeData: {
          projectId: 'project-1',
          type: 'RISK',
          title: 'Casco faltante',
          description: 'Trabajador sin casco',
          tags: ['EPP'],
          metadata: { kind: 'hazard' },
          connections: [],
        },
      },
    };
    const first = render(<OfflineSyncManager />);
    await flush();
    await registeredExecutor!(stateMachineOp(action.data));
    first.unmount();

    render(<OfflineSyncManager />);
    await flush();
    await registeredExecutor!(stateMachineOp(action.data));

    expect(graphNodeCalls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(graphNodeCalls.map((c) => c.nodeId)).size).toBe(1);
    expect(new Set(graphNodeCalls.map((c) => c.projectId))).toEqual(new Set(['project-1']));
  });

  it('keeps two distinct reports as two documents', async () => {
    render(<OfflineSyncManager />);
    await flush();
    await registeredExecutor!(stateMachineOp({ ...payload }));
    await registeredExecutor!(
      stateMachineOp({ ...payload, title: 'Andamio sin baranda' }),
    );

    // Deduplication must not swallow a genuinely different hazard report.
    expect(new Set(setDocCalls.map((c) => c.path)).size).toBe(2);
  });

  it('re-syncing after a restart does not duplicate an already-synced create', async () => {
    // A crash between the Firestore write and removeSyncedAction() leaves the
    // action in the queue; the next boot replays it.
    const first = render(<OfflineSyncManager />);
    await flush();
    await registeredExecutor!(stateMachineOp({ ...payload }));
    first.unmount();

    render(<OfflineSyncManager />);
    await flush();
    await registeredExecutor!(stateMachineOp({ ...payload }));

    expect(setDocCalls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(setDocCalls.map((c) => c.path)).size).toBe(1);
  });

  it('holds a legacy upload without identity and never passes its File to the central executor', async () => {
    const heldEvents: Array<{ count: number }> = [];
    const listener = (event: Event) => {
      heldEvents.push((event as CustomEvent<{ count: number }>).detail);
    };
    window.addEventListener('sync-upload-boundary-held', listener);
    pendingActions.push({
      id: 7,
      type: 'upload',
      collection: 'documents',
      data: { storagePath: 'documents/legacy.pdf' },
      file: new File(['legacy'], 'legacy.pdf', { type: 'application/pdf' }),
    });

    render(<OfflineSyncManager />);
    await flush();

    expect(heldEvents).toEqual([{ count: 1 }]);
    expect(setDocCalls).toEqual([]);
    expect(quarantineLegacyOperation).not.toHaveBeenCalled();
    window.removeEventListener('sync-upload-boundary-held', listener);
  });

  it('preserves the File upload path for a matching authenticated upload identity', async () => {
    const file = new File(['evidence'], 'evidence.pdf', { type: 'application/pdf' });
    pendingActions.push({
      id: 8,
      type: 'upload',
      collection: 'documents',
      data: {
        storagePath: 'documents/evidence.pdf',
        documentData: { title: 'Evidence' },
      },
      file,
      queueIdentity: {
        ownerUid: 'current-user',
        tenantId: 'current-tenant',
        installationId: 'current-installation',
        schemaVersion: 2,
      },
    });

    render(<OfflineSyncManager />);
    await flush();

    expect(uploadBytesMock).toHaveBeenCalledOnce();
    const uploadCall = (uploadBytesMock.mock.calls as unknown[][])[0];
    expect(uploadCall?.[1]).toBe(file);
    expect(setDocCalls).toHaveLength(1);
  });
});
