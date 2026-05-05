// @vitest-environment jsdom
// Sprint 28 H25 — TierDowngradeModal tests.
//
// We assert three behaviours that must hold for the downgrade flow:
//   1. Renders an overage row for each category (workers/projects) that
//      currently exceeds the target capacity, and explains the delta.
//   2. Click on "Archivar más antiguos" emits the cross-component event
//      `tier-downgrade-archive-requested` with the right payload.
//   3. The confirm button is disabled while overages exist; when usage
//      already fits, confirm is enabled and onConfirm fires.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TierDowngradeModal } from './TierDowngradeModal';

afterEachCleanup();

function afterEachCleanup() {
  // Use vitest's beforeEach to reset DOM between cases.
  beforeEach(() => {
    cleanup();
  });
}

describe('TierDowngradeModal', () => {
  it('renders overage rows for workers and projects when both exceed capacity', () => {
    render(
      <TierDowngradeModal
        fromTier="oro"
        toTier="comite-paritario"
        toTierLabel="Comité Paritario"
        currentUsage={{ workers: 80, projects: 23 }}
        targetCapacity={{ workers: 25, projects: 5 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const workersRow = screen.getByTestId('tier-downgrade-category-workers');
    expect(workersRow.textContent).toContain('80');
    expect(workersRow.textContent).toContain('25');

    const projectsRow = screen.getByTestId('tier-downgrade-category-projects');
    expect(projectsRow.textContent).toContain('23');
    expect(projectsRow.textContent).toContain('5');
    // 23 - 5 = 18 excess projects
    expect(projectsRow.textContent).toContain('18');

    // Confirm should be disabled while overages exist.
    expect(
      (screen.getByTestId('tier-downgrade-confirm') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('emits tier-downgrade-archive-requested when archive button clicked', () => {
    const events: any[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener('tier-downgrade-archive-requested', listener);

    try {
      render(
        <TierDowngradeModal
          fromTier="oro"
          toTier="comite-paritario"
          currentUsage={{ workers: 80, projects: 5 }}
          targetCapacity={{ workers: 25, projects: 5 }}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('tier-downgrade-archive-workers'));

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        category: 'workers',
        action: 'archive-oldest',
        fromTier: 'oro',
        toTier: 'comite-paritario',
        excess: 55,
      });
    } finally {
      window.removeEventListener(
        'tier-downgrade-archive-requested',
        listener,
      );
    }
  });

  it('enables confirm and calls onConfirm when usage fits the target tier', () => {
    const onConfirm = vi.fn();

    render(
      <TierDowngradeModal
        fromTier="oro"
        toTier="comite-paritario"
        currentUsage={{ workers: 5, projects: 1 }}
        targetCapacity={{ workers: 25, projects: 5 }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId('tier-downgrade-no-overages')).toBeTruthy();

    const confirmBtn = screen.getByTestId(
      'tier-downgrade-confirm',
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
