// @vitest-environment jsdom
//
// Tests for the USGS seismic monitor. Vital + report-relevant: this is the
// "monitor sísmico" the strategic report flagged, and per directive external
// feeds (USGS) are discreet enriching data — a near + strong + recent quake
// raises a criticalAlert; everything else must NOT. We pin the alert criteria
// (magnitude ≥ 4.5, distance < 500km via Haversine, within the last 2h).
//
// Audit 2026-07-02 §3.1 bug 10: the hook used to swallow every fetch/parse
// failure with a commented-out logger.error and no loading/error signal —
// consumers (EmergenciaAvanzada.tsx) rendered "Cargando datos sísmicos..."
// forever on a persistent USGS outage. These tests pin the new contract:
// `loading` starts true and settles to false on both success AND failure,
// and a failure surfaces via `error` + `logger.warn` (not silent).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSeismicMonitor } from './useSeismicMonitor';

const fetchMock = vi.fn();

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  },
}));

import { logger } from '../utils/logger';

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(logger.warn).mockClear();
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

  it('surfaces a network error via `error` + logger.warn (not silent) and keeps an empty list', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useSeismicMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.earthquakes).toHaveLength(0);
    expect(result.current.criticalAlert).toBeNull();
    expect(result.current.error).toBe('network down');
    expect(logger.warn).toHaveBeenCalledWith(
      'useSeismicMonitor: USGS fetch failed',
      expect.objectContaining({ message: 'network down' }),
    );
  });

  it('starts `loading: true` and settles to `false` once the first fetch resolves', async () => {
    fetchMock.mockResolvedValue(usgs([feature({ id: 'a' })]));
    const { result } = renderHook(() => useSeismicMonitor());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.earthquakes).toHaveLength(1);
  });

  it('settles `loading: false` even when the fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSeismicMonitor());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
