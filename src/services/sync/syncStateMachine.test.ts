// Sprint 25 Bucket QQ — Tests for OfflineSyncStateMachine.
//
// Strategy: idb-keyval is mocked with an in-memory map (matching the
// pattern used by syncManager.test.ts). We instantiate fresh state
// machines per test so each scenario starts clean.

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  OfflineSyncStateMachine,
  _internal,
} = await import('./syncStateMachine');

beforeEach(() => {
  memStore.clear();
});

function makeOnline(initial = true) {
  let online = initial;
  return {
    get: () => online,
    set: (v: boolean) => {
      online = v;
    },
  };
}

describe('OfflineSyncStateMachine', () => {
  it('initial state with no ops and online is online_synced', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => true);
    await sm.ready();
    const snap = sm.getState();
    expect(snap.state).toBe('online_synced');
    expect(snap.pendingCount).toBe(0);
    expect(snap.isOnline).toBe(true);
    sm._dispose();
  });

  it('enqueue while offline transitions to offline_queued', async () => {
    const sm = new OfflineSyncStateMachine();
    const online = makeOnline(false);
    sm.setOnlineGetter(online.get);
    await sm.ready();
    await sm.enqueue({ type: 'create', collection: 'docs', data: { foo: 1 } });
    const snap = sm.getState();
    expect(snap.state).toBe('offline_queued');
    expect(snap.pendingCount).toBe(1);
    sm._dispose();
  });

  it('online event drains the queue via executor', async () => {
    const sm = new OfflineSyncStateMachine();
    const online = makeOnline(false);
    sm.setOnlineGetter(online.get);
    const executor = vi.fn(async () => {});
    sm.setExecutor(executor);
    await sm.ready();
    await sm.enqueue({ type: 'create', collection: 'docs', data: { x: 1 } });
    await sm.enqueue({ type: 'update', collection: 'docs', data: { id: 'a', y: 2 } });
    expect(sm.getState().pendingCount).toBe(2);
    online.set(true);
    const result = await sm.syncNow();
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(sm.getState().pendingCount).toBe(0);
    expect(sm.getState().state).toBe('online_synced');
    sm._dispose();
  });

  it('failed op stays in queue with incremented attempts', async () => {
    const sm = new OfflineSyncStateMachine();
    // Start offline so auto-sync on enqueue doesn't run; flip online and call syncNow explicitly.
    const online = makeOnline(false);
    sm.setOnlineGetter(online.get);
    const executor = vi.fn(async () => {
      throw new Error('boom');
    });
    sm.setExecutor(executor);
    await sm.ready();
    await sm.enqueue({ type: 'create', collection: 'docs', data: { x: 1 } });
    online.set(true);
    const result = await sm.syncNow();
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    const snap = sm.getState();
    expect(snap.pendingCount).toBe(1);
    expect(snap.state).toBe('online_failed');
    expect(snap.operations[0].attempts).toBe(1);
    expect(snap.operations[0].lastError).toBe('boom');
    sm._dispose();
  });

  it('dedupes operations by collection+type+id (last-write-wins)', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => false);
    await sm.ready();
    const id1 = await sm.enqueue({
      type: 'update',
      collection: 'docs',
      data: { id: 'doc-1', value: 'first' },
    });
    const id2 = await sm.enqueue({
      type: 'update',
      collection: 'docs',
      data: { id: 'doc-1', value: 'second' },
    });
    expect(id1).toBe(id2); // Same op id — replaced in place
    const snap = sm.getState();
    expect(snap.pendingCount).toBe(1);
    expect(snap.operations[0].data.value).toBe('second');
    sm._dispose();
  });

  it('subscribe fires synchronously on subscribe and on state change', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => true);
    await sm.ready();
    const cb = vi.fn();
    const unsub = sm.subscribe(cb);
    // Initial fire
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].state).toBe('online_synced');
    await sm.enqueue({ type: 'create', collection: 'docs', data: { x: 1 } });
    // At least one additional call after enqueue
    expect(cb.mock.calls.length).toBeGreaterThan(1);
    unsub();
    const calls = cb.mock.calls.length;
    // After unsubscribe, no more calls
    sm.setOnlineGetter(() => false);
    await sm.enqueue({ type: 'create', collection: 'other', data: {} });
    expect(cb.mock.calls.length).toBe(calls);
    sm._dispose();
  });

  it('clearQueue empties pending operations', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => false);
    await sm.ready();
    // Use distinct ids so the dedup key (collection:type:id) does not collapse them.
    await sm.enqueue({ type: 'create', collection: 'docs', data: { id: 'a', x: 1 } });
    await sm.enqueue({ type: 'create', collection: 'docs', data: { id: 'b', y: 2 } });
    expect(sm.getState().pendingCount).toBe(2);
    await sm.clearQueue();
    expect(sm.getState().pendingCount).toBe(0);
    expect(sm.getState().state).toBe('offline_idle');
    sm._dispose();
  });

  it('drops op after MAX_ATTEMPTS to avoid stuck queue', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => true);
    sm.setExecutor(async () => {
      throw new Error('always fails');
    });
    await sm.ready();
    await sm.enqueue({ type: 'create', collection: 'docs', data: { x: 1 } });
    // Force-run through max attempts by directly bumping lastAttemptMs
    // backwards so backoff windows are always satisfied.
    for (let i = 0; i < _internal.MAX_ATTEMPTS + 1; i++) {
      const snap = sm.getState();
      if (snap.pendingCount === 0) break;
      // Rewind lastAttemptMs so backoff lets the op run again
      const op = snap.operations[0];
      (op as any).lastAttemptMs = 0;
      await sm.syncNow();
    }
    expect(sm.getState().pendingCount).toBe(0);
  });

  it('backoff schedule is monotonic and capped', () => {
    const a = _internal.getBackoffMs(1);
    const b = _internal.getBackoffMs(2);
    const c = _internal.getBackoffMs(3);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    // Overflow attempts return last bucket
    const big = _internal.getBackoffMs(99);
    expect(big).toBe(_internal.BACKOFF_MS[_internal.BACKOFF_MS.length - 1]);
  });

  it('state is online_syncing during executor invocation', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => true);
    let observedDuring: string | null = null;
    sm.setExecutor(async () => {
      observedDuring = sm.getState().state;
    });
    await sm.ready();
    await sm.enqueue({ type: 'create', collection: 'docs', data: { x: 1 } });
    await sm.syncNow();
    expect(observedDuring).toBe('online_syncing');
    sm._dispose();
  });
});
