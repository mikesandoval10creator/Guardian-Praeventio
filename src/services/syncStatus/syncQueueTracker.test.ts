import { describe, it, expect } from 'vitest';
import {
  computeItemId,
  createItem,
  markSyncing,
  markSynced,
  markSyncError,
  summarizeQueue,
  findItemsReadyForRetry,
  countPending,
  deriveBadge,
  type SyncItem,
} from './syncQueueTracker.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function item(over: Partial<SyncItem> = {}): SyncItem {
  const base = createItem({
    collection: 'inspections',
    op: 'create',
    payload: { id: 'i1', desc: 'test' },
    now: NOW,
  });
  return { ...base, ...over };
}

describe('computeItemId', () => {
  it('determinístico: mismo input → mismo id', () => {
    const a = computeItemId('coll', 'create', { x: 1 });
    const b = computeItemId('coll', 'create', { x: 1 });
    expect(a).toBe(b);
  });

  it('cambia con diferente collection', () => {
    expect(computeItemId('a', 'create', { x: 1 })).not.toBe(
      computeItemId('b', 'create', { x: 1 }),
    );
  });
});

describe('createItem', () => {
  it('crea item con status=saved_local', () => {
    const i = item();
    expect(i.status).toBe('saved_local');
    expect(i.attempts).toBe(0);
    expect(i.id).toHaveLength(32);
  });
});

describe('lifecycle markSyncing → markSynced', () => {
  it('markSyncing incrementa attempts', () => {
    const i = markSyncing(item(), NOW);
    expect(i.status).toBe('syncing');
    expect(i.attempts).toBe(1);
    expect(i.lastAttemptAt).toBe(NOW.toISOString());
  });

  it('markSynced limpia nextRetry y error', () => {
    const i = markSynced(markSyncError(markSyncing(item(), NOW), 'fail', NOW), NOW);
    expect(i.status).toBe('synced');
    expect(i.nextRetryAt).toBeUndefined();
    expect(i.lastError).toBeUndefined();
  });

  it('markSynced idempotente sobre item ya synced', () => {
    const i1 = markSynced(markSyncing(item(), NOW), NOW);
    const i2 = markSynced(i1, NOW);
    expect(i2.status).toBe('synced');
  });
});

describe('markSyncError + backoff', () => {
  it('error con attempts<5 → sync_error + nextRetry', () => {
    const i = markSyncError(markSyncing(item(), NOW), 'network down', NOW);
    expect(i.status).toBe('sync_error');
    expect(i.nextRetryAt).toBeDefined();
    expect(i.lastError).toBe('network down');
  });

  it('backoff exponencial: 30s, 60s, 120s, 240s', () => {
    let i = item();
    i = markSyncError(markSyncing(i, NOW), 'fail', NOW);
    const delay1 = Date.parse(i.nextRetryAt!) - NOW.getTime();
    expect(delay1).toBe(30_000);

    i = markSyncError(markSyncing(i, NOW), 'fail', NOW);
    const delay2 = Date.parse(i.nextRetryAt!) - NOW.getTime();
    expect(delay2).toBe(60_000);

    i = markSyncError(markSyncing(i, NOW), 'fail', NOW);
    const delay3 = Date.parse(i.nextRetryAt!) - NOW.getTime();
    expect(delay3).toBe(120_000);
  });

  it('attempts>=5 → sync_failed (sin nextRetry)', () => {
    let i = item();
    for (let n = 0; n < 5; n++) {
      i = markSyncError(markSyncing(i, NOW), 'persistent fail', NOW);
    }
    expect(i.status).toBe('sync_failed');
    expect(i.nextRetryAt).toBeUndefined();
  });
});

describe('summarizeQueue + countPending', () => {
  it('cuenta por status', () => {
    const items = [
      item({ status: 'saved_local' }),
      item({ status: 'syncing' }),
      item({ status: 'synced' }),
      item({ status: 'synced' }),
      item({ status: 'sync_failed' }),
    ];
    const s = summarizeQueue(items);
    expect(s.totalItems).toBe(5);
    expect(s.byStatus.synced).toBe(2);
    expect(s.byStatus.sync_failed).toBe(1);
    expect(s.failedItems).toHaveLength(1);
  });

  it('countPending excluye synced', () => {
    const items = [
      item({ status: 'synced' }),
      item({ status: 'saved_local' }),
      item({ status: 'sync_error' }),
    ];
    expect(countPending(items)).toBe(2);
  });
});

describe('findItemsReadyForRetry', () => {
  it('devuelve solo sync_error con nextRetryAt ≤ now', () => {
    const past = new Date(NOW.getTime() - 5_000).toISOString();
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    const items: SyncItem[] = [
      item({ id: 'a', status: 'sync_error', nextRetryAt: past, createdAt: '2026-05-11T11:00:00Z' }),
      item({ id: 'b', status: 'sync_error', nextRetryAt: future, createdAt: '2026-05-11T11:05:00Z' }),
      item({ id: 'c', status: 'sync_failed', nextRetryAt: past }),
      item({ id: 'd', status: 'saved_local' }),
    ];
    const ready = findItemsReadyForRetry(items, NOW);
    expect(ready.map((i) => i.id)).toEqual(['a']);
  });
});

describe('deriveBadge', () => {
  it('todo synced → verde', () => {
    const b = deriveBadge(summarizeQueue([item({ status: 'synced' })]));
    expect(b.color).toBe('green');
    expect(b.count).toBe(0);
  });

  it('sync_failed > 0 → rojo', () => {
    const b = deriveBadge(
      summarizeQueue([item({ status: 'synced' }), item({ status: 'sync_failed' })]),
    );
    expect(b.color).toBe('red');
  });

  it('syncing en curso → azul', () => {
    const b = deriveBadge(summarizeQueue([item({ status: 'syncing' })]));
    expect(b.color).toBe('blue');
  });

  it('pending sin failed/syncing → ámbar', () => {
    const b = deriveBadge(
      summarizeQueue([item({ status: 'saved_local' }), item({ status: 'sync_error' })]),
    );
    expect(b.color).toBe('amber');
    expect(b.count).toBe(2);
  });
});
