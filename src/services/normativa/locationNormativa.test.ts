/**
 * Tests for GPS-based country detection helpers.
 *
 * Pure-function TDD: bounding-box approximations from public country bbox data
 * (see src/services/normativa/locationNormativa.ts header for source citation).
 *
 * The async tests mock `globalThis.fetch` via `vi.stubGlobal` and toggle the
 * `VITE_GOOGLE_MAPS_API_KEY` env var with `vi.stubEnv`. The env var is read
 * at call time (not module load) so per-test stubbing takes effect without
 * needing a `vi.resetModules()` dance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countryFromCoords,
  countryFromCoordsAsync,
  countryFromLanguage,
  mapAlpha2ToCountryCode,
} from './locationNormativa';

describe('countryFromCoords — capital-city sanity checks', () => {
  it('Santiago de Chile → CL', () => {
    expect(countryFromCoords(-33.45, -70.66)).toBe('CL');
  });

  it('Lima → PE', () => {
    expect(countryFromCoords(-12.05, -77.04)).toBe('PE');
  });

  it('Bogotá → CO', () => {
    expect(countryFromCoords(4.71, -74.07)).toBe('CO');
  });

  it('CDMX → MX', () => {
    expect(countryFromCoords(19.43, -99.13)).toBe('MX');
  });

  it('Buenos Aires → AR', () => {
    expect(countryFromCoords(-34.61, -58.38)).toBe('AR');
  });

  it('São Paulo → BR', () => {
    expect(countryFromCoords(-23.55, -46.63)).toBe('BR');
  });

  it('Paris (out of LATAM bbox) → null', () => {
    expect(countryFromCoords(48.86, 2.35)).toBeNull();
  });

  it('NaN coordinates → null (documented behavior)', () => {
    expect(countryFromCoords(NaN, NaN)).toBeNull();
  });
});

describe('countryFromLanguage — navigator.language fallback', () => {
  it('es-CL → CL', () => {
    expect(countryFromLanguage('es-CL')).toBe('CL');
  });

  it('pt-BR → BR', () => {
    expect(countryFromLanguage('pt-BR')).toBe('BR');
  });

  it('en-US → ISO (fallback)', () => {
    expect(countryFromLanguage('en-US')).toBe('ISO');
  });

  it('undefined locale → ISO', () => {
    expect(countryFromLanguage(undefined as unknown as string)).toBe('ISO');
  });
});

describe('mapAlpha2ToCountryCode — ISO 3166-1 alpha-2 dispatch', () => {
  it('CL → CL', () => {
    expect(mapAlpha2ToCountryCode('CL')).toBe('CL');
  });

  it('PE → PE', () => {
    expect(mapAlpha2ToCountryCode('PE')).toBe('PE');
  });

  it('US → ISO (unsupported jurisdiction)', () => {
    expect(mapAlpha2ToCountryCode('US')).toBe('ISO');
  });

  it('cl (lowercase) → CL (case-insensitive)', () => {
    expect(mapAlpha2ToCountryCode('cl')).toBe('CL');
  });

  it('empty string → ISO', () => {
    expect(mapAlpha2ToCountryCode('')).toBe('ISO');
  });

  it('null/undefined → ISO', () => {
    expect(mapAlpha2ToCountryCode(undefined)).toBe('ISO');
    expect(mapAlpha2ToCountryCode(null)).toBe('ISO');
  });

  it('whitespace padded → trimmed and resolved (" br " → BR)', () => {
    expect(mapAlpha2ToCountryCode(' br ')).toBe('BR');
  });
});

/* -------------------------------------------------------------------------- */
/* countryFromCoordsAsync — Google Maps reverse geocoding                      */
/* -------------------------------------------------------------------------- */

function geocodeOk(countryShort: string): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [
        {
          address_components: [
            { short_name: countryShort, long_name: 'Country', types: ['country', 'political'] },
          ],
        },
      ],
      status: 'OK',
    }),
  })) as unknown as typeof fetch;
}

function geocodeStatus(status: string): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results: [], status }),
  })) as unknown as typeof fetch;
}

function geocodeThrows(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
}

describe('countryFromCoordsAsync', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-gmaps-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Santiago coords with mocked CL response → CL', async () => {
    vi.stubGlobal('fetch', geocodeOk('CL'));
    expect(await countryFromCoordsAsync(-33.45, -70.66)).toBe('CL');
  });

  it('NYC coords with mocked US response → ISO (unsupported)', async () => {
    vi.stubGlobal('fetch', geocodeOk('US'));
    expect(await countryFromCoordsAsync(40.71, -74.0)).toBe('ISO');
  });

  it('falls back to bbox method when API key is missing — (-33.45, -70.66) → CL', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await countryFromCoordsAsync(-33.45, -70.66)).toBe('CL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to bbox method when fetch throws — (-12.05, -77.04) → PE', async () => {
    vi.stubGlobal('fetch', geocodeThrows());
    expect(await countryFromCoordsAsync(-12.05, -77.04)).toBe('PE');
  });

  it('falls back to bbox method when upstream responds non-OK — (-33.45, -70.66) → CL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch,
    );
    expect(await countryFromCoordsAsync(-33.45, -70.66)).toBe('CL');
  });

  it('returns ISO directly when status=ZERO_RESULTS (ocean / unmapped)', async () => {
    vi.stubGlobal('fetch', geocodeStatus('ZERO_RESULTS'));
    // Use an open-ocean point to make the intent obvious; bbox would also miss.
    expect(await countryFromCoordsAsync(0, -30)).toBe('ISO');
  });

  it('AbortSignal cancellation propagates as AbortError', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      // Mimic native fetch: when signal is already aborted, reject with AbortError.
      if (init?.signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { ok: true, status: 200, json: async () => ({ results: [], status: 'OK' }) };
    });
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    controller.abort();
    await expect(
      countryFromCoordsAsync(-33.45, -70.66, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('NaN coords short-circuit to ISO without hitting fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await countryFromCoordsAsync(NaN, NaN)).toBe('ISO');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Round 13 NIT: lat/lng must be (1) clamped to 6 decimals so the URL is
  // stable across float drift and (2) URL-encoded so a future caller passing
  // odd characters (or a sign-flipped negative zero) cannot inject query
  // separators. The API key path is already encoded — assert we don't double-
  // encode the encoded comma when joining lat/lng.
  it('builds a Google Maps URL with lat/lng to 6 decimals and encodeURIComponent', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            address_components: [
              { short_name: 'CL', long_name: 'Chile', types: ['country', 'political'] },
            ],
          },
        ],
        status: 'OK',
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    // Use values whose default toString would expose floating-point drift
    // (e.g., -33.4500000001) so the .toFixed(6) rule is observable.
    await countryFromCoordsAsync(-33.4500000001, -70.660000001);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String((fetchSpy.mock.calls[0] as unknown[])[0]);

    // Lat/lng appear in 6-decimal form.
    const expectedLat = encodeURIComponent((-33.4500000001).toFixed(6));
    const expectedLng = encodeURIComponent((-70.660000001).toFixed(6));
    expect(calledUrl).toContain(`latlng=${expectedLat},${expectedLng}`);

    // Drifted form must NOT appear (proves the rounding actually happened).
    expect(calledUrl).not.toContain('-33.4500000001');
    expect(calledUrl).not.toContain('-70.660000001');

    // The API key path is still present and properly encoded once.
    expect(calledUrl).toContain('key=test-gmaps-key');
  });
});
