// @vitest-environment jsdom
//
// Tests for the USGS seismic monitor. Vital + report-relevant: this is the
// "monitor sísmico" the strategic report flagged, and per directive external
// feeds (USGS) are discreet enriching data — a near + strong + recent quake
// raises a criticalAlert; everything else must NOT. We pin the alert criteria
// (magnitude ≥ 4.5, distance < 500km via Haversine, within the last 2h).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSeismicMonitor } from './useSeismicMonitor';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

interface FeatureOpts {
  id?: string;
  mag?: number;
  place?: string;
  time?: number;
  lng?: number;
  lat?: number;
  depth?: number;
  url?: string;
}
function feature(o: FeatureOpts = {}) {
  const {
    id = 'q1', mag = 5.2, place = 'Cerca de la faena', time = Date.now(),
    lng = -70.66, lat = -33.45, depth = 10, url = 'http://usgs/q1',
  } = o;
  return { id, properties: { mag, place, time, url }, geometry: { coordinates: [lng, lat, depth] } };
}
function usgs(features: unknown[]): Response {
  return { ok: true, json: async () => ({ features }) } as unknown as Response;
}

// Santiago default project coords used by the hook.
const PLAT = -33.4489;
const PLNG = -70.6693;

describe('useSeismicMonitor', () => {
  it('parses USGS GeoJSON features into typed earthquakes', async () => {
    fetchMock.mockResolvedValue(
      usgs([feature({ id: 'a' }), feature({ id: 'b', lat: 0, lng: 0 })]),
    );
    const { result } = renderHook(() => useSeismicMonitor());
    await waitFor(() => expect(result.current.earthquakes).toHaveLength(2));
    expect(result.current.earthquakes[0]).toMatchObject({ id: 'a', magnitude: 5.2 });
    expect(result.current.earthquakes[0].coordinates).toHaveLength(3);
  });

  it('raises a critical alert for a strong + near + recent quake', async () => {
    fetchMock.mockResolvedValue(
      usgs([feature({ mag: 5.5, lat: -33.45, lng: -70.66, time: Date.now() })]),
    );
    const { result } = renderHook(() => useSeismicMonitor(PLAT, PLNG));
    await waitFor(() => expect(result.current.criticalAlert).not.toBeNull());
    expect(result.current.criticalAlert?.magnitude).toBe(5.5);
  });

  it('does NOT alert for a distant quake (>500km away)', async () => {
    fetchMock.mockResolvedValue(
      usgs([feature({ mag: 6.5, lat: 10, lng: 10, time: Date.now() })]),
    );
    const { result } = renderHook(() => useSeismicMonitor(PLAT, PLNG));
    await waitFor(() => expect(result.current.earthquakes).toHaveLength(1));
    expect(result.current.criticalAlert).toBeNull();
  });

  it('does NOT alert for an old quake (>2h ago)', async () => {
    fetchMock.mockResolvedValue(
      usgs([feature({ mag: 6, lat: -33.45, lng: -70.66, time: Date.now() - 3 * 60 * 60 * 1000 })]),
    );
    const { result } = renderHook(() => useSeismicMonitor(PLAT, PLNG));
    await waitFor(() => expect(result.current.earthquakes).toHaveLength(1));
    expect(result.current.criticalAlert).toBeNull();
  });

  it('does NOT alert for a weak quake (<4.5)', async () => {
    fetchMock.mockResolvedValue(
      usgs([feature({ mag: 3.1, lat: -33.45, lng: -70.66, time: Date.now() })]),
    );
    const { result } = renderHook(() => useSeismicMonitor(PLAT, PLNG));
    await waitFor(() => expect(result.current.earthquakes).toHaveLength(1));
    expect(result.current.criticalAlert).toBeNull();
  });

  it('fails silently on network error (no throw, empty list, no alert)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useSeismicMonitor());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.earthquakes).toHaveLength(0);
    expect(result.current.criticalAlert).toBeNull();
  });
});
