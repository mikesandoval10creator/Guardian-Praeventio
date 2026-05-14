// @vitest-environment jsdom
//
// Tests for `<ReconciliationStatusToast />`.

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';

import { ReconciliationStatusToast } from './ReconciliationStatusToast';
import {
  RECONCILIATION_STATS_EVENT,
  type ReconciliationStats,
} from '../../services/slm/reconciliationAutoTrigger';

afterEach(() => {
  cleanup();
});

function dispatchStats(overrides: Partial<ReconciliationStats> = {}): void {
  const detail: ReconciliationStats = {
    runId: overrides.runId ?? `r-${Math.random()}`,
    startedAt: 1,
    finishedAt: 2,
    trigger: 'manual',
    attempted: 0,
    succeeded: 0,
    failed: 0,
    failures: [],
    ...overrides,
  };
  window.dispatchEvent(
    new CustomEvent<ReconciliationStats>(RECONCILIATION_STATS_EVENT, { detail }),
  );
}

describe('ReconciliationStatusToast', () => {
  it('renders a green success toast when succeeded > 0', () => {
    render(<ReconciliationStatusToast autoDismissMs={0} />);
    act(() => {
      dispatchStats({ runId: 'a', attempted: 3, succeeded: 3 });
    });
    const toast = screen.getByTestId('reconciliation-status-toast');
    expect(toast).toHaveAttribute('data-tone', 'success');
    expect(
      screen.getByTestId('reconciliation-status-toast-primary').textContent,
    ).toMatch(/Sincronizadas 3 consultas/);
  });

  it('renders a warning toast when only failures occurred', () => {
    render(<ReconciliationStatusToast autoDismissMs={0} />);
    act(() => {
      dispatchStats({ runId: 'b', attempted: 2, succeeded: 0, failed: 2 });
    });
    const toast = screen.getByTestId('reconciliation-status-toast');
    expect(toast).toHaveAttribute('data-tone', 'warning');
    expect(
      screen.getByTestId('reconciliation-status-toast-primary').textContent,
    ).toMatch(/2 consultas con error/);
  });

  it('combines partial-success and partial-failure into one success toast with secondary line', () => {
    render(<ReconciliationStatusToast autoDismissMs={0} />);
    act(() => {
      dispatchStats({ runId: 'c', attempted: 5, succeeded: 3, failed: 2 });
    });
    const toast = screen.getByTestId('reconciliation-status-toast');
    expect(toast).toHaveAttribute('data-tone', 'success');
    expect(
      screen.getByTestId('reconciliation-status-toast-secondary').textContent,
    ).toMatch(/2 con error/);
  });

  it('renders nothing when the stats payload is empty (silent)', () => {
    render(<ReconciliationStatusToast autoDismissMs={0} />);
    act(() => {
      dispatchStats({ runId: 'd', attempted: 0, succeeded: 0, failed: 0 });
    });
    expect(
      screen.queryByTestId('reconciliation-status-toast'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when the stats payload is marked skipped', () => {
    render(<ReconciliationStatusToast autoDismissMs={0} />);
    act(() => {
      dispatchStats({
        runId: 'e',
        attempted: 0,
        succeeded: 0,
        failed: 0,
        skipped: true,
        skippedReason: 'rate_limited',
      });
    });
    expect(
      screen.queryByTestId('reconciliation-status-toast'),
    ).not.toBeInTheDocument();
  });

  it('dismisses the toast when the user clicks the dismiss button', () => {
    render(<ReconciliationStatusToast autoDismissMs={0} />);
    act(() => {
      dispatchStats({ runId: 'f', attempted: 1, succeeded: 1 });
    });
    expect(screen.getByTestId('reconciliation-status-toast')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reconciliation-status-toast-dismiss'));
    expect(
      screen.queryByTestId('reconciliation-status-toast'),
    ).not.toBeInTheDocument();
  });

  it('renders directly from forceStats without subscribing to the event', () => {
    render(
      <ReconciliationStatusToast
        autoDismissMs={0}
        forceStats={{
          runId: 'force-1',
          startedAt: 1,
          finishedAt: 2,
          trigger: 'manual',
          attempted: 4,
          succeeded: 4,
          failed: 0,
          failures: [],
        }}
      />,
    );
    expect(
      screen.getByTestId('reconciliation-status-toast-primary').textContent,
    ).toMatch(/Sincronizadas 4 consultas/);
  });
});
