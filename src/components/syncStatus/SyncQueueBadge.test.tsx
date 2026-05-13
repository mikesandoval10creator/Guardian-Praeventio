// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncQueueBadge } from './SyncQueueBadge.js';
import type {
  QueueSummary,
  SyncItem,
  SyncBadge as SyncBadgeData,
} from '../../services/syncStatus/syncQueueTracker.js';

function emptySummary(): QueueSummary {
  return {
    totalItems: 0,
    byStatus: { saved_local: 0, syncing: 0, synced: 0, sync_error: 0, sync_failed: 0 },
    failedItems: [],
  };
}

describe('<SyncQueueBadge />', () => {
  it('renderiza estado green sin items', () => {
    const summary = emptySummary();
    const badge: SyncBadgeData = { color: 'green', label: 'Todo sincronizado', count: 0 };
    render(<SyncQueueBadge summary={summary} badge={badge} />);
    expect(screen.getByTestId('syncStatus.badge')).toBeInTheDocument();
    expect(screen.getByTestId('syncStatus.label').textContent).toMatch(/sincronizado/i);
    expect(screen.getByTestId('syncStatus.breakdown')).toBeInTheDocument();
  });

  it('muestra retry y dispara callback cuando hay fallidos', () => {
    const failedItem: SyncItem = {
      id: 'abc',
      collection: 'incidents',
      op: 'create',
      payload: {},
      status: 'sync_failed',
      createdAt: '2026-05-01T00:00:00Z',
      attempts: 5,
    };
    const summary: QueueSummary = {
      totalItems: 1,
      byStatus: { saved_local: 0, syncing: 0, synced: 0, sync_error: 0, sync_failed: 1 },
      failedItems: [failedItem],
    };
    const badge: SyncBadgeData = { color: 'red', label: '1 fallido(s)', count: 1 };
    const handler = vi.fn();
    render(<SyncQueueBadge summary={summary} badge={badge} onRetry={handler} />);
    fireEvent.click(screen.getByTestId('syncStatus.retryBtn'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('syncStatus.count.sync_failed').textContent).toMatch(/1/);
  });
});
