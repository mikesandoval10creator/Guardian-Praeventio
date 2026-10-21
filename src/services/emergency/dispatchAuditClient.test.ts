import { describe, expect, it, vi } from 'vitest';
import {
  auditDispatchSummary,
  type DispatchAuditPayload,
} from './dispatchAuditClient';

const PAYLOAD: DispatchAuditPayload = {
  projectId: 'p1',
  eventType: 'other',
  regionCode: 'CL',
  includedMedicalFields: [],
  summaryLength: 412,
  generatedAt: '2026-10-21T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('auditDispatchSummary', () => {
  it('sends the structured metadata with the auth header and reports confirmation', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ accepted: true, audited: true }),
    ) as unknown as typeof fetch;

    const result = await auditDispatchSummary(PAYLOAD, {
      authHeader: async () => 'Bearer token',
      fetchImpl,
    });

    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('/api/emergency/dispatch-summary');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token',
    );
    expect(JSON.parse(String(init.body))).toEqual(PAYLOAD);
  });

  it('returns false without calling the API when there is no auth header', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await auditDispatchSummary(PAYLOAD, {
      authHeader: async () => null,
      fetchImpl,
    });
    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns false on 403 instead of claiming the audit was written', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'forbidden' }, 403),
    ) as unknown as typeof fetch;
    const result = await auditDispatchSummary(PAYLOAD, {
      authHeader: async () => 'Bearer token',
      fetchImpl,
    });
    expect(result).toBe(false);
  });

  it('returns false when the server accepted the request but could not audit it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ accepted: true, audited: false }),
    ) as unknown as typeof fetch;
    const result = await auditDispatchSummary(PAYLOAD, {
      authHeader: async () => 'Bearer token',
      fetchImpl,
    });
    expect(result).toBe(false);
  });

  it('swallows network failures so the emergency UI still opens', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const result = await auditDispatchSummary(PAYLOAD, {
      authHeader: async () => 'Bearer token',
      fetchImpl,
    });
    expect(result).toBe(false);
  });
});
