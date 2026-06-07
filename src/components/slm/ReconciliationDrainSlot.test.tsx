// @vitest-environment jsdom
//
// Wiring test for `<ReconciliationDrainSlot />` — proves the previously orphaned
// SLM reconciliation auto-trigger is now installed/disposed by the app shell and
// that the status toast is mounted so completed passes surface to the user.
// (The runner + trigger + toast internals are covered by their own suites.)

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const H = vi.hoisted(() => ({
  selectedProject: null as { id: string } | null,
  user: null as { uid: string } | null,
  install: vi.fn(),
  dispose: vi.fn(),
  triggerNow: vi.fn(),
  runner: vi.fn(),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: H.selectedProject }),
}));
vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: H.user }),
}));
// Mock the barrel so the heavy Zettelkasten dependency graph behind
// `runReconciliation` never loads into the jsdom test.
vi.mock('../../services/slm', () => ({
  runReconciliation: H.runner,
}));
// Partial mock: stub only the installer, keep RECONCILIATION_STATS_EVENT real so
// the (unmocked) toast still subscribes to the right event.
vi.mock('../../services/slm/reconciliationAutoTrigger', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, installReconciliationAutoTrigger: H.install };
});

import { ReconciliationDrainSlot } from './ReconciliationDrainSlot';
import {
  RECONCILIATION_STATS_EVENT,
  type ReconciliationStats,
} from '../../services/slm/reconciliationAutoTrigger';

beforeEach(() => {
  H.selectedProject = null;
  H.user = null;
  H.dispose.mockClear();
  H.triggerNow.mockClear();
  H.runner.mockReset();
  H.install.mockReset().mockReturnValue({ dispose: H.dispose, triggerNow: H.triggerNow });
});

afterEach(() => {
  cleanup();
});

describe('ReconciliationDrainSlot', () => {
  it('installs the auto-trigger with the active project + runner, and disposes on unmount', () => {
    H.selectedProject = { id: 'proj-x' };
    H.user = { uid: 'u1' };

    const { unmount } = render(<ReconciliationDrainSlot />);

    expect(H.install).toHaveBeenCalledTimes(1);
    expect(H.install).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-x', runner: H.runner }),
    );

    unmount();
    expect(H.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not install the trigger until a project is selected (renders nothing)', () => {
    H.selectedProject = null;
    H.user = { uid: 'u1' };

    const { container } = render(<ReconciliationDrainSlot />);

    expect(H.install).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it('does not install the trigger when there is no authenticated user', () => {
    H.selectedProject = { id: 'proj-x' };
    H.user = null;

    render(<ReconciliationDrainSlot />);

    expect(H.install).not.toHaveBeenCalled();
  });

  it('mounts the status toast so a completed reconciliation pass surfaces to the user', () => {
    H.selectedProject = { id: 'proj-x' };
    H.user = { uid: 'u1' };

    render(<ReconciliationDrainSlot />);

    act(() => {
      const detail: ReconciliationStats = {
        runId: 'run-1',
        startedAt: 1,
        finishedAt: 2,
        trigger: 'manual',
        attempted: 2,
        succeeded: 2,
        failed: 0,
        failures: [],
      };
      window.dispatchEvent(
        new CustomEvent<ReconciliationStats>(RECONCILIATION_STATS_EVENT, { detail }),
      );
    });

    expect(screen.getByTestId('reconciliation-status-toast')).toHaveAttribute(
      'data-tone',
      'success',
    );
  });
});
