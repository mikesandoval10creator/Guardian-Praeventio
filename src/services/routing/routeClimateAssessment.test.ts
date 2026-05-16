import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assessRouteClimate } from './routeClimateAssessment.js';
import { nasaPowerAdapter } from '../external/nasaPower/nasaPowerAdapter.js';
import { eonetAdapter } from '../external/eonet/eonetAdapter.js';

// Mock ambos adapters externos — los tests cubren la lógica de
// combinación, no la HTTP de NASA/EONET (esa está cubierta en los
// tests propios de cada adapter).
vi.mock('../external/nasaPower/nasaPowerAdapter.js', async () => {
  const actual = await vi.importActual<
    typeof import('../external/nasaPower/nasaPowerAdapter.js')
  >('../external/nasaPower/nasaPowerAdapter.js');
  return {
    ...actual,
    nasaPowerAdapter: {
      fetchClimate: vi.fn(),
      fetchAggregated: vi.fn(),
      clearCache: vi.fn(),
    },
  };
});

vi.mock('../external/eonet/eonetAdapter.js', () => ({
  eonetAdapter: {
    fetchEvents: vi.fn(),
  },
}));

import type {
  ClimateTimeSeries,
  NasaPowerParameter,
} from '../external/nasaPower/types.js';

function makeNasaSeries(samples: {
  WS10M?: Array<number | null>;
  PRECTOTCORR?: Array<number | null>;
  T2M?: Array<number | null>;
}): ClimateTimeSeries[] {
  const make = (
    param: NasaPowerParameter,
    unit: string,
    values: Array<number | null>,
  ): ClimateTimeSeries => {
    const m = new Map<string, number | null>();
    values.forEach((v, i) =>
      m.set(`2026-05-10T${String(i).padStart(2, '0')}:00:00Z`, v),
    );
    return { parameter: param, unit, samples: m };
  };
  const series: ClimateTimeSeries[] = [];
  if (samples.WS10M) series.push(make('WS10M', 'm/s', samples.WS10M));
  if (samples.PRECTOTCORR) series.push(make('PRECTOTCORR', 'mm', samples.PRECTOTCORR));
  if (samples.T2M) series.push(make('T2M', '°C', samples.T2M));
  return series;
}

const BASE_INPUT = {
  midpointLat: -33.45,
  midpointLng: -70.66,
  bbox: { lonMin: -71, latMax: -33, lonMax: -70, latMin: -34 },
  totalDistanceM: 100_000,
  totalDurationS: 5400, // 1.5h
  summary: 'Ruta 68 vía Curacaví',
};

describe('assessRouteClimate', () => {
  beforeEach(() => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockReset();
    vi.mocked(eonetAdapter.fetchEvents).mockReset();
  });

  it('ruta corta + clima benigno + sin eventos → safe', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [3, 4, 5, 3, 4],
        PRECTOTCORR: [0, 0, 0, 0, 0],
        T2M: [15, 18, 12, 14, 16],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate(BASE_INPUT);
    expect(result.status).toBe('safe');
    expect(result.reasons).toEqual([]);
  });

  it('paso cordillerano → warning con reason mountain_pass', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [3],
        PRECTOTCORR: [0],
        T2M: [15],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate({
      ...BASE_INPUT,
      summary: 'Ruta CH-31 vía Los Libertadores',
    });
    expect(result.status).toBe('warning');
    expect(result.reasons.some((r) => r.category === 'mountain_pass')).toBe(true);
    expect(result.metrics.isMountainPass).toBe(true);
  });

  it('viento fuerte sostenido (>15 m/s) → danger', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [16, 17, 18, 15.5, 16],
        PRECTOTCORR: [0],
        T2M: [15],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate(BASE_INPUT);
    expect(result.status).toBe('danger');
    expect(result.reasons.some((r) => r.category === 'wind' && r.level === 'danger')).toBe(true);
  });

  it('viento moderado (8-15 m/s) → warning', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [9, 10, 8.5, 9.5],
        PRECTOTCORR: [0],
        T2M: [15],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate(BASE_INPUT);
    expect(result.status).toBe('warning');
    expect(result.reasons.some((r) => r.category === 'wind' && r.level === 'warning')).toBe(true);
  });

  it('lluvia acumulada >80mm → danger por aluvión', async () => {
    // 6 samples × 15mm = 90mm
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [3],
        PRECTOTCORR: [15, 15, 15, 15, 15, 15],
        T2M: [10],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate(BASE_INPUT);
    expect(result.status).toBe('danger');
    expect(result.reasons.some((r) => r.category === 'precipitation' && r.level === 'danger')).toBe(true);
  });

  it('frost extendido (>24h bajo 0°C) → danger por hielo', async () => {
    const tempBelowZero = Array(25).fill(-2);
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [3],
        PRECTOTCORR: [0],
        T2M: tempBelowZero,
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate(BASE_INPUT);
    expect(result.status).toBe('danger');
    expect(result.reasons.some((r) => r.category === 'frost' && r.level === 'danger')).toBe(true);
    expect(result.metrics.frostHourCount).toBe(25);
  });

  it('evento EONET activo → danger sin importar el resto', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [3],
        PRECTOTCORR: [0],
        T2M: [15],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([
      {
        id: 'EONET_12345',
        title: 'Wildfire Cordillera',
        categories: [{ id: 'wildfires', title: 'Wildfires' }],
        geometry: [{ date: '2026-05-15T00:00:00Z', type: 'Point', coordinates: [-70.5, -33.5] }],
        sources: [],
        link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_12345',
        closed: null,
        description: '',
      } as any,
    ]);

    const result = await assessRouteClimate(BASE_INPUT);
    expect(result.status).toBe('danger');
    expect(result.reasons.some((r) => r.category === 'active_event')).toBe(true);
    expect(result.activeEvents.length).toBe(1);
  });

  it('NASA POWER caído → degrada gracefully (no error a la UI)', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockRejectedValue(
      new Error('NASA POWER upstream 503'),
    );
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate(BASE_INPUT);
    // Sin NASA + sin pasos = safe (no hay evidencia de problema).
    expect(result.status).toBe('safe');
    expect(result.metrics.avgWindMs).toBeNull();
  });

  it('EONET caído → degrada gracefully', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [3],
        PRECTOTCORR: [0],
        T2M: [15],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockRejectedValue(new Error('EONET down'));

    const result = await assessRouteClimate(BASE_INPUT);
    expect(result.status).toBe('safe');
    expect(result.activeEvents).toEqual([]);
    expect(result.metrics.activeEventCount).toBe(0);
  });

  it('ruta >200km marca warning por distance_duration', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({ WS10M: [3], PRECTOTCORR: [0], T2M: [15] }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate({
      ...BASE_INPUT,
      totalDistanceM: 300_000,
      totalDurationS: 4 * 3600,
    });
    expect(result.status).toBe('warning');
    expect(
      result.reasons.some((r) => r.category === 'distance_duration'),
    ).toBe(true);
  });

  it('reasons combinan: paso + viento → status warning (no escala a danger)', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [9, 10],
        PRECTOTCORR: [5],
        T2M: [10],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate({
      ...BASE_INPUT,
      summary: 'Cuesta La Dormida',
    });
    expect(result.status).toBe('warning');
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('danger wins sobre warning', async () => {
    vi.mocked(nasaPowerAdapter.fetchAggregated).mockResolvedValue({
      series: makeNasaSeries({
        WS10M: [16], // → danger
        PRECTOTCORR: [25], // → warning
        T2M: [10],
      }),
      aggregates: [],
    });
    vi.mocked(eonetAdapter.fetchEvents).mockResolvedValue([]);

    const result = await assessRouteClimate(BASE_INPUT);
    expect(result.status).toBe('danger');
  });
});
