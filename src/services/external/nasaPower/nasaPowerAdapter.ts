// SPDX-License-Identifier: MIT
//
// NASA POWER adapter — clima histórico hourly por punto GPS.
//
// Pattern matches `eonetAdapter`: read-only client, cache 1h por (lat+lng+rango),
// retry 2× exponencial backoff, Sentry capture en terminal errors.
//
// API REST: https://power.larc.nasa.gov/api/temporal/hourly/point
// Sin API key. Gratis. Global. Granularidad horaria, lag ~3-5 días.

import {
  NasaPowerResponseSchema,
  NASA_POWER_DEFAULT_PARAMS,
  NASA_POWER_UNITS,
  type ClimateAggregates,
  type ClimateTimeSeries,
  type NasaPowerCommunity,
  type NasaPowerParameter,
} from './types.js';
import { getErrorTracker } from '../../observability/index.js';

export interface NasaPowerAdapterOptions {
  httpClient?: typeof fetch;
  baseUrl?: string;
  /** TTL en ms para cache. Default 1h (la NASA actualiza ~hourly). */
  cacheTtlMs?: number;
  /** Clock injection (tests). */
  now?: () => number;
}

export interface NasaPowerFetchOptions {
  /** Latitud WGS84 (-90 a 90). */
  latitude: number;
  /** Longitud WGS84 (-180 a 180). */
  longitude: number;
  /**
   * Días hacia atrás desde "hoy menos 4 días" (compensación por lag NASA).
   * Default: 7 días = 168 samples horarios.
   */
  daysBack?: number;
  /** Parámetros a pedir. Default: T2M, WS10M, WD10M, RH2M, PRECTOTCORR. */
  parameters?: NasaPowerParameter[];
  /** Comunidad NASA. Default 'RE' (Renewable Energy, balanced). */
  community?: NasaPowerCommunity;
}

interface CacheEntry {
  expiresAt: number;
  series: ClimateTimeSeries[];
}

const DEFAULT_BASE_URL = 'https://power.larc.nasa.gov/api/temporal/hourly/point';
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_RETRIES = 2;

// NASA POWER reporta lag ~3-5 días. Pedimos `end = hoy - LAG_DAYS_FROM_NOW`.
// Si se pide rango más reciente, la API responde con fill_value.
const LAG_DAYS_FROM_NOW = 4;

export class NasaPowerAdapter {
  private readonly httpClient: typeof fetch;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: NasaPowerAdapterOptions = {}) {
    this.httpClient = options.httpClient ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Devuelve series temporales para cada parámetro pedido en el rango.
   *
   * @throws Error si la API responde 4xx/5xx tras todos los retries, o
   *   si el schema de respuesta no valida (Zod).
   */
  async fetchClimate(opts: NasaPowerFetchOptions): Promise<ClimateTimeSeries[]> {
    this.validateOpts(opts);
    const url = this.buildUrl(opts);
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > this.now()) {
      return cached.series;
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let isRetryable = false;
      try {
        const resp = await this.httpClient(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (resp.status >= 500 && resp.status < 600) {
          // 5xx = transitorio. Retry.
          isRetryable = true;
          throw new Error(`NASA POWER upstream ${resp.status}`);
        }
        if (!resp.ok) {
          // 4xx = error de cliente (bad request, auth, etc.). NO retry.
          throw new Error(`NASA POWER request failed: ${resp.status}`);
        }
        const json: unknown = await resp.json();
        const parsed = NasaPowerResponseSchema.safeParse(json);
        if (!parsed.success) {
          // Schema fail no es retryable — la API respondió 200 con shape
          // diferente, reintentar no va a cambiar el resultado.
          throw new Error(`NASA POWER schema validation failed: ${parsed.error.message}`);
        }
        const series = this.normalizeResponse(parsed.data, opts);
        this.cache.set(url, {
          expiresAt: this.now() + this.cacheTtlMs,
          series,
        });
        return series;
      } catch (err) {
        lastErr = err;
        // Solo retry para errores transitorios (5xx). Errores fatales
        // (4xx, schema invalid) salen inmediato — no se ganan reintentando.
        if (isRetryable && attempt < MAX_RETRIES) {
          await sleep(2 ** attempt * 100);
          continue;
        }
        try {
          getErrorTracker().captureException(err as Error, {
            tags: { component: 'nasaPowerAdapter' },
            extra: { url, latitude: opts.latitude, longitude: opts.longitude },
          });
        } catch {
          // observability must never throw upstream
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('NASA POWER unknown error');
  }

  /**
   * Conveniencia: pide clima + calcula agregaciones útiles (mean/min/max/sum)
   * en una sola pasada. Para precipitación devuelve `sum` (mm totales en el
   * rango), para otros `mean` es el agregado natural.
   */
  async fetchAggregated(
    opts: NasaPowerFetchOptions,
  ): Promise<{ series: ClimateTimeSeries[]; aggregates: ClimateAggregates[] }> {
    const series = await this.fetchClimate(opts);
    const aggregates = series.map((s) => aggregateSeries(s));
    return { series, aggregates };
  }

  /** Test helper: limpia el cache in-memory. */
  clearCache(): void {
    this.cache.clear();
  }

  // ────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────────────

  private validateOpts(opts: NasaPowerFetchOptions): void {
    if (!Number.isFinite(opts.latitude) || opts.latitude < -90 || opts.latitude > 90) {
      throw new RangeError(`NASA POWER: latitude inválida (${opts.latitude})`);
    }
    if (!Number.isFinite(opts.longitude) || opts.longitude < -180 || opts.longitude > 180) {
      throw new RangeError(`NASA POWER: longitude inválida (${opts.longitude})`);
    }
    const daysBack = opts.daysBack ?? 7;
    if (!Number.isFinite(daysBack) || daysBack < 1 || daysBack > 90) {
      throw new RangeError(`NASA POWER: daysBack debe estar 1-90 (recibido ${daysBack})`);
    }
  }

  private buildUrl(opts: NasaPowerFetchOptions): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set('latitude', String(opts.latitude));
    url.searchParams.set('longitude', String(opts.longitude));
    url.searchParams.set('community', opts.community ?? 'RE');
    url.searchParams.set('format', 'JSON');

    const params = (opts.parameters ?? NASA_POWER_DEFAULT_PARAMS).join(',');
    url.searchParams.set('parameters', params);

    const { start, end } = computeDateWindow(opts.daysBack ?? 7, this.now);
    url.searchParams.set('start', start);
    url.searchParams.set('end', end);

    return url.toString();
  }

  private normalizeResponse(
    raw: NonNullable<ReturnType<typeof NasaPowerResponseSchema.safeParse>['data']>,
    opts: NasaPowerFetchOptions,
  ): ClimateTimeSeries[] {
    const fillValue = raw.header?.fill_value ?? -999;
    const params = opts.parameters ?? NASA_POWER_DEFAULT_PARAMS;
    return params.map((param) => {
      const rawSamples = raw.properties.parameter[param] ?? {};
      const samples = new Map<string, number | null>();
      // NASA encodea timestamps como 'YYYYMMDDHH' (string sin separadores).
      // Los normalizamos a ISO 8601.
      for (const [nasaKey, value] of Object.entries(rawSamples)) {
        const iso = nasaKeyToIso(nasaKey);
        const normalized = value === fillValue ? null : value;
        samples.set(iso, normalized);
      }
      return {
        parameter: param,
        unit: NASA_POWER_UNITS[param],
        samples,
      };
    });
  }
}

/**
 * Calcula agregaciones (mean/min/max/sum) sobre una serie. Ignora samples null.
 * Pure — exportable para tests directos.
 */
export function aggregateSeries(series: ClimateTimeSeries): ClimateAggregates {
  let count = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (const value of series.samples.values()) {
    if (value === null) continue;
    count += 1;
    sum += value;
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
  }
  return {
    parameter: series.parameter,
    count,
    mean: count > 0 ? sum / count : null,
    min,
    max,
    sum: count > 0 ? sum : null,
  };
}

/**
 * Convierte el formato propietario NASA `YYYYMMDDHH` a ISO 8601 UTC.
 * Pure — exportable para tests directos.
 *
 *   '2026051512' → '2026-05-15T12:00:00Z'
 */
export function nasaKeyToIso(key: string): string {
  // NASA POWER always returns UTC. Length 10 = YYYYMMDDHH, length 8 = YYYYMMDD.
  // Validamos que el string sea TODO dígitos antes de slicear — si NASA
  // cambia el formato o un test pasa un valor con separadores, devolvemos
  // crudo (fail-soft) en lugar de generar un string Frankenstein.
  if (!/^\d+$/.test(key)) return key;
  if (key.length === 10) {
    const y = key.slice(0, 4);
    const m = key.slice(4, 6);
    const d = key.slice(6, 8);
    const h = key.slice(8, 10);
    return `${y}-${m}-${d}T${h}:00:00Z`;
  }
  if (key.length === 8) {
    const y = key.slice(0, 4);
    const m = key.slice(4, 6);
    const d = key.slice(6, 8);
    return `${y}-${m}-${d}T00:00:00Z`;
  }
  return key;
}

/**
 * Calcula start/end en formato NASA `YYYYMMDD` para una ventana de
 * `daysBack` días hacia atrás desde "hoy menos LAG_DAYS_FROM_NOW".
 * Pure — exportable para tests directos.
 *
 * Codex fix PR #279: NASA POWER trata `start` y `end` como **inclusive
 * calendar days**. Antes restábamos `daysBack` enteros, devolviendo
 * `daysBack + 1` días de muestras (daysBack=7 → 8 días = 192h). Eso
 * inflaba precipitación acumulada + horas-bajo-0°C y empujaba rutas
 * borderline a warning/danger por data fuera de la ventana prometida.
 *
 * Fix: usar `daysBack - 1` para mantener exactamente la ventana
 * solicitada (daysBack=7 → start a 6 días antes de end → 7 días
 * inclusivos = 168h).
 */
export function computeDateWindow(
  daysBack: number,
  nowFn: () => number = Date.now,
): { start: string; end: string } {
  const nowMs = nowFn();
  const endMs = nowMs - LAG_DAYS_FROM_NOW * 86_400_000;
  const startMs = endMs - (daysBack - 1) * 86_400_000;
  return { start: toNasaDate(new Date(startMs)), end: toNasaDate(new Date(endMs)) };
}

function toNasaDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Instancia singleton lazy. Permite usar `nasaPowerAdapter.fetchClimate(...)`
 * sin construir manualmente.
 */
let _singleton: NasaPowerAdapter | null = null;
export const nasaPowerAdapter = {
  fetchClimate(opts: NasaPowerFetchOptions): Promise<ClimateTimeSeries[]> {
    if (!_singleton) _singleton = new NasaPowerAdapter();
    return _singleton.fetchClimate(opts);
  },
  fetchAggregated(opts: NasaPowerFetchOptions) {
    if (!_singleton) _singleton = new NasaPowerAdapter();
    return _singleton.fetchAggregated(opts);
  },
  clearCache(): void {
    _singleton?.clearCache();
  },
};
