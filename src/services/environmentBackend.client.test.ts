import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the browser-safe `environmentBackend` client. Pins:
 *
 *   1. When `VITE_OPENWEATHER_API_KEY` is unset, `getCurrentWeather` returns
 *      `{ unavailable: true, …zeroed values }` and DOES NOT call fetch.
 *   2. Happy path converts OpenWeather's `wind.speed` (m/s) → km/h (×3.6)
 *      and flips `wind.deg` (FROM convention) by 180° to "TO" convention
 *      with [0, 360) normalisation.
 *   3. HTTP errors / malformed JSON / fetch throws all degrade to
 *      `unavailable: true` — we NEVER throw, because the pages call this
 *      in a useEffect.
 *
 * Each test dynamic-imports the module after stubbing env so the env stub
 * is observed at module-load time. We also reset between tests so each
 * test starts from a clean state.
 */

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('environmentBackend.client.getCurrentWeather', () => {
  it('returns unavailable when VITE_OPENWEATHER_API_KEY is missing', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await import('./environmentBackend.client');
    const result = await mod.getCurrentWeather({ lat: -33, lng: -70 });

    expect(result.unavailable).toBe(true);
    expect(result.windSpeedKmh).toBe(0);
    expect(result.windDirectionDeg).toBe(0);
    expect(result.location).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('converts wind.speed m/s → km/h and flips wind.deg by 180° (TO convention)', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'fake-key');
    // OpenWeather: wind blowing FROM 90° (East). speed 10 m/s.
    // Expected output: TO = (90 + 180) mod 360 = 270°, speed = 10 * 3.6 = 36 km/h.
    const okPayload = { wind: { speed: 10, deg: 90 }, name: 'Test City' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okPayload),
      }),
    );

    const mod = await import('./environmentBackend.client');
    const result = await mod.getCurrentWeather({ lat: -33, lng: -70 });

    expect(result.unavailable).toBe(false);
    expect(result.windSpeedKmh).toBe(36);
    expect(result.windDirectionDeg).toBe(270);
    expect(result.location).toBe('Test City');
  });

  it('normalises wind.deg above 360 (e.g. 350 + 180 = 530 → 170°)', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'fake-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ wind: { speed: 5, deg: 350 }, name: 'X' }),
      }),
    );

    const mod = await import('./environmentBackend.client');
    const result = await mod.getCurrentWeather({ lat: 0, lng: 0 });

    expect(result.windDirectionDeg).toBe(170);
  });

  it('returns unavailable when upstream returns non-OK status', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'fake-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    );

    const mod = await import('./environmentBackend.client');
    const result = await mod.getCurrentWeather({ lat: -33, lng: -70 });

    expect(result.unavailable).toBe(true);
  });

  it('returns unavailable when fetch throws (network error)', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'fake-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    const mod = await import('./environmentBackend.client');
    const result = await mod.getCurrentWeather({ lat: -33, lng: -70 });

    expect(result.unavailable).toBe(true);
  });

  it('returns unavailable when response is missing wind data', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'fake-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ name: 'No wind here' }),
      }),
    );

    const mod = await import('./environmentBackend.client');
    const result = await mod.getCurrentWeather({ lat: -33, lng: -70 });

    expect(result.unavailable).toBe(true);
  });

  it('returns unavailable when given NaN coordinates', async () => {
    vi.stubEnv('VITE_OPENWEATHER_API_KEY', 'fake-key');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await import('./environmentBackend.client');
    const result = await mod.getCurrentWeather({ lat: NaN, lng: -70 });

    expect(result.unavailable).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
