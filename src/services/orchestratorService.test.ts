import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * orchestratorService.fetchWeatherData — REAL weather contract.
 *
 * "Hacerlo honesto es hacerlo real": the weather reading is now sourced from
 * Open-Meteo (keyless, CORS-enabled), which returns a MEASURED `uv_index`.
 * The app no longer needs an OpenWeather key to show real telemetry, and UV
 * is never a fabricated constant or a labelled estimate when the real source
 * answers. OpenWeather (when keyed) only ENHANCES the city name / localized
 * condition / AQI. The honest `unavailable: true` empty-state is returned ONLY
 * when BOTH real sources are unreachable at runtime — never a fabricated value.
 *
 * These tests pin that contract:
 *   1. with NO OpenWeather key, Open-Meteo still yields real temp/humidity/
 *      wind + a REAL UV index (not null, not a constant);
 *   2. OpenWeather, when keyed, enhances location/condition while UV stays the
 *      Open-Meteo measurement;
 *   3. when BOTH sources are unreachable, every measurable field is null and
 *      `unavailable: true`;
 *   4. NO fabricated legacy value (24, 45, 55, 1200, 8 / 'Soleado' /
 *      'Moderada' / 'Faena Minera') ever leaks.
 *
 * The function is covered through the exported `fetchWeatherData`. `fetch` is
 * stubbed and routed by URL; the module is dynamic-imported per test so the
 * env stub is observed at module-load time.
 */

const METEO_OK = {
  current: {
    temperature_2m: 18.4,
    relative_humidity_2m: 62,
    wind_speed_10m: 14.2, // km/h (wind_speed_unit=kmh)
    uv_index: 4.7,
    weather_code: 2, // Parcialmente nublado
  },
  daily: {
    sunrise: ['2026-06-16T07:50'],
    sunset: ['2026-06-16T17:45'],
  },
};

const OW_OK = {
  main: { temp: 17, humidity: 58 },
  weather: [{ description: 'nubes dispersas' }],
  name: 'Santiago',
  wind: { speed: 3.2 }, // m/s
  sys: { sunrise: 1_718_537_400, sunset: 1_718_572_800 },
};

const AQI_OK = { list: [{ main: { aqi: 2 } }] }; // → 'Aceptable'

type Resp = { ok: boolean; status: number; json: () => Promise<unknown> };
const okResp = (body: unknown): Resp => ({ ok: true, status: 200, json: async () => body });
const failResp = (status = 503): Resp => ({ ok: false, status, json: async () => ({}) });

/** Route the stubbed fetch by URL. Pass 'fail' to simulate an unreachable source. */
function makeFetch(opts: {
  meteo?: unknown | 'fail';
  ow?: unknown | 'fail';
  aqi?: unknown | 'fail';
} = {}) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('api.open-meteo.com')) {
      return opts.meteo && opts.meteo !== 'fail' ? okResp(opts.meteo) : failResp();
    }
    if (u.includes('openweathermap.org/data/2.5/weather')) {
      return opts.ow && opts.ow !== 'fail' ? okResp(opts.ow) : failResp(401);
    }
    if (u.includes('air_pollution')) {
      return opts.aqi && opts.aqi !== 'fail' ? okResp(opts.aqi) : failResp(401);
    }
    return failResp(404);
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('orchestratorService.fetchWeatherData — real weather via Open-Meteo', () => {
  it('returns REAL telemetry (incl. a measured UV) with NO OpenWeather key', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    vi.stubGlobal('fetch', makeFetch({ meteo: METEO_OK }));

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.unavailable).toBeFalsy();
    expect(data.temp).toBe(18); // Math.round(18.4)
    expect(data.humidity).toBe(62);
    expect(data.windSpeed).toBe(14.2);
    expect(data.condition).toBe('Parcialmente nublado'); // WMO 2
    // The whole point: UV is the REAL measured value, not null and not a constant.
    expect(data.uv).toBe(4.7);
    expect(typeof data.sunrise).toBe('number');
    expect(typeof data.sunset).toBe('number');
    // No key → no city/AQI enhancer, surfaced honestly as null (not fabricated).
    expect(data.location).toBeNull();
    expect(data.airQuality).toBeNull();
  });

  it('uses Open-Meteo UV even when OpenWeather is keyed (UV is never from OW)', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'test-key');
    vi.stubGlobal('fetch', makeFetch({ meteo: METEO_OK, ow: OW_OK, aqi: AQI_OK }));

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.unavailable).toBeFalsy();
    expect(data.uv).toBe(4.7); // measurement from Open-Meteo, not OpenWeather
    expect(data.temp).toBe(18); // measurement preferred from Open-Meteo
    // OpenWeather ENHANCES the human-facing strings:
    expect(data.location).toBe('Santiago');
    expect(data.condition).toBe('nubes dispersas');
    expect(data.airQuality).toBe('Aceptable'); // AQI 2
  });

  it('falls back to OpenWeather as a full reading when Open-Meteo is unreachable', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'test-key');
    vi.stubGlobal('fetch', makeFetch({ meteo: 'fail', ow: OW_OK, aqi: AQI_OK }));

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.unavailable).toBeFalsy();
    expect(data.temp).toBe(17); // from OpenWeather
    expect(data.location).toBe('Santiago');
    // UV unavailable when the real (Open-Meteo) source is down — null, never faked.
    expect(data.uv).toBeNull();
  });

  it('returns unavailable:true with all-null measurements when BOTH sources fail', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    vi.stubGlobal('fetch', makeFetch({ meteo: 'fail' }));

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.unavailable).toBe(true);
    expect(data.temp).toBeNull();
    expect(data.condition).toBeNull();
    expect(data.humidity).toBeNull();
    expect(data.uv).toBeNull();
    expect(data.airQuality).toBeNull();
    expect(data.altitude).toBeNull();
    expect(data.location).toBeNull();
    expect(data.windSpeed).toBeUndefined();
  });

  it('also returns unavailable:true when the keyed upstreams all throw', async () => {
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
    expect(data.uv).toBeNull();
  });

  it('NEVER returns the legacy fabricated values (24, 45, 55, 1200, 8 / strings)', async () => {
    // Even on the honest empty-state path, no fictional number/string leaks.
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    vi.stubGlobal('fetch', makeFetch({ meteo: 'fail' }));

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    const numericFields = [data.temp, data.humidity, data.windSpeed, data.altitude, data.uv];
    for (const value of numericFields) {
      expect(value).not.toBe(24);
      expect(value).not.toBe(45);
      expect(value).not.toBe(55);
      expect(value).not.toBe(1200);
      expect(value).not.toBe(8);
    }
    expect(data.condition).not.toBe('Soleado');
    expect(data.airQuality).not.toBe('Moderada');
    expect(data.location).not.toBe('Faena Minera');
  });

  it('derives real SST recommendations from the real reading (heat + wind)', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    vi.stubGlobal(
      'fetch',
      makeFetch({
        meteo: {
          current: {
            temperature_2m: 33, // >30 → heat alert
            relative_humidity_2m: 20,
            wind_speed_10m: 45, // >40 → wind alert
            uv_index: 9.1,
            weather_code: 0,
          },
          daily: { sunrise: ['2026-06-16T07:50'], sunset: ['2026-06-16T17:45'] },
        },
      }),
    );

    const { fetchWeatherData } = await import('./orchestratorService');
    const data = await fetchWeatherData();

    expect(data.uv).toBe(9.1);
    expect(data.recommendations.some((r) => r.toLowerCase().includes('calor'))).toBe(true);
    expect(data.recommendations.some((r) => r.toLowerCase().includes('viento'))).toBe(true);
  });
});
