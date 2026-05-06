// @vitest-environment jsdom
// Sprint 34 — Drawer happy path: receives a critical conflict, supervisor
// picks "Mantener mía" for severity, drawer dispatches the resolved
// event with that choice.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConflictResolutionDrawer } from './ConflictResolutionDrawer';
import type { Conflict } from '../../services/sync/conflictResolver';

const conflict: Conflict = {
  collection: 'nodes',
  docId: 'n1',
  docType: 'RiskNode',
  localUpdatedAt: '2026-05-05T10:00:00.000Z',
  serverUpdatedAt: '2026-05-05T10:05:00.000Z',
  isDeletionConflict: false,
  fields: [
    {
      field: 'severity',
      localValue: 'high',
      remoteValue: 'low',
      critical: true,
    },
  ],
};

describe('ConflictResolutionDrawer', () => {
  it('renders side-by-side, supervisor keeps local, dispatches resolved event', () => {
    const dispatched: any[] = [];
    const listener = (e: Event) => {
      dispatched.push((e as CustomEvent).detail);
    };
    window.addEventListener('sync-critical-conflict-resolved', listener);

    render(<ConflictResolutionDrawer initialConflicts={[conflict]} />);

    // Side-by-side panes.
    expect(screen.getByText('Tu versión offline')).toBeTruthy();
    expect(screen.getByText('Versión actual del servidor')).toBeTruthy();
    // Critical badge surfaced.
    expect(screen.getByText('crítico')).toBeTruthy();

    // Pick "Mantener mía".
    const keepLocal = screen.getByRole('button', { name: 'Mantener mía' });
    fireEvent.click(keepLocal);

    // Apply.
    const apply = screen.getByRole('button', { name: 'Aplicar resolución' });
    expect(apply.hasAttribute('disabled')).toBe(false);
    act(() => {
      fireEvent.click(apply);
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      collection: 'nodes',
      docId: 'n1',
      resolutions: [
        { field: 'severity', choice: 'local', value: 'high' },
      ],
    });

    window.removeEventListener('sync-critical-conflict-resolved', listener);
  });

  it('exposes role=dialog with aria-modal=true (WCAG)', () => {
    render(<ConflictResolutionDrawer initialConflicts={[conflict]} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
