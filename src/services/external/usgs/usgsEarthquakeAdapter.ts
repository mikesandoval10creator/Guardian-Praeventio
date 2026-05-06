// USGS Earthquake adapter — sub-minute global seismic feed.
//
// Read-only. Cache 5min per (center+radius+magnitude+since) combo.
// Retry 2× exponential backoff on 5xx. Sentry capture on terminal errors.

import {
  UsgsEarthquakeFeatureCollectionSchema,
  type UsgsEarthquake,
} from './types.js';
import { getErrorTracker } from '../../observability/index.js';

export interface UsgsAdapterOptions {
  httpClient?: typeof fetch;
  baseUrl?: string;
  /** TTL en ms. Default 5min — feed sismico se actualiza rapido. */
  cacheTtlMs?: number;
  now?: () => number;
}

export interface UsgsFetchOptions {
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  /** filtro mínimo (default 4.5 — ya filtra ruido sub-perceptible). */
  minMagnitude?: number;
  /** ventana hacia atrás (default 24h). */
  sinceHours?: number;
}

interface CacheEntry {
  expiresAt: number;
  features: UsgsEarthquake[];
}

const DEFAULT_BASE_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5min
const MAX_RETRIES = 2;

export class UsgsEarthquakeAdapter {
  private readonly httpClient: typeof fetch;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: UsgsAdapterOptions = {}) {
    this.httpClient = options.httpClient ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async fetchRecentEarthquakes(
    opts: UsgsFetchOptions,
  ): Promise<UsgsEarthquake[]> {
    const url = this.buildUrl(opts);
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > this.now()) {
      return cached.features;
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await this.httpClient(url, {
          method: 'GET',
          headers: { Accept: 'application/geo+json, application/json' },
        });
        if (resp.status >= 500 && resp.status < 600) {
          throw new Error(`USGS upstream ${resp.status}`);
        }
        if (!resp.ok) {
          throw new Error(`USGS request failed: ${resp.status}`);
        }
        const json: unknown = await resp.json();
        const parsed = UsgsEarthquakeFeatureCollectionSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error(`USGS schema validation failed: ${parsed.error.message}`);
        }
        const features = parsed.data.features;
        this.cache.set(url, {
          expiresAt: this.now() + this.cacheTtlMs,
          features,
        });
        return features;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await sleep(2 ** attempt * 100);
          continue;
        }
        try {
          getErrorTracker().captureException(err as Error, {
            tags: { component: 'usgsEarthquakeAdapter' },
            extra: { url },
          });
        } catch {
          /* swallow */
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('USGS unknown error');
  }

  clearCache(): void {
    this.cache.clear();
  }

  private buildUrl(opts: UsgsFetchOptions): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set('format', 'geojson');
    url.searchParams.set('latitude', String(opts.centerLat));
    url.searchParams.set('longitude', String(opts.centerLon));
    url.searchParams.set('maxradiuskm', String(opts.radiusKm));
    url.searchParams.set('minmagnitude', String(opts.minMagnitude ?? 4.5));
    const sinceHours = opts.sinceHours ?? 24;
    const startTime = new Date(this.now() - sinceHours * 60 * 60 * 1000)
      .toISOString();
    url.searchParams.set('starttime', startTime);
    return url.toString();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
