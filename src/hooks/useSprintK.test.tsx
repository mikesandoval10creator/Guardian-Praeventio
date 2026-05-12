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
  useLessons,
  useCorrectiveActions,
  useLoto,
  useEquipment,
  createLesson,
  createCorrectiveAction,
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

describe('useLessons', () => {
  it('fetches lessons (top-adopted default)', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ lessons: [{ id: 'l1' }] });
    });
    const { result } = renderHook(() => useLessons('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.lessons).toHaveLength(1);
    expect(capturedUrl).toBe('/api/sprint-k/p1/lessons');
  });

  it('applies scope query param', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ lessons: [] });
    });
    const { result } = renderHook(() => useLessons('p1', { scope: 'industry' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedUrl).toContain('scope=industry');
  });

  it('null projectId → no fetch', () => {
    const { result } = renderHook(() => useLessons(null));
    expect(result.current.loading).toBe(false);
  });
});

describe('useCorrectiveActions', () => {
  it('fetches actions + systemic', async () => {
    mockFetch(() => jsonResponse({ actions: [{ id: 'a1' }], systemic: [] }));
    const { result } = renderHook(() => useCorrectiveActions('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.actions).toHaveLength(1);
    expect(result.current.data?.systemic).toEqual([]);
  });

  it('applies status query param', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ actions: [], systemic: [] });
    });
    const { result } = renderHook(() =>
      useCorrectiveActions('p1', { status: 'closed' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedUrl).toContain('status=closed');
  });
});

describe('useLoto', () => {
  it('fetches active applications', async () => {
    mockFetch(() => jsonResponse({ applications: [{ id: 'lt1' }] }));
    const { result } = renderHook(() => useLoto('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.applications).toHaveLength(1);
  });

  it('filters by equipmentId when provided', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ applications: [] });
    });
    const { result } = renderHook(() => useLoto('p1', { equipmentId: 'eq42' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedUrl).toContain('equipmentId=eq42');
  });
});

describe('useEquipment', () => {
  it('fetches equipment list', async () => {
    mockFetch(() => jsonResponse({ equipment: [{ id: 'e1' }] }));
    const { result } = renderHook(() => useEquipment('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.equipment).toHaveLength(1);
  });

  it('passes status filter', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ equipment: [] });
    });
    const { result } = renderHook(() =>
      useEquipment('p1', { status: 'bloqueado_loto' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedUrl).toContain('status=bloqueado_loto');
  });
});

describe('createLesson', () => {
  it('POST with Authorization + returns ok:true', async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch((_url, init) => {
      capturedInit = init;
      return jsonResponse({ ok: true }, 201);
    });
    const out = await createLesson('p1', {
      id: 'l1',
      summary: 'Lección breve',
      preventiveAction: 'Acción preventiva',
      riskCategories: ['caida'],
      tags: ['altura'],
      scope: 'project',
      publishedAt: '2026-05-12T00:00:00Z',
      adoptionCount: 0,
    });
    expect(out).toEqual({ ok: true });
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe(
      'Bearer fake-token',
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch(() => jsonResponse({ error: 'forbidden' }, 403));
    await expect(
      createLesson('p1', {
        id: 'l1',
        summary: 's',
        preventiveAction: 'p',
        riskCategories: [],
        tags: [],
        scope: 'global',
        publishedAt: '2026-05-12',
        adoptionCount: 0,
      }),
    ).rejects.toThrow('forbidden');
  });
});

describe('createCorrectiveAction', () => {
  it('POST returns ok:true on 201', async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch((_url, init) => {
      capturedInit = init;
      return jsonResponse({ ok: true }, 201);
    });
    const out = await createCorrectiveAction('p1', {
      id: 'a1',
      description: 'Acción correctiva con descripción suficiente',
      level: 'engineering',
      status: 'open',
      isSystemic: false,
    });
    expect(out).toEqual({ ok: true });
    expect(capturedInit?.method).toBe('POST');
  });

  it('throws when server returns error', async () => {
    mockFetch(() => jsonResponse({ error: 'internal_error' }, 500));
    await expect(
      createCorrectiveAction('p1', {
        id: 'a1',
        description: 'x',
        status: 'open',
        isSystemic: false,
      }),
    ).rejects.toThrow('internal_error');
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
