import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NasaPowerAdapter,
  aggregateSeries,
  computeDateWindow,
  nasaKeyToIso,
} from './nasaPowerAdapter.js';
import type { ClimateTimeSeries } from './types.js';

/**
 * Fixture mínimo de respuesta NASA POWER. Replica el shape real
 * documentado en https://power.larc.nasa.gov/docs/services/api/temporal/hourly/
 */
function makeNasaResponse(samples: {
  T2M?: Record<string, number>;
  WS10M?: Record<string, number>;
  PRECTOTCORR?: Record<string, number>;
  RH2M?: Record<string, number>;
  WD10M?: Record<string, number>;
}): unknown {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-70.66, -33.45, 575] },
    properties: {
      parameter: {
        T2M: samples.T2M ?? {},
        WS10M: samples.WS10M ?? {},
        PRECTOTCORR: samples.PRECTOTCORR ?? {},
        RH2M: samples.RH2M ?? {},
        WD10M: samples.WD10M ?? {},
      },
    },
    header: {
      title: 'NASA POWER Test',
      fill_value: -999,
    },
    messages: [],
  };
}

function mockFetch(response: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('nasaKeyToIso', () => {
  it('formato YYYYMMDDHH a ISO UTC', () => {
    expect(nasaKeyToIso('2026051512')).toBe('2026-05-15T12:00:00Z');
  });

  it('formato YYYYMMDD a ISO UTC (daily endpoint)', () => {
    expect(nasaKeyToIso('20260515')).toBe('2026-05-15T00:00:00Z');
  });

  it('formato desconocido se devuelve crudo (fail-soft)', () => {
    expect(nasaKeyToIso('2026-05-15')).toBe('2026-05-15');
  });

  it('hora 00 → 00:00:00Z', () => {
    expect(nasaKeyToIso('2026010100')).toBe('2026-01-01T00:00:00Z');
  });

  it('hora 23 → 23:00:00Z', () => {
    expect(nasaKeyToIso('2026123123')).toBe('2026-12-31T23:00:00Z');
  });
});

describe('computeDateWindow', () => {
  // NASA POWER trata start/end como INCLUSIVE calendar days. Una ventana
  // de N días → start = end - (N-1) días. Codex fix PR #279.
  it('respeta el lag de 4 días desde now', () => {
    const fakeNow = () => Date.UTC(2026, 4, 16, 12, 0, 0); // 2026-05-16 12:00 UTC
    const { start, end } = computeDateWindow(7, fakeNow);
    // end = 2026-05-16 - 4 días = 2026-05-12
    expect(end).toBe('20260512');
    // start = end - 6 días (= 7 días inclusive incl. end) = 2026-05-06
    expect(start).toBe('20260506');
  });

  it('daysBack 1 → start === end (mismo día inclusivo)', () => {
    const fakeNow = () => Date.UTC(2026, 4, 16, 12, 0, 0);
    const { start, end } = computeDateWindow(1, fakeNow);
    expect(end).toBe('20260512');
    expect(start).toBe('20260512');
  });

  it('daysBack 30 → 30 días inclusivos', () => {
    const fakeNow = () => Date.UTC(2026, 4, 16, 12, 0, 0);
    const { start, end } = computeDateWindow(30, fakeNow);
    expect(end).toBe('20260512');
    // 2026-05-12 - 29 días = 2026-04-13
    expect(start).toBe('20260413');
  });
});

describe('aggregateSeries', () => {
  function makeSeries(values: Array<number | null>): ClimateTimeSeries {
    const samples = new Map<string, number | null>();
    values.forEach((v, i) => samples.set(`2026-05-15T${String(i).padStart(2, '0')}:00:00Z`, v));
    return { parameter: 'T2M', unit: '°C', samples };
  }

  it('mean/min/max/sum sobre valores no-null', () => {
    const s = makeSeries([10, 15, 20, 5, 12]);
    const agg = aggregateSeries(s);
    expect(agg.count).toBe(5);
    expect(agg.mean).toBe(62 / 5);
    expect(agg.min).toBe(5);
    expect(agg.max).toBe(20);
    expect(agg.sum).toBe(62);
  });

  it('ignora samples null (NASA fill_value)', () => {
    const s = makeSeries([10, null, 20, null, 12]);
    const agg = aggregateSeries(s);
    expect(agg.count).toBe(3);
    expect(agg.mean).toBe(42 / 3);
    expect(agg.min).toBe(10);
    expect(agg.max).toBe(20);
    expect(agg.sum).toBe(42);
  });

  it('todos null → todos los agregados null', () => {
    const s = makeSeries([null, null, null]);
    const agg = aggregateSeries(s);
    expect(agg.count).toBe(0);
    expect(agg.mean).toBeNull();
    expect(agg.min).toBeNull();
    expect(agg.max).toBeNull();
    expect(agg.sum).toBeNull();
  });

  it('serie vacía → todos null', () => {
    const s: ClimateTimeSeries = { parameter: 'T2M', unit: '°C', samples: new Map() };
    const agg = aggregateSeries(s);
    expect(agg.count).toBe(0);
    expect(agg.mean).toBeNull();
  });
});

describe('NasaPowerAdapter — fetchClimate', () => {
  let fakeNow: () => number;

  beforeEach(() => {
    fakeNow = () => Date.UTC(2026, 4, 16, 12, 0, 0);
  });

  it('parsea respuesta válida y devuelve series tipadas', async () => {
    const fetch = mockFetch(
      makeNasaResponse({
        T2M: { '2026051200': 12.5, '2026051201': 12.0, '2026051202': 11.8 },
        WS10M: { '2026051200': 5.2, '2026051201': 5.5, '2026051202': 6.1 },
      }),
    );
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    const series = await adapter.fetchClimate({
      latitude: -33.45,
      longitude: -70.66,
      parameters: ['T2M', 'WS10M'],
    });

    expect(series.length).toBe(2);
    expect(series[0]!.parameter).toBe('T2M');
    expect(series[0]!.samples.get('2026-05-12T00:00:00Z')).toBe(12.5);
    expect(series[1]!.parameter).toBe('WS10M');
    expect(series[1]!.samples.get('2026-05-12T02:00:00Z')).toBe(6.1);
  });

  it('normaliza fill_value (-999) a null', async () => {
    const fetch = mockFetch(
      makeNasaResponse({
        T2M: { '2026051200': 12.5, '2026051201': -999, '2026051202': 11.8 },
      }),
    );
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    const series = await adapter.fetchClimate({
      latitude: -33.45,
      longitude: -70.66,
      parameters: ['T2M'],
    });
    expect(series[0]!.samples.get('2026-05-12T01:00:00Z')).toBeNull();
    expect(series[0]!.samples.get('2026-05-12T00:00:00Z')).toBe(12.5);
  });

  it('cache funciona — segunda call NO hace HTTP', async () => {
    const fetch = mockFetch(makeNasaResponse({ T2M: { '2026051200': 10 } }));
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    await adapter.fetchClimate({ latitude: -33.45, longitude: -70.66, parameters: ['T2M'] });
    await adapter.fetchClimate({ latitude: -33.45, longitude: -70.66, parameters: ['T2M'] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cache expira después del TTL', async () => {
    let currentMs = Date.UTC(2026, 4, 16, 12, 0, 0);
    const movingNow = () => currentMs;
    const fetch = mockFetch(makeNasaResponse({ T2M: { '2026051200': 10 } }));
    const adapter = new NasaPowerAdapter({
      httpClient: fetch,
      now: movingNow,
      cacheTtlMs: 1000,
    });
    await adapter.fetchClimate({ latitude: -33.45, longitude: -70.66, parameters: ['T2M'] });
    currentMs += 2000; // pasa el TTL
    await adapter.fetchClimate({ latitude: -33.45, longitude: -70.66, parameters: ['T2M'] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retry 2× con backoff exponencial en error 500', async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        return new Response('upstream down', { status: 500 });
      }
      return new Response(JSON.stringify(makeNasaResponse({ T2M: { '2026051200': 10 } })), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    const series = await adapter.fetchClimate({
      latitude: -33.45,
      longitude: -70.66,
      parameters: ['T2M'],
    });
    expect(series.length).toBe(1);
    expect(calls).toBe(3);
  });

  it('lanza tras 3 fallos consecutivos', async () => {
    const fetch = vi.fn(async () =>
      new Response('down', { status: 500 }),
    ) as unknown as typeof fetch;
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    await expect(
      adapter.fetchClimate({ latitude: -33.45, longitude: -70.66, parameters: ['T2M'] }),
    ).rejects.toThrow(/NASA POWER upstream 500/);
  });

  it('4xx no se retry-ea, falla inmediato', async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      return new Response('bad request', { status: 400 });
    }) as unknown as typeof fetch;
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    await expect(
      adapter.fetchClimate({ latitude: -33.45, longitude: -70.66, parameters: ['T2M'] }),
    ).rejects.toThrow(/NASA POWER request failed: 400/);
    // 4xx no entra a retry — falla en attempt 0
    expect(calls).toBe(1);
  });

  it('valida coordenadas — latitude inválida lanza RangeError', async () => {
    const adapter = new NasaPowerAdapter({ httpClient: mockFetch({}), now: fakeNow });
    await expect(
      adapter.fetchClimate({ latitude: 100, longitude: 0, parameters: ['T2M'] }),
    ).rejects.toThrow(/latitude inválida/);
  });

  it('valida coordenadas — longitude inválida lanza RangeError', async () => {
    const adapter = new NasaPowerAdapter({ httpClient: mockFetch({}), now: fakeNow });
    await expect(
      adapter.fetchClimate({ latitude: 0, longitude: 200, parameters: ['T2M'] }),
    ).rejects.toThrow(/longitude inválida/);
  });

  it('valida daysBack — 0 lanza RangeError', async () => {
    const adapter = new NasaPowerAdapter({ httpClient: mockFetch({}), now: fakeNow });
    await expect(
      adapter.fetchClimate({
        latitude: 0,
        longitude: 0,
        daysBack: 0,
        parameters: ['T2M'],
      }),
    ).rejects.toThrow(/daysBack debe estar 1-90/);
  });

  it('valida daysBack — 91 lanza RangeError', async () => {
    const adapter = new NasaPowerAdapter({ httpClient: mockFetch({}), now: fakeNow });
    await expect(
      adapter.fetchClimate({
        latitude: 0,
        longitude: 0,
        daysBack: 91,
        parameters: ['T2M'],
      }),
    ).rejects.toThrow(/daysBack debe estar 1-90/);
  });

  it('fetchAggregated devuelve series + aggregates', async () => {
    const fetch = mockFetch(
      makeNasaResponse({
        T2M: { '2026051200': 10, '2026051201': 20, '2026051202': 15 },
        WS10M: { '2026051200': 5, '2026051201': 8 },
      }),
    );
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    const result = await adapter.fetchAggregated({
      latitude: -33.45,
      longitude: -70.66,
      parameters: ['T2M', 'WS10M'],
    });
    expect(result.series.length).toBe(2);
    expect(result.aggregates.length).toBe(2);
    expect(result.aggregates[0]!.mean).toBe(15); // (10+20+15)/3
    expect(result.aggregates[1]!.mean).toBe(6.5); // (5+8)/2
  });

  it('schema inválido lanza error tipado', async () => {
    const fetch = mockFetch({ not: 'a valid NASA response' });
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    await expect(
      adapter.fetchClimate({ latitude: 0, longitude: 0, parameters: ['T2M'] }),
    ).rejects.toThrow(/schema validation failed/);
  });

  it('clearCache permite forzar refetch', async () => {
    const fetch = mockFetch(makeNasaResponse({ T2M: { '2026051200': 10 } }));
    const adapter = new NasaPowerAdapter({ httpClient: fetch, now: fakeNow });
    await adapter.fetchClimate({ latitude: 0, longitude: 0, parameters: ['T2M'] });
    adapter.clearCache();
    await adapter.fetchClimate({ latitude: 0, longitude: 0, parameters: ['T2M'] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
