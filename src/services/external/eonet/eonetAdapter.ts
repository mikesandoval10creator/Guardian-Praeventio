// EONET adapter — natural-event feed (wildfires, storms, volcanoes, …).
//
// Read-only client. Cache 1h per (bbox+filter) combo, retry 2× with
// exponential backoff on 5xx, Sentry capture on terminal errors.
//
// Importante: el cliente es agnostico al "organismo" de la fuente. El
// recommendationBuilder se encarga de presentar el evento de manera
// tranquila al operario.

import {
  EonetResponseSchema,
  type BBox,
  type EonetCategory,
  type EonetEvent,
} from './types.js';
import { getErrorTracker } from '../../observability/index.js';

export interface EonetAdapterOptions {
  httpClient?: typeof fetch;
  baseUrl?: string;
  /** TTL en ms para cache in-memory por combo de filtros. Default 1h. */
  cacheTtlMs?: number;
  /** clock injection (testing). */
  now?: () => number;
}

export interface EonetFetchOptions {
  bbox?: BBox;
  /** look-back window en dias. EONET acepta `days` (>=1). Default 30. */
  days?: number;
  categories?: EonetCategory[];
  status?: 'open' | 'closed' | 'all';
}

interface CacheEntry {
  expiresAt: number;
  events: EonetEvent[];
}

const DEFAULT_BASE_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_RETRIES = 2;

export class EonetAdapter {
  private readonly httpClient: typeof fetch;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: EonetAdapterOptions = {}) {
    this.httpClient = options.httpClient ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async fetchEvents(opts: EonetFetchOptions = {}): Promise<EonetEvent[]> {
    const url = this.buildUrl(opts);
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > this.now()) {
      return cached.events;
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await this.httpClient(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (resp.status >= 500 && resp.status < 600) {
          throw new Error(`EONET upstream ${resp.status}`);
        }
        if (!resp.ok) {
          throw new Error(`EONET request failed: ${resp.status}`);
        }
        const json: unknown = await resp.json();
        const parsed = EonetResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error(`EONET schema validation failed: ${parsed.error.message}`);
        }
        const events = parsed.data.events;
        this.cache.set(url, {
          expiresAt: this.now() + this.cacheTtlMs,
          events,
        });
        return events;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await sleep(2 ** attempt * 100);
          continue;
        }
        try {
          getErrorTracker().captureException(err as Error, {
            tags: { component: 'eonetAdapter' },
            extra: { url },
          });
        } catch {
          // observability must never throw upstream
        }
        throw err;
      }
    }
    // unreachable, but keep TS happy
    throw lastErr instanceof Error ? lastErr : new Error('EONET unknown error');
  }

  /** test helper: clear cache. */
  clearCache(): void {
    this.cache.clear();
  }

  private buildUrl(opts: EonetFetchOptions): string {
    const url = new URL(this.baseUrl);
    if (opts.status && opts.status !== 'all') {
      url.searchParams.set('status', opts.status);
    } else if (!opts.status) {
      // sensible default — open events only
      url.searchParams.set('status', 'open');
    }
    url.searchParams.set('days', String(opts.days ?? 30));
    if (opts.categories && opts.categories.length > 0) {
      url.searchParams.set('category', opts.categories.join(','));
    }
    if (opts.bbox) {
      const { lonMin, latMax, lonMax, latMin } = opts.bbox;
      url.searchParams.set(
        'bbox',
        `${lonMin},${latMax},${lonMax},${latMin}`,
      );
    }
    return url.toString();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lazy singleton — permite usar `eonetAdapter.fetchEvents(...)` sin
 * construir manualmente. Match con el patrón de `nasaPowerAdapter`.
 * Tests pueden mockear la importación de este símbolo.
 */
let _singleton: EonetAdapter | null = null;
export const eonetAdapter = {
  fetchEvents(opts: EonetFetchOptions = {}): Promise<EonetEvent[]> {
    if (!_singleton) _singleton = new EonetAdapter();
    return _singleton.fetchEvents(opts);
  },
  clearCache(): void {
    _singleton?.clearCache();
  },
};
