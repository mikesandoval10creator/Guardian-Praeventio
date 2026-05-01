// Praeventio Guard — Round 19 (A9): mpJwksCache unit tests.
//
// Covers the 5 documented branches of getJwks():
//   1. cold cache → fetch + populate
//   2. warm cache (< TTL) → no fetch
//   3. expired cache (> TTL) → refetch
//   4. forceRefresh: true → bypass even fresh cache
//   5. fetch error / non-2xx / parse failure / malformed payload → throw
//
// We use the test-only `_setJwksFetcherForTests` seam to inject a stub —
// no globalThis.fetch monkey-patching, no network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getJwks,
  _resetMpJwksCacheForTests,
  _setJwksFetcherForTests,
  MP_JWKS_TTL_MS,
} from './mpJwksCache.js';

const SAMPLE_JWKS = {
  keys: [
    { kty: 'RSA', kid: 'mp-key-1', alg: 'RS256', use: 'sig', n: 'aGVsbG8', e: 'AQAB' },
  ],
};

beforeEach(() => {
  _resetMpJwksCacheForTests();
  _setJwksFetcherForTests(null);
  vi.useRealTimers();
});

afterEach(() => {
  _setJwksFetcherForTests(null);
  vi.useRealTimers();
});

function ok(payload: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

describe('mpJwksCache.getJwks', () => {
  it('fetches the JWKS on cold start and caches the result', async () => {
    const fetcher = vi.fn(ok(SAMPLE_JWKS));
    _setJwksFetcherForTests(fetcher);

    const jwks = await getJwks();
    expect(jwks).toEqual(SAMPLE_JWKS);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns the cached value on a second call inside the TTL window', async () => {
    const fetcher = vi.fn(ok(SAMPLE_JWKS));
    _setJwksFetcherForTests(fetcher);

    const a = await getJwks();
    const b = await getJwks();
    expect(a).toEqual(SAMPLE_JWKS);
    expect(b).toEqual(SAMPLE_JWKS);
    // Critical: only ONE fetch — second call hit the cache.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache exceeds the 6h TTL', async () => {
    const t0 = 1_000_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    const fetcher = vi.fn(ok(SAMPLE_JWKS));
    _setJwksFetcherForTests(fetcher);
    await getJwks();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance past 6h + 1ms — cache should now be stale.
    vi.setSystemTime(t0 + MP_JWKS_TTL_MS + 1);
    await getJwks();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('honors forceRefresh=true even with a fresh cache', async () => {
    const fetcher = vi.fn(ok(SAMPLE_JWKS));
    _setJwksFetcherForTests(fetcher);

    await getJwks();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await getJwks(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh installs the new value as the cached value', async () => {
    const FIRST = { keys: [{ kty: 'RSA', kid: 'old', n: 'a', e: 'AQAB' }] };
    const SECOND = { keys: [{ kty: 'RSA', kid: 'new', n: 'b', e: 'AQAB' }] };
    let call = 0;
    _setJwksFetcherForTests(async () => ({
      ok: true,
      status: 200,
      json: async () => (++call === 1 ? FIRST : SECOND),
    }));

    expect((await getJwks()).keys[0].kid).toBe('old');
    expect((await getJwks(true)).keys[0].kid).toBe('new');
    // Subsequent NON-forced call returns the freshly cached SECOND value.
    expect((await getJwks()).keys[0].kid).toBe('new');
  });

  it('throws when the fetcher rejects (network error)', async () => {
    _setJwksFetcherForTests(async () => {
      throw new Error('econnreset');
    });
    await expect(getJwks()).rejects.toThrow(/econnreset/);
  });

  it('throws on non-2xx HTTP status', async () => {
    _setJwksFetcherForTests(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    await expect(getJwks()).rejects.toThrow(/mp_jwks_http_503/);
  });

  it('throws on a malformed payload (no `keys` array)', async () => {
    _setJwksFetcherForTests(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ wrong: 'shape' }),
    }));
    await expect(getJwks()).rejects.toThrow(/malformed/);
  });
});
