// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  getDoc: vi.fn(),
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ path, id })),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: h.doc, getDoc: h.getDoc }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn() } }));

import { useWorkerPings } from './useWorkerPings';

const NOW = 1_700_000_000_000;

function projectSnapshot(tenantId: string, members: string[]) {
  return { exists: () => true, data: () => ({ tenantId, members }) };
}

function pingSnapshot(projectId: string, tenantId = 't1') {
  return {
    exists: () => true,
    data: () => ({
      projectId,
      tenantId,
      lat: -33.45,
      lng: -70.66,
      timestamp: NOW - 1_000,
      status: 'alive',
    }),
  };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  h.getDoc.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWorkerPings — project scope lifecycle', () => {
  it('clears the previous project positions before the next project resolves', async () => {
    let releaseProjectSwitch: ((value: ReturnType<typeof projectSnapshot>) => void) | undefined;
    const slowProjectSwitch = new Promise<ReturnType<typeof projectSnapshot>>((resolve) => {
      releaseProjectSwitch = resolve;
    });

    h.getDoc.mockImplementation(async (ref: { path: string; id: string }) => {
      if (ref.path === 'projects' && ref.id === 'p1') {
        return projectSnapshot('t1', ['w1']);
      }
      if (ref.path === 'pings') {
        return pingSnapshot('p1');
      }
      // Simulate a slow project switch: the old positions must not remain visible.
      return slowProjectSwitch;
    });

    const { result, rerender, unmount } = renderHook(
      ({ projectId }: { projectId: string | null }) =>
        useWorkerPings(projectId, { pollMs: 0 }),
      { initialProps: { projectId: 'p1' } },
    );

    await waitFor(() => expect(result.current.workers).toHaveLength(1));
    expect(result.current.workers[0]?.uid).toBe('w1');

    rerender({ projectId: 'p2' });

    expect(result.current.workers).toEqual([]);

    releaseProjectSwitch?.(projectSnapshot('t1', []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
  });
});
