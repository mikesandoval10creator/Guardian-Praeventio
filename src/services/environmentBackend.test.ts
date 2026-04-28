import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for environmentBackend.getForecast.
 *
 * The function hits OpenWeather's `/forecast` endpoint (5-day / 3-hour-step,
 * free tier) and aggregates the 3-hour buckets into per-day ClimateForecastDay
 * entries.
 *
 * Aggregation rules pinned by these tests:
 *   - conditionCode: worst-case across the day's 3-hour buckets, ranked
 *     stormy > rainy > windy > cold-snap > extreme-heat > snow > sunny.
 *   - temperatureC: max across the day (worst-case for heat-stress checks).
 *   - windKmh:      max across the day.
 *   - precipMm:     sum across the day.
 *
 * Tests use vi.stubGlobal('fetch', ...) to intercept network calls and
 * vi.stubEnv to control the OPENWEATHER_API_KEY env var. The module is
 * dynamic-imported per test so env stubbing happens before the module reads
 * `process.env.OPENWEATHER_API_KEY`.
 */

type OWForecastItem = {
  dt: number; // unix seconds (UTC)
  main: { temp: number };
  weather: Array<{ id: number; description?: string }>;
  wind?: { speed?: number }; // m/s
  rain?: { '3h'?: number }; // mm
  snow?: { '3h'?: number };
};

function buildItem(opts: {
  isoUtc: string;
  temp: number;
  weatherId: number;
  windMs?: number;
  rain3h?: number;
  snow3h?: number;
}): OWForecastItem {
  return {
    dt: Math.floor(new Date(opts.isoUtc).getTime() / 1000),
    main: { temp: opts.temp },
    weather: [{ id: opts.weatherId, description: 'desc' }],
    wind: opts.windMs != null ? { speed: opts.windMs } : undefined,
    rain: opts.rain3h != null ? { '3h': opts.rain3h } : undefined,
    snow: opts.snow3h != null ? { '3h': opts.snow3h } : undefined,
  };
}

/** Build a 5-day x 8-step (every 3h) sample, all sunny + 20°C unless overridden. */
function buildFiveDaySample(overrides: Record<string, OWForecastItem[]> = {}) {
  const list: OWForecastItem[] = [];
  // Day labels are UTC ISO date prefixes 2026-05-01 .. 2026-05-05.
  const days = [
    '2026-05-01',
    '2026-05-02',
    '2026-05-03',
    '2026-05-04',
    '2026-05-05',
  ];
  const hours = ['00', '03', '06', '09', '12', '15', '18', '21'];
  for (const d of days) {
    if (overrides[d]) {
      list.push(...overrides[d]);
      continue;
    }
    for (const h of hours) {
      list.push(
        buildItem({
          isoUtc: `${d}T${h}:00:00Z`,
          temp: 20,
          weatherId: 800, // clear
          windMs: 2,
          rain3h: 0,
        }),
      );
    }
  }
  return { list, city: { timezone: 0 } };
}

function mockFetchOk(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function mockFetchThrows() {
  return vi.fn(async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('OPENWEATHER_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getForecast — happy path', () => {
  it('returns 3 entries when called with days=3 and upstream returns a full 5-day sample', async () => {
    vi.stubGlobal('fetch', mockFetchOk(buildFiveDaySample()));
    const { getForecast } = await import('./environmentBackend');
    const result = await getForecast(3);
    expect(result).toHaveLength(3);
    for (const day of result) {
      expect(day.date).toBeInstanceOf(Date);
      expect(typeof day.temperatureC).toBe('number');
      expect(day.conditionCode).toBe('sunny');
    }
  });

  it('day aggregation: worst-case condition wins (one rainy step beats four sunny)', async () => {
    const sample = buildFiveDaySample({
      '2026-05-01': [
        buildItem({ isoUtc: '2026-05-01T00:00:00Z', temp: 18, weatherId: 800 }),
        buildItem({ isoUtc: '2026-05-01T06:00:00Z', temp: 19, weatherId: 800 }),
        buildItem({ isoUtc: '2026-05-01T12:00:00Z', temp: 22, weatherId: 500, rain3h: 2 }), // rainy
        buildItem({ isoUtc: '2026-05-01T18:00:00Z', temp: 20, weatherId: 800 }),
        buildItem({ isoUtc: '2026-05-01T21:00:00Z', temp: 17, weatherId: 800 }),
      ],
    });
    vi.stubGlobal('fetch', mockFetchOk(sample));
    const { getForecast } = await import('./environmentBackend');
    const result = await getForecast(1);
    expect(result).toHaveLength(1);
    expect(result[0].conditionCode).toBe('rainy');
  });

  it('temperatureC is the max across the day buckets', async () => {
    const sample = buildFiveDaySample({
      '2026-05-01': [
        buildItem({ isoUtc: '2026-05-01T00:00:00Z', temp: 10, weatherId: 800 }),
        buildItem({ isoUtc: '2026-05-01T12:00:00Z', temp: 33, weatherId: 800 }),
        buildItem({ isoUtc: '2026-05-01T18:00:00Z', temp: 25, weatherId: 800 }),
      ],
    });
    vi.stubGlobal('fetch', mockFetchOk(sample));
    const { getForecast } = await import('./environmentBackend');
    const [day] = await getForecast(1);
    expect(day.temperatureC).toBe(33);
  });

  it('windKmh is max across the day, converted from m/s to km/h', async () => {
    const sample = buildFiveDaySample({
      '2026-05-01': [
        buildItem({ isoUtc: '2026-05-01T00:00:00Z', temp: 18, weatherId: 800, windMs: 1 }),
        buildItem({ isoUtc: '2026-05-01T12:00:00Z', temp: 22, weatherId: 800, windMs: 10 }), // 36 km/h
        buildItem({ isoUtc: '2026-05-01T18:00:00Z', temp: 20, weatherId: 800, windMs: 5 }),
      ],
    });
    vi.stubGlobal('fetch', mockFetchOk(sample));
    const { getForecast } = await import('./environmentBackend');
    const [day] = await getForecast(1);
    expect(day.windKmh).toBe(36);
  });

  it('precipMm is the sum across the day buckets (rain + snow)', async () => {
    const sample = buildFiveDaySample({
      '2026-05-01': [
        buildItem({ isoUtc: '2026-05-01T00:00:00Z', temp: 5, weatherId: 500, rain3h: 1.5 }),
        buildItem({ isoUtc: '2026-05-01T12:00:00Z', temp: 6, weatherId: 500, rain3h: 2.5 }),
        buildItem({ isoUtc: '2026-05-01T18:00:00Z', temp: 4, weatherId: 600, snow3h: 1 }),
      ],
    });
    vi.stubGlobal('fetch', mockFetchOk(sample));
    const { getForecast } = await import('./environmentBackend');
    const [day] = await getForecast(1);
    expect(day.precipMm).toBe(5);
  });
});

describe('getForecast — weather code mapping', () => {
  // Each test isolates a single day with one item carrying a target weather id,
  // and asserts the resulting conditionCode after aggregation.
  async function conditionFor(weatherId: number, extras: Partial<{ temp: number; rain: number; snow: number; wind: number }> = {}) {
    const sample = {
      list: [
        buildItem({
          isoUtc: '2026-05-01T12:00:00Z',
          temp: extras.temp ?? 20,
          weatherId,
          rain3h: extras.rain,
          snow3h: extras.snow,
          windMs: extras.wind,
        }),
      ],
      city: { timezone: 0 },
    };
    vi.stubGlobal('fetch', mockFetchOk(sample));
    const { getForecast } = await import('./environmentBackend');
    const [day] = await getForecast(1);
    return day.conditionCode;
  }

  it('maps 200 (thunderstorm) → "stormy"', async () => {
    expect(await conditionFor(200)).toBe('stormy');
  });

  it('maps 500 (rain) → "rainy"', async () => {
    expect(await conditionFor(500)).toBe('rainy');
  });

  it('maps 300 (drizzle) → "rainy"', async () => {
    expect(await conditionFor(300)).toBe('rainy');
  });

  it('maps 600 (snow) → "snow"', async () => {
    expect(await conditionFor(600)).toBe('snow');
  });

  it('maps 800 (clear) → "sunny"', async () => {
    expect(await conditionFor(800)).toBe('sunny');
  });

  it('maps 803 (clouds) → "sunny" (we treat clouds as benign; no risk uplift)', async () => {
    expect(await conditionFor(803)).toBe('sunny');
  });

  it('promotes hot clear day to "extreme-heat" when temperatureC ≥ 35', async () => {
    expect(await conditionFor(800, { temp: 36 })).toBe('extreme-heat');
  });

  it('promotes cold clear day to "cold-snap" when temperatureC ≤ 0', async () => {
    expect(await conditionFor(800, { temp: -2 })).toBe('cold-snap');
  });

  it('promotes high-wind clear day to "windy" when windKmh ≥ 40', async () => {
    expect(await conditionFor(800, { wind: 12 })).toBe('windy'); // 12 m/s = 43.2 km/h
  });
});

describe('getForecast — degradation', () => {
  it('returns [] when OPENWEATHER_API_KEY is missing and does not call fetch', async () => {
    vi.stubEnv('OPENWEATHER_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { getForecast } = await import('./environmentBackend');
    const result = await getForecast(3);
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns [] when fetch throws', async () => {
    vi.stubGlobal('fetch', mockFetchThrows());
    const { getForecast } = await import('./environmentBackend');
    const result = await getForecast(3);
    expect(result).toEqual([]);
  });

  it('returns [] when upstream responds non-OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch,
    );
    const { getForecast } = await import('./environmentBackend');
    const result = await getForecast(3);
    expect(result).toEqual([]);
  });
});

describe('getForecast — input clamping', () => {
  it('clamps days > 5 to at most 5 entries', async () => {
    vi.stubGlobal('fetch', mockFetchOk(buildFiveDaySample()));
    const { getForecast } = await import('./environmentBackend');
    const result = await getForecast(10);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('returns [] when days <= 0', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { getForecast } = await import('./environmentBackend');
    const result = await getForecast(0);
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('getForecast — location parameter', () => {
  it('defaults to Santiago de Chile coords when no location given', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => buildFiveDaySample() })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);
    const { getForecast } = await import('./environmentBackend');
    await getForecast(1);
    const url = String((fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('lat=-33.4489');
    expect(url).toContain('lon=-70.6693');
  });

  it('honours a caller-supplied { lat, lng } override', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => buildFiveDaySample() })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);
    const { getForecast } = await import('./environmentBackend');
    await getForecast(1, { lat: 51.5074, lng: -0.1278 });
    const url = String((fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('lat=51.5074');
    expect(url).toContain('lon=-0.1278');
  });
});
