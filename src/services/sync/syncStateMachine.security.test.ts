import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OfflineSyncStateMachine,
  type LegacyQuarantineRecord,
  type SyncOperation,
  type SyncQueuePersistence,
} from './syncStateMachine';
import type { QueueIdentity } from './queueIdentity';

const OWNER_A: QueueIdentity = {
  ownerUid: 'user-a',
  tenantId: 'tenant-a',
  installationId: 'install-a',
  schemaVersion: 2,
};

class FakePersistence implements SyncQueuePersistence {
  operations: SyncOperation[] = [];
  quarantine: LegacyQuarantineRecord[] = [];
  lastSuccessMs: number | null = null;
  legacyOperations: unknown = null;

  async loadOperations(): Promise<SyncOperation[]> {
    return structuredClone(this.operations);
  }

  async saveOperations(operations: SyncOperation[]): Promise<void> {
    this.operations = structuredClone(operations);
  }

  async loadQuarantine(): Promise<LegacyQuarantineRecord[]> {
    return structuredClone(this.quarantine);
  }

  async saveQuarantine(records: LegacyQuarantineRecord[]): Promise<void> {
    this.quarantine = structuredClone(records);
  }

  async loadLastSuccessMs(): Promise<number | null> {
    return this.lastSuccessMs;
  }

  async saveLastSuccessMs(value: number): Promise<void> {
    this.lastSuccessMs = value;
  }

  async loadLegacyOperations(): Promise<unknown> {
    return structuredClone(this.legacyOperations);
  }

  async deleteLegacyOperations(): Promise<void> {
    this.legacyOperations = null;
  }

  async clearAll(): Promise<void> {
    this.operations = [];
    this.quarantine = [];
    this.lastSuccessMs = null;
    this.legacyOperations = null;
  }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function machine(
  options: {
    persistence?: FakePersistence;
    identity?: () => Promise<QueueIdentity | null>;
    nowMs?: () => number;
    maxOperations?: number;
    retentionMs?: number;
  } = {},
) {
  return new OfflineSyncStateMachine({
    persistence: options.persistence ?? new FakePersistence(),
    identityResolver: options.identity ?? (async () => OWNER_A),
    nowMs: options.nowMs,
    maxOperations: options.maxOperations,
    retentionMs: options.retentionMs,
  });
}

describe('OfflineSyncStateMachine security foundation', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('fails closed instead of accepting a new operation without authenticated identity', async () => {
    const persistence = new FakePersistence();
    const sm = machine({ persistence, identity: async () => null });
    sm.setOnlineGetter(() => false);
    await sm.ready();

    await expect(
      sm.enqueue({
        type: 'create',
        collection: 'documents',
        data: { secret: 'payload' },
      }),
    ).rejects.toThrow(/authenticated queue identity/i);
    expect(persistence.operations).toEqual([]);
    sm._dispose();
  });

  it('recovers after restart and drains for the same authenticated identity', async () => {
    const persistence = new FakePersistence();
    const first = machine({ persistence });
    first.setOnlineGetter(() => false);
    await first.ready();
    await first.enqueue({
      type: 'create',
      collection: 'documents',
      data: { secret: 'restart-payload' },
      projectId: 'project-1',
    });

    const executor = vi.fn(async () => undefined);
    const restarted = machine({ persistence });
    restarted.setOnlineGetter(() => true);
    restarted.setExecutor(executor);
    await restarted.ready();
    const result = await restarted.syncNow();

    expect(result).toMatchObject({ succeeded: 1, failed: 0, held: 0 });
    expect(executor).toHaveBeenCalledOnce();
    const executorCall = (executor.mock.calls as unknown[][])[0];
    expect(executorCall?.[0]).toMatchObject({
      ownerUid: 'user-a',
      tenantId: 'tenant-a',
      installationId: 'install-a',
      projectId: 'project-1',
      schemaVersion: 2,
    });
    expect(persistence.operations).toEqual([]);
    first._dispose();
    restarted._dispose();
  });

  it.each([
    ['owner', { ...OWNER_A, ownerUid: 'user-b' }],
    ['tenant', { ...OWNER_A, tenantId: 'tenant-b' }],
    ['installation', { ...OWNER_A, installationId: 'install-b' }],
  ])(
    'holds an operation on %s mismatch without executing or incrementing retries',
    async (_label, current) => {
      let identity = OWNER_A;
      const persistence = new FakePersistence();
      const sm = machine({ persistence, identity: async () => identity });
      sm.setOnlineGetter(() => false);
      await sm.ready();
      await sm.enqueue({
        type: 'update',
        collection: 'documents',
        data: { id: 'doc-1' },
      });

      identity = current;
      const executor = vi.fn(async () => undefined);
      sm.setExecutor(executor);
      sm.setOnlineGetter(() => true);
      const result = await sm.syncNow();

      expect(result).toMatchObject({ succeeded: 0, failed: 0, held: 1 });
      expect(executor).not.toHaveBeenCalled();
      expect(sm.getState()).toMatchObject({ pendingCount: 0, heldCount: 1 });
      expect(sm.heldOperations()[0]).toMatchObject({
        attempts: 0,
        holdReason: 'identity_mismatch',
      });
      sm._dispose();
    },
  );

  it('purges only this generic queue through the explicit logout lifecycle method', async () => {
    const persistence = new FakePersistence();
    const sm = machine({ persistence });
    sm.setOnlineGetter(() => false);
    await sm.ready();
    await sm.enqueue({
      type: 'delete',
      collection: 'documents',
      data: { id: 'doc-1' },
    });

    await sm.purgeForLogout();

    expect(sm.getState()).toMatchObject({
      pendingCount: 0,
      heldCount: 0,
      quarantineCount: 0,
    });
    expect(persistence.operations).toEqual([]);
    expect(persistence.quarantine).toEqual([]);
    sm._dispose();
  });

  it('rejects capacity overflow without evicting already queued operations', async () => {
    const persistence = new FakePersistence();
    const sm = machine({ persistence, maxOperations: 2 });
    sm.setOnlineGetter(() => false);
    await sm.ready();
    await sm.enqueue({
      type: 'create',
      collection: 'documents',
      data: { id: 'one' },
    });
    await sm.enqueue({
      type: 'create',
      collection: 'documents',
      data: { id: 'two' },
    });

    await expect(
      sm.enqueue({
        type: 'create',
        collection: 'documents',
        data: { id: 'three' },
      }),
    ).rejects.toThrow(/capacity/i);
    expect(persistence.operations.map((operation) => operation.data)).toEqual([
      { id: 'one' },
      { id: 'two' },
    ]);
    sm._dispose();
  });

  it('retains expired generic writes as dead letters and does not execute them', async () => {
    let now = 1_000;
    const persistence = new FakePersistence();
    const executor = vi.fn(async () => undefined);
    const sm = machine({ persistence, nowMs: () => now, retentionMs: 100 });
    sm.setOnlineGetter(() => false);
    sm.setExecutor(executor);
    await sm.ready();
    await sm.enqueue({
      type: 'create',
      collection: 'documents',
      data: { id: 'old' },
    });

    now = 1_101;
    sm.setOnlineGetter(() => true);
    await sm.syncNow();

    expect(executor).not.toHaveBeenCalled();
    expect(sm.deadLetters()[0]).toMatchObject({
      data: { id: 'old' },
      deadLettered: true,
      deadLetterReason: 'retention_expired',
    });
    expect(persistence.operations).toHaveLength(1);
    sm._dispose();
  });

  it('does not apply generic retention expiry to life-safety writes', async () => {
    let now = 1_000;
    const executor = vi.fn(async () => undefined);
    const sm = machine({ nowMs: () => now, retentionMs: 100 });
    sm.setOnlineGetter(() => false);
    sm.setExecutor(executor);
    await sm.ready();
    await sm.enqueue({
      type: 'create',
      collection: 'hazards',
      data: { id: 'safety-1' },
      queueClass: 'life_safety',
    });

    now = 5_000;
    sm.setOnlineGetter(() => true);
    await sm.syncNow();

    expect(executor).toHaveBeenCalledOnce();
    expect(sm.deadLetters()).toEqual([]);
    sm._dispose();
  });

  it.each(['success', 'failure'] as const)(
    'preserves a replacement revision after an in-flight %s, including restart',
    async (outcome) => {
      const persistence = new FakePersistence();
      // Revisions must remain distinct even when the clock has not advanced.
      const sm = machine({ persistence, nowMs: () => 1_000 });
      const started = deferred();
      const response = deferred();
      sm.setOnlineGetter(() => false);
      await sm.ready();
      const id = await sm.enqueue({
        type: 'update',
        collection: 'documents',
        data: { id: 'doc-1', value: 'old' },
      });
      sm.setExecutor(async () => {
        started.resolve();
        await response.promise;
      });
      sm.setOnlineGetter(() => true);
      const drain = sm.syncNow();
      await started.promise;
      try {
        const replacementId = await sm.enqueue({
          type: 'update',
          collection: 'documents',
          data: { id: 'doc-1', value: 'new' },
        });
        expect(replacementId).toBe(id);
        if (outcome === 'success') response.resolve();
        else response.reject(new Error('Old revision failed'));
        await drain;
        expect(sm.getState().operations).toMatchObject([
          { id, data: { value: 'new' }, attempts: 0, createdAt: 1_000 },
        ]);
        expect(sm.getState().operations[0].lastError).toBeUndefined();
        expect(persistence.operations).toMatchObject([{ id, data: { value: 'new' }, attempts: 0 }]);

        const restarted = machine({ persistence, nowMs: () => 1_000 });
        restarted.setOnlineGetter(() => false);
        await restarted.ready();
        const sent = vi.fn(async (_operation: SyncOperation) => undefined);
        restarted.setExecutor(sent);
        restarted.setOnlineGetter(() => true);
        try {
          await restarted.syncNow();
          expect(sent).toHaveBeenCalledOnce();
          expect(sent.mock.calls[0][0].data.value).toBe('new');
          expect(persistence.operations).toEqual([]);
        } finally {
          restarted._dispose();
        }
      } finally {
        response.resolve();
        await drain;
        sm._dispose();
      }
    },
  );

  it('skips a stale snapshot entry replaced while an earlier entry is in flight', async () => {
    const persistence = new FakePersistence();
    const sm = machine({ persistence });
    const started = deferred();
    const response = deferred();
    sm.setOnlineGetter(() => false);
    await sm.ready();
    await sm.enqueue({
      type: 'update',
      collection: 'documents',
      data: { id: 'first' },
    });
    await sm.enqueue({
      type: 'update',
      collection: 'documents',
      data: { id: 'second', value: 'old' },
    });
    const executor = vi.fn(async (_operation: SyncOperation) => {
      started.resolve();
      await response.promise;
    });
    sm.setExecutor(executor);
    sm.setOnlineGetter(() => true);
    const drain = sm.syncNow();
    await started.promise;
    try {
      await sm.enqueue({
        type: 'update',
        collection: 'documents',
        data: { id: 'second', value: 'new' },
      });
      response.resolve();
      await drain;
      expect(executor).toHaveBeenCalledOnce();
      expect(persistence.operations).toMatchObject([{ data: { id: 'second', value: 'new' } }]);
      await sm.syncNow();
      expect(executor).toHaveBeenCalledTimes(2);
      expect(executor.mock.calls[1][0].data.value).toBe('new');
      expect(persistence.operations).toEqual([]);
    } finally {
      response.resolve();
      await drain;
      sm._dispose();
    }
  });

  it.each(['success', 'failure'] as const)(
    'skips unsent snapshot entries purged during an in-flight %s',
    async (outcome) => {
      const persistence = new FakePersistence();
      const sm = machine({ persistence });
      const started = deferred();
      const response = deferred();
      sm.setOnlineGetter(() => false);
      await sm.ready();
      for (const id of ['first', 'unsent']) {
        await sm.enqueue({
          type: 'update',
          collection: 'documents',
          data: { id },
        });
      }
      const executor = vi.fn(async (_operation: SyncOperation) => {
        started.resolve();
        await response.promise;
      });
      sm.setExecutor(executor);
      sm.setOnlineGetter(() => true);
      const drain = sm.syncNow();
      await started.promise;
      try {
        await sm.purgeForLogout();
        if (outcome === 'success') response.resolve();
        else response.reject(new Error('Response arrived after logout'));
        await drain;
        expect(executor).toHaveBeenCalledOnce();
        expect(sm.getState().pendingCount).toBe(0);
        expect(persistence.operations).toEqual([]);
        const restarted = machine({ persistence });
        restarted.setOnlineGetter(() => false);
        try {
          await restarted.ready();
          expect(restarted.getState().operations).toEqual([]);
        } finally {
          restarted._dispose();
        }
      } finally {
        response.resolve();
        await drain;
        sm._dispose();
      }
    },
  );

  it('does not resurrect a purged operation after an in-flight failure', async () => {
    const persistence = new FakePersistence();
    const sm = machine({ persistence });
    const started = deferred();
    const response = deferred();
    sm.setOnlineGetter(() => false);
    await sm.ready();
    await sm.enqueue({
      type: 'update',
      collection: 'documents',
      data: { id: 'purged' },
    });
    sm.setExecutor(async () => {
      started.resolve();
      await response.promise;
    });
    sm.setOnlineGetter(() => true);
    const drain = sm.syncNow();
    await started.promise;
    try {
      await sm.purgeForLogout();
      response.reject(new Error('Response arrived after logout'));
      await drain;
      expect(sm.getState().pendingCount).toBe(0);
      expect(persistence.operations).toEqual([]);
    } finally {
      response.resolve();
      await drain;
      sm._dispose();
    }
  });

  it('encrypts legacy central entries into unowned quarantine instead of rebinding them', async () => {
    const persistence = new FakePersistence();
    persistence.legacyOperations = [
      {
        id: 'legacy-1',
        type: 'create',
        collection: 'documents',
        data: { secret: 'legacy-secret' },
        attempts: 0,
        createdAt: 123,
      },
    ];
    const executor = vi.fn(async () => undefined);
    const sm = machine({ persistence });
    sm.setOnlineGetter(() => true);
    sm.setExecutor(executor);
    await sm.ready();
    await sm.syncNow();

    expect(executor).not.toHaveBeenCalled();
    expect(sm.getState()).toMatchObject({
      quarantineCount: 1,
      pendingCount: 0,
    });
    expect(sm.quarantinedEntries()[0]).toMatchObject({
      source: 'legacy_central_v1',
      legacyId: 'legacy-1',
      reason: 'missing_identity',
      payload: { data: { secret: 'legacy-secret' } },
    });
    expect(persistence.legacyOperations).toBeNull();
    sm._dispose();
  });
});
