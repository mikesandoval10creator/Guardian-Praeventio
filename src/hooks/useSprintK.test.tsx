// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../services/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('fake-token'),
    },
  },
}));

import {
  useVulnerabilityLatest,
  useSifPendingReview,
  useWasteInventory,
  useActiveVisitors,
  createPositiveObservation,
  recordSifExecutiveReview,
} from './useSprintK.js';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('useVulnerabilityLatest', () => {
  it('fetches snapshot', async () => {
    mockFetch(() => jsonResponse({ snapshot: { id: 's1' } }));
    const { result } = renderHook(() => useVulnerabilityLatest('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.snapshot).toEqual({ id: 's1' });
  });

  it('null projectId → no fetch', () => {
    const { result } = renderHook(() => useVulnerabilityLatest(null));
    expect(result.current.loading).toBe(false);
  });
});

describe('useSifPendingReview', () => {
  it('fetches precursors list', async () => {
    mockFetch(() => jsonResponse({ precursors: [{ id: 'p1' }] }));
    const { result } = renderHook(() => useSifPendingReview('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.precursors).toHaveLength(1);
  });
});

describe('useWasteInventory', () => {
  it('fetches wastes + pendingManifests + permits', async () => {
    mockFetch(() =>
      jsonResponse({
        wastes: [],
        pendingManifests: [],
        permits: [],
      }),
    );
    const { result } = renderHook(() => useWasteInventory('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.wastes).toEqual([]);
  });
});

describe('useActiveVisitors', () => {
  it('fetches visitors list', async () => {
    mockFetch(() => jsonResponse({ visitors: [] }));
    const { result } = renderHook(() => useActiveVisitors('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.visitors).toEqual([]);
  });
});

describe('createPositiveObservation', () => {
  it('POST con payload + Authorization', async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch((_url, init) => {
      capturedInit = init;
      return jsonResponse({ ok: true }, 201);
    });
    await createPositiveObservation('p1', {
      id: 'po1',
      observedWorkerUid: 'w1',
      kind: 'safe_behavior',
      description: 'test observación positiva',
      observedAt: '2026-05-11T10:00:00Z',
      location: 'A',
    });
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe(
      'Bearer fake-token',
    );
  });

  it('lanza error en respuesta no-ok', async () => {
    mockFetch(() => jsonResponse({ error: 'forbidden' }, 403));
    await expect(
      createPositiveObservation('p1', {
        id: 'po1',
        observedWorkerUid: 'w1',
        kind: 'safe_behavior',
        description: 'test',
        observedAt: '2026-05-11',
        location: 'A',
      }),
    ).rejects.toThrow('forbidden');
  });
});

describe('recordSifExecutiveReview', () => {
  it('POST devuelve void si 204', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(
      recordSifExecutiveReview('p1', 'sif1', {
        reviewedByUid: 'exec1',
        reviewedAt: '2026-05-11T16:00:00Z',
        reviewNotes: 'Aprobado',
      }),
    ).resolves.toBeUndefined();
  });
});
