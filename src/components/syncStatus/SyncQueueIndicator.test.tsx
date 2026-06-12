// @vitest-environment jsdom
//
// B16 wire (2026-06) — <SyncQueueIndicator /> mounts the (previously orphan)
// <SyncQueueBadge /> in the app shell next to the connectivity indicator,
// fed by the REAL offline queue (OfflineSyncStateMachine). Invariants:
//   - nothing pending → renders nothing (no shell noise)
//   - pending ops → badge visible with the real counts
//   - "Reintentar fallidos" drives the real machine's syncNow()

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { OfflineSyncStateMachine } = await import('../../services/sync/syncStateMachine');
const { SyncQueueIndicator } = await import('./SyncQueueIndicator');

const QUEUE_KEY = 'guardian_offline_sync_v1';

beforeEach(() => {
  memStore.clear();
});

afterEach(() => {
  cleanup();
});

describe('<SyncQueueIndicator /> — B16 wire', () => {
  it('renders NOTHING when the queue is empty', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => true);
    await sm.ready();

    render(<SyncQueueIndicator machine={sm} />);
    expect(screen.queryByTestId('syncStatus.badge')).toBeNull();
    sm._dispose();
  });

  it('shows the badge with real pending counts when ops are queued offline', async () => {
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => false);
    await sm.ready();
    await sm.enqueue({ type: 'create', collection: 'incidents', data: { id: 'i1' } });

    render(<SyncQueueIndicator machine={sm} />);
    await waitFor(() => {
      expect(screen.getByTestId('syncStatus.badge')).toBeTruthy();
    });
    expect(screen.getByTestId('syncStatus.totalItems').textContent).toMatch(/1/);
    expect(screen.getByTestId('syncStatus.label').textContent).toMatch(/por sincronizar/i);
    sm._dispose();
  });

  it('"Reintentar fallidos" calls the real machine syncNow()', async () => {
    memStore.set(QUEUE_KEY, [
      {
        id: 'op-dead',
        type: 'create',
        collection: 'incidents',
        data: { id: 'i9' },
        attempts: 6,
        createdAt: Date.now(),
        lastError: 'unavailable',
        deadLettered: true,
      },
    ]);
    const sm = new OfflineSyncStateMachine();
    sm.setOnlineGetter(() => true);
    await sm.ready();
    const syncNowSpy = vi.spyOn(sm, 'syncNow');

    render(<SyncQueueIndicator machine={sm} />);
    await waitFor(() => {
      expect(screen.getByTestId('syncStatus.retryBtn')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('syncStatus.retryBtn'));
    });
    expect(syncNowSpy).toHaveBeenCalled();
    sm._dispose();
  });
});
