import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Round 18 (R6) — orchestratorService weather mock honesty.
 *
 * R4 R17 made the OpenWeatherMap success path return null airQuality
 * and null altitude when the upstream APIs cannot answer. The mock
 * fallback used when `VITE_OPENWEATHER_API_KEY` is missing was still
 * fabricating numbers (24°C, 55 km/h, AQI "Moderada", altitude
 * 1200 m, "Faena Minera"). These tests pin the new contract:
 *
 *   1. when the key is missing, `fetchWeatherData` returns a payload
 *      where every measurable field is `null`/`undefined`,
 *   2. the payload carries `unavailable: true` so consumers can
 *      render an honest empty-state banner instead of plotting
 *      fictional telemetry,
 *   3. NO fictional numeric value (24, 45, 55, 1200, 8) ever leaks
 *      from the mock,
 *   4. NO fictional string ('Soleado', 'Moderada', 'Faena Minera')
 *      ever leaks from the mock.
 *
 * The function under test is module-private; we cover it through the
 * exported `fetchWeatherData` entry-point with `VITE_OPENWEATHER_API_KEY`
 * stubbed to an empty string. Module is dynamic-imported per test so
 * the env stub is observed at module-load time.
 */

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('orchestratorService.fetchWeatherData — empty-state when key missing', () => {
  it('returns unavailable:true when VITE_OPENWEATHER_API_KEY is empty', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.unavailable).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null for every measurable field (no fabricated numbers)', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn());

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.temp).toBeNull();
    expect(data.condition).toBeNull();
    expect(data.humidity).toBeNull();
    expect(data.uv).toBeNull();
    expect(data.airQuality).toBeNull();
    expect(data.altitude).toBeNull();
    expect(data.location).toBeNull();
    expect(data.windSpeed).toBeUndefined();
    expect(data.sunrise).toBeUndefined();
    expect(data.sunset).toBeUndefined();
  });

  it('NEVER returns the legacy fictional values (24, 45, 55, 1200, 8)', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn());

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    // Pre-R18 the mock returned: temp=24, humidity=45, windSpeed=55,
    // altitude=1200, uv=8. These specific numbers must not surface.
    const numericFields = [data.temp, data.humidity, data.windSpeed, data.altitude, data.uv];
    for (const value of numericFields) {
      expect(value).not.toBe(24);
      expect(value).not.toBe(45);
      expect(value).not.toBe(55);
      expect(value).not.toBe(1200);
      expect(value).not.toBe(8);
    }
  });

  it('NEVER returns the legacy fictional strings ("Soleado","Moderada","Faena Minera")', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn());

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.condition).not.toBe('Soleado');
    expect(data.airQuality).not.toBe('Moderada');
    expect(data.location).not.toBe('Faena Minera');
  });

  it('returns an empty recommendations array (no hard-coded SST advice)', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn());

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    // Pre-R18 the mock injected "Uso obligatorio de bloqueador solar
    // FPS 50+", "Hidratación cada 45 minutos", "Precaución con polvo
    // en suspensión" — these were sourced from imagination, not from
    // any real OpenWeather response. The honest mock has none.
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(data.recommendations).toHaveLength(0);
  });

  it('falls back to the same unavailable payload when the upstream fetch throws', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.unavailable).toBe(true);
    expect(data.temp).toBeNull();
    expect(data.condition).toBeNull();
    expect(data.airQuality).toBeNull();
  });
});
