// @vitest-environment jsdom
// Sprint 34 — Drawer happy path: receives a critical conflict, supervisor
// picks "Mantener mía" for severity, drawer dispatches the resolved
// event with that choice.

import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// §2.9 (2026-05-22) — Drawer ahora gate by role (admin/gerente only).
// Mock useFirebase para que el test simule un approver (admin) — sin esto
// el drawer renderiza el UI "pending approval" en lugar del UI de
// resolución y los asserts del flujo fallan.
vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({
    user: { uid: 'test-admin', email: 'admin@test' },
    loading: false,
    isAdmin: true,
    isAuthReady: true,
    userRole: 'admin', // approver role
    userIndustry: 'General',
    onboarded: true,
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1', name: 'Faena Norte' } }),
}));

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
}));

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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response;
}

describe('ConflictResolutionDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ entries: [] }));
  });

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

  it('hydrates a durable pending conflict and marks it in review for the approver', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/conflict-queue')) {
        return jsonResponse({
          entries: [{ queueId: 'queue-1', status: 'pending', conflict }],
        });
      }
      if (url.endsWith('/queue-1/mark-in-review')) {
        return jsonResponse({
          ok: true,
          entry: { queueId: 'queue-1', status: 'in_review', conflict },
        });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });

    render(<ConflictResolutionDrawer />);

    expect(await screen.findByText('Tu versión offline')).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sprint-k/proj-1/conflict-queue',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sprint-k/proj-1/conflict-queue/queue-1/mark-in-review',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('resolves a hydrated conflict through the durable endpoint without a local write event', async () => {
    const dispatched: unknown[] = [];
    const listener = (event: Event) => dispatched.push((event as CustomEvent).detail);
    window.addEventListener('sync-critical-conflict-resolved', listener);
    let listCount = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/conflict-queue')) {
        listCount += 1;
        return jsonResponse({
          entries:
            listCount === 1
              ? [{ queueId: 'queue-2', status: 'in_review', conflict }]
              : [],
        });
      }
      if (url.endsWith('/queue-2/resolve')) {
        return jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ConflictResolutionDrawer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mantener mía' }));
    // Race-tolerant: wait for the apply button to BECOME enabled rather
    // than reading hasAttribute on a cached node reference. React 18's
    // batched commits can race against direct DOM reads; findByRole +
    // waitFor(not.toBeDisabled) retries across the commit boundary.
    const applyBtn = await screen.findByRole('button', { name: 'Aplicar resolución' });
    await waitFor(() => expect(applyBtn).not.toBeDisabled());
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sprint-k/proj-1/conflict-queue/queue-2/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            resolution: { severity: { chosen: 'local', value: 'high' } },
          }),
        }),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(dispatched).toHaveLength(0);
    window.removeEventListener('sync-critical-conflict-resolved', listener);
  });

  it('does not emit a local direct-write event while a detected conflict awaits durable hydration', async () => {
    const dispatched: unknown[] = [];
    const listener = (event: Event) => dispatched.push((event as CustomEvent).detail);
    window.addEventListener('sync-critical-conflict-resolved', listener);
    render(<ConflictResolutionDrawer />);

    act(() => {
      window.dispatchEvent(new CustomEvent('sync-critical-conflict', { detail: conflict }));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Mantener mía' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar resolución' }));

    expect(await screen.findByText(/cola segura del servidor/i)).toBeTruthy();
    expect(dispatched).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
    window.removeEventListener('sync-critical-conflict-resolved', listener);
  });

  it('keeps a durable conflict visible when the server rejects a stale resolution', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/conflict-queue')) {
        return jsonResponse({
          entries: [{ queueId: 'queue-3', status: 'in_review', conflict }],
        });
      }
      if (url.endsWith('/queue-3/resolve')) {
        return jsonResponse({ error: 'STALE_TARGET' }, 409);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ConflictResolutionDrawer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mantener mía' }));
    // Wait for the apply button to BECOME enabled (race-tolerant). The
    // initial render sets disabled=true because resolution={}. After the
    // click on "Mantener mía" schedules setResolution, React commits, and
    // the apply button transitions to disabled=false. waitFor retries
    // through microtasks so it captures the post-commit state, whereas a
    // direct hasAttribute read on the cached node can race against React's
    // batched update.
    const apply = await screen.findByRole('button', { name: 'Aplicar resolución' });
    await waitFor(() => expect(apply).not.toBeDisabled());
    fireEvent.click(apply);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sprint-k/proj-1/conflict-queue/queue-3/resolve',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    expect(await screen.findByText(/cambió en otro dispositivo/i)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
