// Praeventio Guard — weatherGate unit tests (TDD RED 2026-06-10).
//
// Server-side wind verification for critical work permits. The
// validate-critical endpoint used to trust `windSpeedMps` declared by the
// CLIENT, making the DS 132 / ISO 12480 wind thresholds (11/15 m/s) decorative
// when the requester lies. weatherGate resolves an independent server-side
// wind sample (via the injected forecast fetcher — the real one is
// environmentBackend.getForecast, an OpenWeather aggregation that returns
// ClimateForecastDay[] with windKmh = max km/h of the day, [] on failure) and
// merges it with the declared value under a fail-safe policy:
//   effective = max(client ?? 0, server) whenever server data exists.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveServerWind,
  resolveServerWindWithTimeout,
  mergeWindForValidation,
  WIND_DISCREPANCY_THRESHOLD_MPS,
  WIND_UNVERIFIED_NOTE_ES,
  type WeatherGateDeps,
  type ServerWind,
} from './weatherGate.js';

const GEO = { lat: -33.45, lng: -70.66 };

function depsReturning(days: Array<{ windKmh?: number }>): WeatherGateDeps {
  return { fetchForecast: vi.fn(async () => days) };
}

afterEach(() => {
  vi.useRealTimers();
});

// ── resolveServerWind ─────────────────────────────────────────────────

describe('resolveServerWind', () => {
  it('converts day-0 windKmh (km/h) to m/s and reports openweather source', async () => {
    const deps = depsReturning([{ windKmh: 57.6 }]); // 57.6 km/h = 16 m/s
    const wind = await resolveServerWind(deps, GEO);
    expect(wind).toEqual({ windSpeedMps: 16, source: 'openweather' });
    expect(deps.fetchForecast).toHaveBeenCalledWith(1, GEO);
  });

  it('returns unavailable when the forecast is empty (getForecast degrades to [])', async () => {
    const wind = await resolveServerWind(depsReturning([]), GEO);
    expect(wind).toEqual({ windSpeedMps: null, source: 'unavailable' });
  });

  it('returns unavailable when day-0 has no windKmh field', async () => {
    const wind = await resolveServerWind(depsReturning([{}]), GEO);
    expect(wind).toEqual({ windSpeedMps: null, source: 'unavailable' });
  });

  it('returns unavailable when windKmh is not a finite number', async () => {
    const wind = await resolveServerWind(
      depsReturning([{ windKmh: Number.NaN }]),
      GEO,
    );
    expect(wind).toEqual({ windSpeedMps: null, source: 'unavailable' });
  });

  it('returns unavailable (never throws) when the fetcher rejects', async () => {
    const deps: WeatherGateDeps = {
      fetchForecast: vi.fn(async () => {
        throw new Error('upstream down');
      }),
    };
    const wind = await resolveServerWind(deps, GEO);
    expect(wind).toEqual({ windSpeedMps: null, source: 'unavailable' });
  });
});

// ── resolveServerWindWithTimeout ──────────────────────────────────────

describe('resolveServerWindWithTimeout', () => {
  it('resolves normally when the fetcher answers before the deadline', async () => {
    const wind = await resolveServerWindWithTimeout(
      depsReturning([{ windKmh: 36 }]),
      GEO,
      3000,
    );
    expect(wind).toEqual({ windSpeedMps: 10, source: 'openweather' });
  });

  it('degrades to unavailable when the fetcher hangs past the deadline (never blocks the endpoint)', async () => {
    vi.useFakeTimers();
    const deps: WeatherGateDeps = {
      fetchForecast: vi.fn(
        () => new Promise(() => undefined), // hangs forever
      ),
    };
    const pending = resolveServerWindWithTimeout(deps, GEO, 3000);
    await vi.advanceTimersByTimeAsync(3001);
    await expect(pending).resolves.toEqual({
      windSpeedMps: null,
      source: 'unavailable',
    });
  });
});

// ── mergeWindForValidation ────────────────────────────────────────────

describe('mergeWindForValidation', () => {
  const server16: ServerWind = { windSpeedMps: 16, source: 'openweather' };
  const serverDown: ServerWind = { windSpeedMps: null, source: 'unavailable' };

  it('honest client close to server → effective = max, no discrepancy', () => {
    const merged = mergeWindForValidation(15.5, server16);
    expect(merged.effectiveWindMps).toBe(16);
    expect(merged.discrepancy).toBe(false);
    expect(merged.serverWindMps).toBe(16);
    expect(merged.clientWindMps).toBe(15.5);
    expect(merged.source).toBe('openweather');
    expect(merged.note).toBeUndefined();
  });

  it('client under-reports by ≥2 m/s → effective = server + discrepancy flagged', () => {
    const merged = mergeWindForValidation(5, server16);
    expect(merged.effectiveWindMps).toBe(16); // max(5, 16)
    expect(merged.discrepancy).toBe(true);
  });

  it(`discrepancy threshold is exactly ${WIND_DISCREPANCY_THRESHOLD_MPS} m/s under server`, () => {
    expect(mergeWindForValidation(14.1, server16).discrepancy).toBe(false);
    expect(mergeWindForValidation(14, server16).discrepancy).toBe(true);
  });

  it('client declares HIGHER than server → effective keeps the worst case (client), no discrepancy', () => {
    const merged = mergeWindForValidation(20, server16);
    expect(merged.effectiveWindMps).toBe(20);
    expect(merged.discrepancy).toBe(false);
  });

  it('no client value but server available → effective = server, no discrepancy', () => {
    const merged = mergeWindForValidation(null, server16);
    expect(merged.effectiveWindMps).toBe(16); // max(0, 16)
    expect(merged.discrepancy).toBe(false);
    expect(merged.clientWindMps).toBeNull();
  });

  it('server unavailable → effective = client declared value + es-CL advisory note', () => {
    const merged = mergeWindForValidation(5, serverDown);
    expect(merged.effectiveWindMps).toBe(5);
    expect(merged.discrepancy).toBe(false);
    expect(merged.serverWindMps).toBeNull();
    expect(merged.source).toBe('unavailable');
    expect(merged.note).toBe(WIND_UNVERIFIED_NOTE_ES);
  });

  it('server unavailable and no client value → effective null + advisory note', () => {
    const merged = mergeWindForValidation(undefined, serverDown);
    expect(merged.effectiveWindMps).toBeNull();
    expect(merged.note).toBe(WIND_UNVERIFIED_NOTE_ES);
  });

  it('non-finite / negative client values are treated as undeclared', () => {
    expect(mergeWindForValidation(Number.NaN, server16).clientWindMps).toBeNull();
    expect(mergeWindForValidation(-3, server16).clientWindMps).toBeNull();
    expect(mergeWindForValidation(-3, server16).effectiveWindMps).toBe(16);
  });
});
