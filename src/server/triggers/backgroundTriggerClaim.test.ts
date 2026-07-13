import { describe, expect, it } from 'vitest';
import {
  claimBackgroundWork,
  completeBackgroundWork,
  releaseBackgroundWork,
} from './backgroundTriggerClaim';

function fakeStore(initial: Record<string, unknown> = {}) {
  let data = { ...initial };
  const ref = { id: 'doc-1' };
  const db = {
    runTransaction: async <T>(fn: (tx: {
      get: () => Promise<{ data: () => Record<string, unknown> }>;
      update: (_ref: unknown, patch: Record<string, unknown>) => void;
    }) => Promise<T>) =>
      fn({
        get: async () => ({ data: () => ({ ...data }) }),
        update: (_ref, patch) => {
          data = { ...data, ...patch };
        },
      }),
  };
  return { db, ref, read: () => ({ ...data }) };
}

const fields = {
  completedAt: '_doneAt',
  leaseUntilMs: '_leaseUntilMs',
  claimToken: '_claimToken',
  attempts: '_attempts',
};

describe('background trigger transactional claims', () => {
  it('claims pending work atomically and increments attempts', async () => {
    const store = fakeStore();
    const result = await claimBackgroundWork({
      ...store,
      fields,
      nowMs: 1_000,
      leaseMs: 5_000,
      token: 'worker-a',
      claimPatch: { status: 'processing' },
    });
    expect(result).toEqual({ kind: 'claimed', token: 'worker-a' });
    expect(store.read()).toMatchObject({
      _leaseUntilMs: 6_000,
      _claimToken: 'worker-a',
      _attempts: 1,
      status: 'processing',
    });
  });

  it('skips work with a completion marker', async () => {
    const store = fakeStore({ _doneAt: 'already' });
    await expect(
      claimBackgroundWork({ ...store, fields, nowMs: 1_000, leaseMs: 5_000, token: 'b' }),
    ).resolves.toEqual({ kind: 'completed' });
  });

  it('reports a live lease and reclaims it after expiry', async () => {
    const store = fakeStore({ _leaseUntilMs: 2_000, _claimToken: 'worker-a', _attempts: 2 });
    await expect(
      claimBackgroundWork({ ...store, fields, nowMs: 1_000, leaseMs: 5_000, token: 'worker-b' }),
    ).resolves.toEqual({ kind: 'leased', retryAfterMs: 1_000 });

    await expect(
      claimBackgroundWork({ ...store, fields, nowMs: 2_001, leaseMs: 5_000, token: 'worker-b' }),
    ).resolves.toEqual({ kind: 'claimed', token: 'worker-b' });
    expect(store.read()).toMatchObject({ _claimToken: 'worker-b', _attempts: 3 });
  });

  it('only the current claim owner may complete work', async () => {
    const store = fakeStore({ _claimToken: 'worker-b', _leaseUntilMs: 6_000 });
    await expect(
      completeBackgroundWork({
        ...store,
        fields,
        token: 'worker-a',
        completionPatch: { _doneAt: 'done' },
      }),
    ).resolves.toBe(false);
    expect(store.read()._doneAt).toBeUndefined();

    await expect(
      completeBackgroundWork({
        ...store,
        fields,
        token: 'worker-b',
        completionPatch: { _doneAt: 'done' },
      }),
    ).resolves.toBe(true);
    expect(store.read()).toMatchObject({ _doneAt: 'done', _leaseUntilMs: null, _claimToken: null });
  });

  it('releases a failed claim only when the token still owns it', async () => {
    const store = fakeStore({ _claimToken: 'worker-a', _leaseUntilMs: 6_000 });
    await expect(
      releaseBackgroundWork({
        ...store,
        fields,
        token: 'worker-a',
        failurePatch: { status: 'failed' },
      }),
    ).resolves.toBe(true);
    expect(store.read()).toMatchObject({ status: 'failed', _leaseUntilMs: null, _claimToken: null });
  });
});
