import { describe, it, expect, vi } from 'vitest';
import { UsgsEarthquakeAdapter } from './usgsEarthquakeAdapter.js';

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }) as unknown as Response;
}

function sampleFc(mag = 5.1) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'usgs_eq_1',
        properties: {
          mag,
          place: '50km W of Test',
          time: 1_700_000_000_000,
          updated: 1_700_000_000_000,
          url: 'https://example.test',
          title: 'M 5.1 - Test',
          type: 'earthquake',
        },
        geometry: { type: 'Point', coordinates: [-70, -33, 10] },
      },
    ],
  };
}

describe('UsgsEarthquakeAdapter', () => {
  it('fetches recent earthquakes around a center', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp(sampleFc()));
    const adapter = new UsgsEarthquakeAdapter({
      httpClient: fetchMock as unknown as typeof fetch,
    });
    const features = await adapter.fetchRecentEarthquakes({
      centerLat: -33,
      centerLon: -70,
      radiusKm: 200,
    });
    expect(features).toHaveLength(1);
    expect(features[0].id).toBe('usgs_eq_1');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('latitude=-33');
    expect(url).toContain('longitude=-70');
    expect(url).toContain('maxradiuskm=200');
  });

  it('caches results within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp(sampleFc()));
    const adapter = new UsgsEarthquakeAdapter({
      httpClient: fetchMock as unknown as typeof fetch,
      cacheTtlMs: 60_000,
      now: () => 1_700_000_000_000,
    });
    await adapter.fetchRecentEarthquakes({
      centerLat: 0,
      centerLon: 0,
      radiusKm: 100,
    });
    await adapter.fetchRecentEarthquakes({
      centerLat: 0,
      centerLon: 0,
      radiusKm: 100,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes minMagnitude filter through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp(sampleFc(6.2)));
    const adapter = new UsgsEarthquakeAdapter({
      httpClient: fetchMock as unknown as typeof fetch,
    });
    await adapter.fetchRecentEarthquakes({
      centerLat: 0,
      centerLon: 0,
      radiusKm: 100,
      minMagnitude: 5.5,
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('minmagnitude=5.5');
  });

  it('passes sinceHours into starttime parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp(sampleFc()));
    const fixedNow = Date.UTC(2026, 0, 10, 12, 0, 0);
    const adapter = new UsgsEarthquakeAdapter({
      httpClient: fetchMock as unknown as typeof fetch,
      now: () => fixedNow,
    });
    await adapter.fetchRecentEarthquakes({
      centerLat: 0,
      centerLon: 0,
      radiusKm: 50,
      sinceHours: 6,
    });
    const url = fetchMock.mock.calls[0][0] as string;
    const expected = new Date(fixedNow - 6 * 60 * 60 * 1000).toISOString();
    expect(url).toContain(`starttime=${encodeURIComponent(expected)}`);
  });
});
