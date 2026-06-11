// @vitest-environment jsdom
//
// SystemEngine — subscriber project re-scope (A4 remediation).
//
// `useSystemEvent` used to onSnapshot `tenants/{tid}/system_events`, a path
// that was default-denied by firestore.rules and keyed by a tenant id no
// install ever assigned. These tests pin the re-scope: the Firestore
// subscription targets `projects/{projectId}/system_events`, and when no
// project is selected the hook stays local-only (in-process emits still
// reach the callback; no dead onSnapshot).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const H = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, path: string) => ({ __collection: path })),
  onSnapshot: vi.fn(() => () => undefined),
}));

vi.mock('firebase/firestore', () => ({
  collection: H.collection,
  onSnapshot: H.onSnapshot,
  query: vi.fn((c: unknown, ...constraints: unknown[]) => ({ c, constraints })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: field, dir })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ where: field, op, value })),
  limit: vi.fn((n: number) => ({ limit: n })),
  // eventLog (imported for onLocalEmit) also pulls these:
  doc: vi.fn(),
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock('../../firebase', () => ({ db: { __fake: true }, auth: { currentUser: null } }));
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useSystemEvent } from '../subscriber';
import { emit, __resetForTests } from '../eventLog';
import type { SystemEvent } from '../eventTypes';

beforeEach(async () => {
  await __resetForTests();
  H.collection.mockClear();
  H.onSnapshot.mockClear();
});

describe('useSystemEvent — project-scoped subscription', () => {
  it('subscribes to projects/{projectId}/system_events when a project is selected', () => {
    const cb = vi.fn();
    renderHook(() =>
      useSystemEvent({ projectId: 'p1', tenantId: 'default', types: ['tier_changed'] }, cb),
    );

    expect(H.collection).toHaveBeenCalledWith(
      expect.anything(),
      'projects/p1/system_events',
    );
    expect(H.onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('stays local-only without a projectId: no onSnapshot, local emits still delivered', async () => {
    const cb = vi.fn();
    renderHook(() => useSystemEvent({ tenantId: 'default' }, cb));

    expect(H.onSnapshot).not.toHaveBeenCalled();
    expect(H.collection).not.toHaveBeenCalled();

    const event: SystemEvent = {
      id: 'evt-local-1',
      tenantId: 'default',
      actorUid: 'u1',
      ts: 1_717_000_000_000,
      idempotencyKey: 'idem-local-1',
      type: 'tier_changed',
      payload: { userId: 'u1', fromTier: 'free', toTier: 'pro', source: 'webhook' },
    };
    await emit(event); // project-less → local-only path

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].id).toBe('evt-local-1');
  });

  it('re-subscribes when the selected project changes', () => {
    const cb = vi.fn();
    const { rerender } = renderHook(
      ({ pid }: { pid: string }) => useSystemEvent({ projectId: pid, tenantId: 'default' }, cb),
      { initialProps: { pid: 'p1' } },
    );
    rerender({ pid: 'p2' });

    const paths = H.collection.mock.calls.map((c) => c[1]);
    expect(paths).toContain('projects/p1/system_events');
    expect(paths).toContain('projects/p2/system_events');
  });
});
