import { describe, it, expect, vi } from 'vitest';
import { EonetAdapter } from './eonetAdapter.js';

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }) as unknown as Response;
}

function sampleEvents() {
  return {
    events: [
      {
        id: 'EONET_1',
        title: 'Wildfire near zone',
        description: null,
        link: 'https://example.test/1',
        closed: null,
        categories: [{ id: 'wildfires', title: 'Wildfires' }],
        sources: [{ id: 'src', url: 'https://example.test' }],
        geometry: [
          { date: '2026-01-01T00:00:00Z', type: 'Point', coordinates: [-70, -33] },
        ],
      },
    ],
  };
}

describe('EonetAdapter', () => {
  it('fetches with bbox and returns parsed events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp(sampleEvents()));
    const adapter = new EonetAdapter({ httpClient: fetchMock as unknown as typeof fetch });
    const events = await adapter.fetchEvents({
      bbox: { lonMin: -75, latMax: -30, lonMax: -68, latMin: -38 },
      categories: ['wildfires'],
    });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('EONET_1');
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('bbox=-75%2C-30%2C-68%2C-38');
    expect(calledUrl).toContain('category=wildfires');
  });

  it('returns cached result on second call within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp(sampleEvents()));
    const adapter = new EonetAdapter({
      httpClient: fetchMock as unknown as typeof fetch,
      cacheTtlMs: 60_000,
    });
    await adapter.fetchEvents({ days: 5 });
    await adapter.fetchEvents({ days: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResp({ message: 'fail' }, 503))
      .mockResolvedValueOnce(jsonResp(sampleEvents()));
    const adapter = new EonetAdapter({ httpClient: fetchMock as unknown as typeof fetch });
    const events = await adapter.fetchEvents({ days: 1 });
    expect(events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on Zod schema validation failure', async () => {
    // schema failure is NOT retried as 5xx, but the adapter still re-fetches
    // because the catch block re-tries any thrown error — supply fresh Response
    // objects so body isn't reused.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResp({ events: [{ /* missing id/title */ }] })),
    );
    const adapter = new EonetAdapter({ httpClient: fetchMock as unknown as typeof fetch });
    await expect(adapter.fetchEvents()).rejects.toThrow(/schema/);
  });

  it('returns empty array when feed has no events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp({ events: [] }));
    const adapter = new EonetAdapter({ httpClient: fetchMock as unknown as typeof fetch });
    const events = await adapter.fetchEvents();
    expect(events).toEqual([]);
  });
});
