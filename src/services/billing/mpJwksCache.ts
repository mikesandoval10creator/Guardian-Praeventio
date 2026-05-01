// Praeventio Guard — Round 19 (A9): in-memory JWKS cache for MercadoPago.
//
// Why this exists
//   MercadoPago's IPN webhooks (Round 18 R6 shipped HMAC) are migrating to
//   OIDC: the producer signs each delivery as a JWT (RS256) using a key
//   published in MP's JSON Web Key Set. We refuse the IPN unless we can
//   verify the signature chain against THAT JWKS — which means the verifier
//   needs the key set in hand at request time.
//
// Why a cache (and not a per-request fetch)
//   • MP rotates JWKS keys on a multi-week cadence; per-request HTTPS adds
//     ~80–200 ms p50 latency and a hard external dependency on every IPN.
//   • A 6-hour in-memory cache is the same shape Auth0/Cognito/Google use.
//     If MP rotates inside the window, the JWKS key id (`kid`) we hold
//     no longer matches what the JWT advertises → the verifier surfaces
//     a "kid not found" error and CAN call `getJwks(true)` to bypass the
//     cache and refetch. That's the documented refresh-on-401 path.
//
// API
//   getJwks(forceRefresh?)
//     Returns the cached set if still inside the 6-hour TTL; otherwise
//     fetches `MP_JWKS_URL` (defaults to MP's published endpoint) and
//     refreshes the cache. With `forceRefresh: true` the cache is
//     bypassed unconditionally — call this after a verification failure
//     attributed to "kid not in cache" so we can try again with fresh
//     keys before serving 401.
//
// State
//   Module-level singletons. The cache lives in process memory and dies
//   with the process. That's intentional — IPN traffic is single-digit
//   QPS at most; surviving a restart is not a goal.
//
// Round 20 candidate
//   Replace the in-process cache with Redis if we add a multi-replica
//   billing fleet. For now (single-instance Cloud Run) RAM is enough.

import { logger } from '../../utils/logger.js';

/** Single JSON Web Key as published by an OIDC provider's JWKS endpoint. */
export interface JsonWebKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

/** A JWKS document — `keys` is the verifier-relevant array. */
export interface JsonWebKeySet {
  keys: JsonWebKey[];
}

/**
 * Default JWKS URL for MercadoPago. Override with `MP_JWKS_URL` env var
 * for staging or for a transitional period while MP reorganises hosts.
 *
 * Documented at https://www.mercadopago.com.ar/developers (search:
 * "JSON Web Key Set"). The exact path may shift across MP product lines —
 * if the env var is unset and the default 404s, the verifier surfaces the
 * fetch error so operators see the misconfiguration in logs.
 */
const DEFAULT_MP_JWKS_URL = 'https://api.mercadopago.com/.well-known/jwks.json';

/** Six hours in ms — same shape as Google/Auth0 caches. */
export const MP_JWKS_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  jwks: JsonWebKeySet;
}

let cache: CacheEntry | null = null;

/**
 * Test-only seam: clear the module-level cache. Called from beforeEach in
 * mpJwksCache.test.ts so each test starts with no warm cache.
 */
export function _resetMpJwksCacheForTests(): void {
  cache = null;
}

/**
 * Test-only seam: substitute a fetch implementation. Vitest can pass a
 * deterministic fake without needing global mocks.
 */
type JwksFetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
let injectedFetcher: JwksFetcher | null = null;
export function _setJwksFetcherForTests(fetcher: JwksFetcher | null): void {
  injectedFetcher = fetcher;
}

function defaultFetcher(): JwksFetcher {
  // Lazy global lookup so the function picks up the latest `fetch` if the
  // host (Node 18+) installs/patches it after module load.
  return async (url: string) => {
    const response = await fetch(url);
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json(),
    };
  };
}

function isJwks(value: unknown): value is JsonWebKeySet {
  if (!value || typeof value !== 'object') return false;
  const keys = (value as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return false;
  // Each entry must at least carry `kty`; everything else is verifier-side.
  return keys.every((k) => k && typeof k === 'object' && typeof (k as JsonWebKey).kty === 'string');
}

/**
 * Get MercadoPago's JWKS, using a 6-hour in-memory cache.
 *
 * Behavior:
 *   • Fresh cache (< TTL) → return cached
 *   • Stale or absent     → fetch, cache, return
 *   • forceRefresh: true  → bypass cache, fetch, replace cache, return
 *
 * Throws on:
 *   • Fetch network error
 *   • Non-2xx HTTP status
 *   • Response body that doesn't parse as JSON
 *   • Response body that doesn't shape as a JWKS (`{keys: [...]}` with `kty`)
 *
 * On a thrown fetch we DO NOT poison the cache — a previous fresh value (if
 * any) survives so a transient MP outage doesn't immediately cascade into
 * IPN 401s.
 */
export async function getJwks(forceRefresh = false): Promise<JsonWebKeySet> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.fetchedAt < MP_JWKS_TTL_MS) {
    return cache.jwks;
  }
  const url = process.env.MP_JWKS_URL || DEFAULT_MP_JWKS_URL;
  const fetcher = injectedFetcher ?? defaultFetcher();
  let response: Awaited<ReturnType<JwksFetcher>>;
  try {
    response = await fetcher(url);
  } catch (err) {
    logger.warn('mp_jwks_fetch_failed', {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (!response.ok) {
    const e = new Error(`mp_jwks_http_${response.status}`);
    logger.warn('mp_jwks_http_error', { url, status: response.status });
    throw e;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    logger.warn('mp_jwks_parse_failed', {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (!isJwks(payload)) {
    const e = new Error('mp_jwks_malformed_payload');
    logger.warn('mp_jwks_malformed_payload', { url });
    throw e;
  }
  cache = { fetchedAt: now, jwks: payload };
  return payload;
}
