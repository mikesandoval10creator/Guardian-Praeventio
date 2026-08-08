// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// Sprint 50 E.15 P1 H11 — projectContextAdapter emits a real
// `tier_changed` event when selectedProject.id changes.
//
// Ticket 39aaa66d-73fe-81a6-84f8-fd311af55f45 (one slice of the 8-
// adapter backlog in SystemEngine). The adapter was a no-op placeholder
// for Sprint 27 H6; this PR makes it observable.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { onLocalEmit } from '../eventLog';
import { useProjectContextAdapter } from './projectContextAdapter';
import { useFirebase } from '../../../contexts/FirebaseContext';

// The ProjectContext only exports `useProject()` — its return shape
// isn't a named type. For the test we just need the `selectedProject`
// field; declare a structural type that matches what `useProject()`
// returns so the mock satisfies the mock signature.
type ProjectReturn = {
  selectedProject: { id: string; name: string; tenantId: string; createdAt: string } | undefined;
  projects: Array<{ id: string; name: string; tenantId: string; createdAt: string }>;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
  setSelectedProject: (p: { id: string; name: string; tenantId: string; createdAt: string } | undefined) => void;
};

// Hoisted state — declared BEFORE the vi.mock blocks below because
// vitest hoists `vi.mock` calls to the top of the file. The mocks
// close over these module-scoped variables, so the order matters.
let projectReturn: ProjectReturn | undefined;

vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () =>
    projectReturn ?? {
      selectedProject: undefined,
      projects: [],
      loading: false,
      error: null,
      refresh: async () => undefined,
      setSelectedProject: vi.fn(),
    },
}));

vi.mock('../../../contexts/FirebaseContext', () => ({
  useFirebase: vi.fn(() => ({ user: { uid: 'user-test-001' } })),
}));

// Spy on the local-emit fan-out so we can capture events without
// touching the real eventLog/IndexedDB.
type Captured = Parameters<Parameters<typeof onLocalEmit>[0]>[0];
const captured: Captured[] = [];
let unsubscribeLocal: (() => void) | null = null;

beforeEach(async () => {
  captured.length = 0;
  if (unsubscribeLocal) {
    unsubscribeLocal();
    unsubscribeLocal = null;
  }
  projectReturn = undefined;
  // Default: a signed-in user. Tests that exercise "signed out" override
  // this via `vi.mocked(useFirebase).mockReturnValue(...)`.
  vi.mocked(useFirebase).mockReturnValue({ user: { uid: 'user-test-001' } } as never);
  // Reset the in-memory outbox so each test starts fresh.
  const { __resetForTests } = await import('../eventLog');
  await __resetForTests();
  // Subscribe to local emits.
  unsubscribeLocal = onLocalEmit((event) => {
    captured.push(event);
  });
});

afterEach(async () => {
  if (unsubscribeLocal) {
    unsubscribeLocal();
    unsubscribeLocal = null;
  }
  const { __resetForTests } = await import('../eventLog');
  await __resetForTests();
  vi.restoreAllMocks();
});

function setSelectedProject(id: string | undefined) {
  if (id === undefined) {
    projectReturn = {
      selectedProject: undefined,
      projects: [],
      loading: false,
      error: null,
      refresh: async () => undefined,
      setSelectedProject: vi.fn(),
    };
    return;
  }
  projectReturn = {
    selectedProject: {
      id,
      name: `Project ${id}`,
      tenantId: 'tenant-001',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    projects: [
      {
        id,
        name: `Project ${id}`,
        tenantId: 'tenant-001',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    loading: false,
    error: null,
    refresh: async () => undefined,
    setSelectedProject: vi.fn(),
  };
}

describe('useProjectContextAdapter', () => {
  it('emits tier_changed when selectedProject.id changes from A to B', async () => {
    setSelectedProject('proj-A');
    const { rerender } = renderHook(() => useProjectContextAdapter({ tenantId: 'tenant-001' }));
    // Initial render — no event yet (nothing to compare against).
    expect(captured.filter((e) => e.type === 'tier_changed')).toHaveLength(0);

    setSelectedProject('proj-B');
    rerender();

    await act(async () => {
      // Wait for the async emit() chain to flush.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tierEvents = captured.filter((e) => e.type === 'tier_changed');
    expect(tierEvents).toHaveLength(1);
    const event = tierEvents[0];
    if (event.type !== 'tier_changed') throw new Error('unreachable');
    expect(event.payload.fromTier).toBe('proj-A');
    expect(event.payload.toTier).toBe('proj-B');
    expect(event.payload.userId).toBe('user-test-001');
    expect(event.payload.source).toBe('admin');
    expect(event.metadata?.source).toBe('project_context_adapter');
    expect(event.metadata?.reason).toBe('project_switch');
  });

  it('does NOT emit when selectedProject.id stays the same (reference change without id change)', async () => {
    setSelectedProject('proj-A');
    const { rerender } = renderHook(() => useProjectContextAdapter({ tenantId: 'tenant-001' }));
    // Reference change (new object, same id) — should NOT emit.
    setSelectedProject('proj-A');
    rerender();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(captured.filter((e) => e.type === 'tier_changed')).toHaveLength(0);
  });

  it('emits tier_changed with toTier="none" when selectedProject becomes null', async () => {
    setSelectedProject('proj-A');
    const { rerender } = renderHook(() => useProjectContextAdapter({ tenantId: 'tenant-001' }));

    setSelectedProject(undefined);
    rerender();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tierEvents = captured.filter((e) => e.type === 'tier_changed');
    expect(tierEvents).toHaveLength(1);
    const event = tierEvents[0];
    if (event.type !== 'tier_changed') throw new Error('unreachable');
    expect(event.payload.fromTier).toBe('proj-A');
    expect(event.payload.toTier).toBe('none');
  });

  it('uses the same envelope shape as subscriptionContextAdapter (idempotencyKey present)', async () => {
    setSelectedProject('proj-A');
    const { rerender } = renderHook(() => useProjectContextAdapter({ tenantId: 'tenant-001' }));

    setSelectedProject('proj-B');
    rerender();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tierEvents = captured.filter((e) => e.type === 'tier_changed');
    expect(tierEvents).toHaveLength(1);
    const event = tierEvents[0];
    expect(event.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(event.idempotencyKey).toContain('project_switch:user-test-001:proj-A->proj-B');
    expect(typeof event.ts).toBe('number');
    expect(event.ts).toBeGreaterThan(0);
  });
});
