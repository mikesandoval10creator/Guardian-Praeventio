// @vitest-environment jsdom
//
// Praeventio Guard — Contract tests for `useSiteBook` hook.
//
// Cubre los wrappers REST + idempotencia + helpers CRDT locales. Mocks:
//   - `../services/firebase` para que `auth.currentUser.getIdToken()`
//     devuelva un token determinístico (verificamos que viaje en el
//     header Authorization).
//   - `globalThis.fetch` con un handler inspeccionable (capturamos url
//     + init para asertar contra el path, el método, el body y los
//     headers que el hook construye).
//
// Convención `useInsights.test.tsx`: usamos `mockFetch(handler)` +
// `jsonResponse(data, status)` para mantener simetría con el resto del
// repo y bajar el ruido en revisión.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../services/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('fake-token'),
    },
  },
}));

import {
  useSiteBookEntries,
  useSiteBookEntry,
  useSiteBook,
  createSiteBookEntry,
  createLocalDraft,
  applyLocalOp,
  commitDraftToServer,
} from './useSiteBook.js';
import type { SiteBookEntry } from '../services/siteBook/siteBookService.js';

const originalFetch = globalThis.fetch;

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
  return { calls };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeEntry(over: Partial<SiteBookEntry> = {}): SiteBookEntry {
  return {
    id: 'id-1',
    projectId: 'p1',
    folio: 'SB-2026-000001',
    year: 2026,
    sequenceNumber: 1,
    kind: 'inspection',
    occurredAt: '2026-05-11T10:00:00Z',
    recordedAt: '2026-05-11T10:05:00Z',
    recordedByUid: 'u1',
    recordedByRole: 'supervisor',
    description: 'Inspección de rutina sector A nivel 3 sin observaciones.',
    status: 'open',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ────────────────────────────────────────────────────────────────────────
// useSiteBookEntries — listado por año
// ────────────────────────────────────────────────────────────────────────

describe('useSiteBookEntries', () => {
  it('GET con year + limit + Authorization Bearer', async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ entries: [fakeEntry()], year: 2026, count: 1 }),
    );
    const { result } = renderHook(() =>
      useSiteBookEntries('p1', { year: 2026, limit: 25 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.count).toBe(1);
    expect(result.current.error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/sitebook/p1/entries');
    expect(calls[0].url).toContain('year=2026');
    expect(calls[0].url).toContain('limit=25');
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer fake-token');
  });

  it('client-side kind filter when server returns superset', async () => {
    mockFetch(() =>
      jsonResponse({
        entries: [
          fakeEntry({ folio: 'SB-2026-000001', kind: 'inspection' }),
          fakeEntry({ folio: 'SB-2026-000002', kind: 'incident', id: 'id-2' }),
        ],
        year: 2026,
        count: 2,
      }),
    );
    const { result } = renderHook(() =>
      useSiteBookEntries('p1', { year: 2026, kind: 'incident' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.entries).toHaveLength(1);
    expect(result.current.data?.entries[0].kind).toBe('incident');
    expect(result.current.data?.count).toBe(1);
  });

  it('projectId null → no fetch + estado vacío estable', () => {
    const { calls } = mockFetch(() => jsonResponse({}));
    const { result } = renderHook(() => useSiteBookEntries(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('http error se propaga con message del servidor', async () => {
    mockFetch(() => jsonResponse({ error: 'forbidden' }, 403));
    const { result } = renderHook(() => useSiteBookEntries('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('forbidden');
    expect(result.current.data).toBeNull();
  });

  it('refetch dispara una nueva request', async () => {
    let count = 0;
    mockFetch(() => {
      count += 1;
      return jsonResponse({ entries: [], year: 2026, count: 0 });
    });
    const { result } = renderHook(() => useSiteBookEntries('p1', { year: 2026 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(count).toBe(1);
    act(() => result.current.refetch());
    await waitFor(() => expect(count).toBe(2));
  });
});

// ────────────────────────────────────────────────────────────────────────
// useSiteBookEntry — single entry GET
// ────────────────────────────────────────────────────────────────────────

describe('useSiteBookEntry', () => {
  it('GET /entry/:folio con folio URL-encoded', async () => {
    const { calls } = mockFetch(() => jsonResponse(fakeEntry()));
    const { result } = renderHook(() =>
      useSiteBookEntry('p1', 'SB-2026-000001'),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.folio).toBe('SB-2026-000001');
    expect(calls[0].url).toContain('/api/sitebook/p1/entry/SB-2026-000001');
  });

  it('404 → error.message = "not_found"', async () => {
    mockFetch(() => jsonResponse({ error: 'not_found' }, 404));
    const { result } = renderHook(() =>
      useSiteBookEntry('p1', 'SB-2026-999999'),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('not_found');
  });

  it('folio null → no fetch', () => {
    const { calls } = mockFetch(() => jsonResponse({}));
    const { result } = renderHook(() => useSiteBookEntry('p1', null));
    expect(result.current.loading).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// createSiteBookEntry — mutation con Idempotency-Key
// ────────────────────────────────────────────────────────────────────────

describe('createSiteBookEntry', () => {
  it('POST con auth + body JSON + 201 → entry', async () => {
    const { calls } = mockFetch(() =>
      jsonResponse(fakeEntry({ folio: 'SB-2026-000042' }), 201),
    );
    const entry = await createSiteBookEntry('p1', {
      kind: 'inspection',
      occurredAt: '2026-05-11T10:00:00Z',
      description: 'Inspección de rutina sector A nivel 3.',
    });
    expect(entry.folio).toBe('SB-2026-000042');
    expect(calls[0].init?.method).toBe('POST');
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer fake-token');
    const body = JSON.parse((calls[0].init?.body as string) ?? '{}');
    expect(body.kind).toBe('inspection');
  });

  it('Idempotency-Key viaja como header cuando se entrega', async () => {
    const { calls } = mockFetch(() => jsonResponse(fakeEntry(), 201));
    await createSiteBookEntry(
      'p1',
      {
        kind: 'incident',
        occurredAt: '2026-05-11T10:00:00Z',
        description: 'Incidente menor sin lesionados, equipo afectado.',
      },
      'idem-abc-123',
    );
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-abc-123');
  });

  it('error del servidor se propaga con message preferido sobre error', async () => {
    mockFetch(() =>
      jsonResponse({ error: 'description_too_short', message: 'min 15 chars' }, 400),
    );
    await expect(
      createSiteBookEntry('p1', {
        kind: 'inspection',
        occurredAt: '2026-05-11T10:00:00Z',
        description: 'corto',
      }),
    ).rejects.toThrow('min 15 chars');
  });
});

// ────────────────────────────────────────────────────────────────────────
// CRDT local helpers — composición offline
// ────────────────────────────────────────────────────────────────────────

describe('CRDT local helpers', () => {
  it('createLocalDraft produce un CRDT con descripción + status open', () => {
    const draft = createLocalDraft({
      projectId: 'p1',
      kind: 'inspection',
      occurredAt: '2026-05-11T10:00:00Z',
      recordedByUid: 'u1',
      recordedByRole: 'supervisor',
      description: 'Inspección inicial sector A.',
      actor: 'u1_dev1',
      now: new Date('2026-05-11T10:00:00Z'),
    });
    expect(draft.description.value).toContain('Inspección');
    expect(draft.status.value).toBe('open');
    expect(draft.provisionalFolio.startsWith('DRAFT-2026-')).toBe(true);
    expect(draft.kind).toBe('inspection');
  });

  it('applyLocalOp con setDescription muta solo la descripción', () => {
    const draft = createLocalDraft({
      projectId: 'p1',
      kind: 'inspection',
      occurredAt: '2026-05-11T10:00:00Z',
      recordedByUid: 'u1',
      recordedByRole: 'supervisor',
      description: 'inicial',
      actor: 'u1_dev1',
      now: new Date('2026-05-11T10:00:00Z'),
    });
    const next = applyLocalOp(
      draft,
      { type: 'setDescription', value: 'Texto corregido tras observación.' },
      'u1_dev1',
      new Date('2026-05-11T10:05:00Z'),
    );
    expect(next.description.value).toBe('Texto corregido tras observación.');
    // Inmutabilidad estructural — el draft original no muta.
    expect(draft.description.value).toBe('inicial');
  });

  it('applyLocalOp addWorker añade al OR-Set involvedWorkerUids', () => {
    const draft = createLocalDraft({
      projectId: 'p1',
      kind: 'inspection',
      occurredAt: '2026-05-11T10:00:00Z',
      recordedByUid: 'u1',
      recordedByRole: 'supervisor',
      description: 'inicial',
      actor: 'u1_dev1',
      now: new Date('2026-05-11T10:00:00Z'),
    });
    const next = applyLocalOp(
      draft,
      { type: 'addWorker', uid: 'w42' },
      'u1_dev1',
      new Date('2026-05-11T10:05:00Z'),
    );
    expect(next.involvedWorkerUids.adds['w42']).toBeDefined();
    expect(next.involvedWorkerUids.adds['w42'].length).toBeGreaterThanOrEqual(1);
  });

  it('commitDraftToServer hace POST con el payload aplanado', async () => {
    const { calls } = mockFetch(() =>
      jsonResponse(fakeEntry({ folio: 'SB-2026-000099' }), 201),
    );
    const draft = createLocalDraft({
      projectId: 'p1',
      kind: 'observation',
      occurredAt: '2026-05-11T10:00:00Z',
      recordedByUid: 'u1',
      recordedByRole: 'supervisor',
      description: 'Observación del estado del andamio sector A.',
      location: 'Sector A',
      involvedWorkerUids: ['w1'],
      actor: 'u1_dev1',
      now: new Date('2026-05-11T10:00:00Z'),
    });
    const entry = await commitDraftToServer(draft);
    expect(entry.folio).toBe('SB-2026-000099');
    expect(calls[0].init?.method).toBe('POST');
    const body = JSON.parse((calls[0].init?.body as string) ?? '{}');
    expect(body.kind).toBe('observation');
    expect(body.location).toBe('Sector A');
    expect(body.involvedWorkerUids).toEqual(['w1']);
    // Idempotency-Key derivada del id del draft cuando no se pasa una.
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(draft.id);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Facade `useSiteBook` + refetch tras create
// ────────────────────────────────────────────────────────────────────────

describe('useSiteBook facade', () => {
  it('list + create con refetch automático tras éxito', async () => {
    let count = 0;
    const { calls } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse(fakeEntry({ folio: 'SB-2026-000010' }), 201);
      }
      count += 1;
      return jsonResponse({
        entries: count > 1 ? [fakeEntry({ folio: 'SB-2026-000010' })] : [],
        year: 2026,
        count: count > 1 ? 1 : 0,
      });
    });
    const { result } = renderHook(() => useSiteBook('p1', { year: 2026 }));
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    expect(result.current.list.data?.count).toBe(0);

    await act(async () => {
      await result.current.create({
        kind: 'inspection',
        occurredAt: '2026-05-11T10:00:00Z',
        description: 'Inspección de rutina del andamio.',
      });
    });

    // Tras create, la lista se refetchea automáticamente.
    await waitFor(() => expect(result.current.list.data?.count).toBe(1));
    // POST (1) + GET inicial (1) + GET refetch (1) = 3 calls.
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1);
    expect(calls.filter((c) => !c.init?.method || c.init?.method === 'GET')).toHaveLength(2);
  });

  it('create con projectId null lanza error sin tocar la red', async () => {
    const { calls } = mockFetch(() => jsonResponse({}));
    const { result } = renderHook(() => useSiteBook(null));
    await expect(
      result.current.create({
        kind: 'inspection',
        occurredAt: '2026-05-11T10:00:00Z',
        description: 'no-op',
      }),
    ).rejects.toThrow('projectId required');
    expect(calls).toHaveLength(0);
  });
});
