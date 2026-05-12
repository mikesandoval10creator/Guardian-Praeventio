// @vitest-environment jsdom
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
  useRiskRanking,
  useSafetyTalks,
  useRoleView,
  useSiteBookEntries,
  createSiteBookEntry,
  requestAuditExpressBundle,
} from './useInsights.js';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
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

describe('useRiskRanking', () => {
  it('fetches risk ranking and exposes data', async () => {
    mockFetch(() =>
      jsonResponse({
        topRisks: [{ id: 'r1', score: 50 }],
        weakControls: [],
        computedAt: '2026-05-11T10:00:00Z',
      }),
    );
    const { result } = renderHook(() => useRiskRanking('p1', 5));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.topRisks).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('returns null data when projectId is null', () => {
    const { result } = renderHook(() => useRiskRanking(null));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('propagates http errors', async () => {
    mockFetch(() => jsonResponse({ error: 'forbidden' }, 403));
    const { result } = renderHook(() => useRiskRanking('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('forbidden');
  });
});

describe('useSafetyTalks', () => {
  it('fetches suggestions list', async () => {
    mockFetch(() =>
      jsonResponse({
        suggestions: [{ topicId: 'altura', title: 'Test', durationMinutes: 10, rationale: [], score: 70 }],
        signalsSummary: { counts: { incidents: 0, risks: 1, tasks: 1, findings: 0 } },
      }),
    );
    const { result } = renderHook(() => useSafetyTalks('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.suggestions[0].topicId).toBe('altura');
  });
});

describe('useRoleView', () => {
  it('fetches role state + cards', async () => {
    mockFetch(() =>
      jsonResponse({
        state: { userUid: 'u1', userRole: 'worker', todaysTasks: 2 },
        cards: [{ id: 'w-tasks', title: 't', body: 'b', severity: 'action_required', category: 'tasks' }],
        userEmail: 'u@x.com',
      }),
    );
    const { result } = renderHook(() => useRoleView('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.cards).toHaveLength(1);
  });
});

describe('useSiteBookEntries', () => {
  it('passes year as query param', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ entries: [], year: 2026, count: 0 });
    });
    const { result } = renderHook(() => useSiteBookEntries('p1', 2026));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedUrl).toContain('year=2026');
    expect(result.current.data?.year).toBe(2026);
  });
});

describe('createSiteBookEntry', () => {
  it('POST con auth + payload, devuelve entry', async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch((_url, init) => {
      capturedInit = init;
      return jsonResponse({ id: 'e1', folio: 'SB-2026-000001' }, 201);
    });
    const entry = await createSiteBookEntry('p1', {
      kind: 'inspection',
      occurredAt: '2026-05-11T10:00:00Z',
      description: 'Inspección de rutina sector A.',
    });
    expect(entry.folio).toBe('SB-2026-000001');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse((capturedInit?.body as string) ?? '{}').kind).toBe('inspection');
  });

  it('lanza error con mensaje del servidor', async () => {
    mockFetch(() => jsonResponse({ error: 'description_too_short', message: 'min 15 chars' }, 400));
    await expect(
      createSiteBookEntry('p1', {
        kind: 'inspection',
        occurredAt: '2026-05-11T10:00:00Z',
        description: 'corto',
      }),
    ).rejects.toThrow('min 15 chars');
  });
});

describe('requestAuditExpressBundle', () => {
  it('devuelve downloadUrl + expiresAt', async () => {
    mockFetch(() =>
      jsonResponse({ downloadUrl: 'https://storage/abc.zip', expiresAt: '2026-05-11T11:00:00Z' }),
    );
    const result = await requestAuditExpressBundle('p1');
    expect(result.downloadUrl).toBe('https://storage/abc.zip');
  });
});

describe('refetch', () => {
  it('refetch triggers nueva request', async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount += 1;
      return jsonResponse({ topRisks: [], weakControls: [], computedAt: 'x' });
    });
    const { result } = renderHook(() => useRiskRanking('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(callCount).toBe(1);
    act(() => result.current.refetch());
    await waitFor(() => expect(callCount).toBe(2));
  });
});
