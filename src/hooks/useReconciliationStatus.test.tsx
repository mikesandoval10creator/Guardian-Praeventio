// @vitest-environment jsdom
//
// Tests for `useReconciliationStatus`. Runs in jsdom so the hook's
// `window.addEventListener` wiring resolves against a real EventTarget.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { useReconciliationStatus } from './useReconciliationStatus';
import {
  RECONCILIATION_STATS_EVENT,
  type ReconciliationStats,
} from '../services/slm/reconciliationAutoTrigger';

afterEach(() => {
  cleanup();
});

function Harness({
  triggerFn,
}: {
  triggerFn?: () => Promise<ReconciliationStats>;
}): React.ReactElement {
  const status = useReconciliationStatus({ triggerFn });
  return (
    <div>
      <span data-testid="lastRunAt">{status.lastRunAt ?? 'null'}</span>
      <span data-testid="running">{String(status.running)}</span>
      <span data-testid="attempted">{status.lastStats?.attempted ?? 'none'}</span>
      <span data-testid="succeeded">{status.lastStats?.succeeded ?? 'none'}</span>
      <button
        type="button"
        data-testid="trigger"
        onClick={() => {
          void status.triggerNow();
        }}
      >
        trigger
      </button>
    </div>
  );
}

function makeStats(overrides: Partial<ReconciliationStats> = {}): ReconciliationStats {
  return {
    runId: 'r-1',
    startedAt: 1000,
    finishedAt: 1500,
    trigger: 'manual',
    attempted: 3,
    succeeded: 3,
    failed: 0,
    failures: [],
    ...overrides,
  };
}

describe('useReconciliationStatus', () => {
  it('updates lastStats + lastRunAt when a stats event fires', () => {
    render(<Harness />);
    expect(screen.getByTestId('lastRunAt').textContent).toBe('null');

    act(() => {
      window.dispatchEvent(
        new CustomEvent<ReconciliationStats>(RECONCILIATION_STATS_EVENT, {
          detail: makeStats({ finishedAt: 1500, attempted: 4, succeeded: 4 }),
        }),
      );
    });

    expect(screen.getByTestId('lastRunAt').textContent).toBe('1500');
    expect(screen.getByTestId('attempted').textContent).toBe('4');
    expect(screen.getByTestId('succeeded').textContent).toBe('4');
  });

  it('does not advance lastRunAt for skipped runs but still updates lastStats', () => {
    render(<Harness />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent<ReconciliationStats>(RECONCILIATION_STATS_EVENT, {
          detail: makeStats({
            finishedAt: 2000,
            skipped: true,
            skippedReason: 'rate_limited',
            attempted: 0,
            succeeded: 0,
          }),
        }),
      );
    });
    expect(screen.getByTestId('lastRunAt').textContent).toBe('null');
    expect(screen.getByTestId('attempted').textContent).toBe('0');
  });

  it('invokes the provided triggerFn when triggerNow is called', async () => {
    const triggerFn = vi.fn(async () => makeStats({ attempted: 7, succeeded: 7 }));
    render(<Harness triggerFn={triggerFn} />);

    await act(async () => {
      screen.getByTestId('trigger').click();
    });

    expect(triggerFn).toHaveBeenCalledTimes(1);
  });
});
