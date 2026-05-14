/**
 * Backoff exponencial deterministico para el outbox engine.
 *
 * 1s, 2s, 4s, 8s, 16s, 32s, 60s (cap). Sin jitter — los tests deben
 * ser reproducibles. En producción, si dos clientes hacen retry al
 * mismo tiempo el server dedupa por idempotency key.
 */

export const DEFAULT_BACKOFF_BASE_MS = 1000;
export const DEFAULT_BACKOFF_CAP_MS = 60_000;

export interface BackoffComputeOpts {
  /** Epoch ms del "now" — del cual se calcula el next retry. */
  now: number;
  /** Cuántos retries fallidos llevamos (incluído el que acabamos de marcar). */
  retryCount: number;
  /** Base del backoff (default 1000). */
  baseMs?: number;
  /** Cap del delay individual (default 60000). */
  capMs?: number;
}

/**
 * Computa el `nextRetryAt` epoch ms para un entry que acaba de fallar.
 *
 * Formula: `now + min(baseMs * 2^(retryCount - 1), capMs)`.
 * Cuando retryCount === 1 → delay = baseMs.
 * Cuando retryCount === 2 → delay = 2 * baseMs.
 * Cuando retryCount === 6 → delay = 32 * baseMs (32s con default).
 * Cuando retryCount === 7+ → cap (60s con default).
 */
export function computeNextRetryAt(opts: BackoffComputeOpts): number {
  const baseMs = opts.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const capMs = opts.capMs ?? DEFAULT_BACKOFF_CAP_MS;
  const safeCount = Math.max(1, opts.retryCount);
  const naiveDelay = baseMs * Math.pow(2, safeCount - 1);
  const cappedDelay = Math.min(naiveDelay, capMs);
  return opts.now + cappedDelay;
}
