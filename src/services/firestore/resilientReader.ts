/**
 * Resilient Firestore Reader — retry exponencial + offline cache fallback.
 *
 * Firebase tiene su propio persistence layer que sirve reads desde cache
 * cuando el dispositivo está offline. Pero hay casos donde NO funciona:
 *   - El cache nunca fue hidratado (primer launch sin red)
 *   - Una query nueva (different where/orderBy) no tiene cache
 *   - El persistence está deshabilitado (modo privado, multi-tab conflict)
 *   - La promesa de Firestore se atora indefinidamente (network reset
 *     entre cliente y servidor sin error explícito)
 *
 * Este módulo envuelve cualquier read function async con:
 *
 *   1. **Timeout duro** (default 8s) — Firebase NO timeout-ea por sí
 *      mismo en muchos casos; la app queda colgada.
 *   2. **Retry exponencial** (3 attempts: 0ms, 500ms, 2s) — para
 *      errores transitorios (network reset, 503).
 *   3. **Fallback opcional** — si los retries fallan, llama un fallback
 *      provisto por el caller (típicamente IndexedDB local o seed
 *      data) en lugar de propagar el error.
 *   4. **Telemetría** — cada attempt + fallback se registra con
 *      latencia para audit.
 *
 * El módulo es genérico (no acoplado a Firestore directamente). El
 * caller pasa una función async; el wrapper la corre con resilience.
 * Esto permite usar el mismo patrón para Firestore reads, Functions
 * calls, Storage downloads, etc.
 */

export interface ReaderAttempt {
  /** Nº de intento (1-indexed). */
  attempt: number;
  /** ms desde el inicio del wrapper. */
  elapsedMs: number;
  /** Error message si falló (`undefined` si fue success). */
  error?: string;
}

export interface ResilientReadResult<T> {
  /** Valor entregado (puede venir del fallback). */
  value: T;
  /** True si vino del fallback (no del primary). */
  fromFallback: boolean;
  /** Trail de intentos para audit. */
  attempts: ReaderAttempt[];
  /** Latencia total ms. */
  latencyMs: number;
}

export class ResilientReadError extends Error {
  constructor(
    public readonly attempts: ReaderAttempt[],
    msg: string,
  ) {
    super(msg);
    this.name = 'ResilientReadError';
  }
}

export interface ResilientReadOptions<T> {
  /** Cap total de intentos (incluyendo el inicial). Default 3. */
  maxAttempts?: number;
  /** Backoff base ms — el primer retry espera esto, después se duplica. Default 500. */
  baseBackoffMs?: number;
  /** Cap del backoff individual. Default 8000. */
  maxBackoffMs?: number;
  /** Timeout per attempt en ms. Default 8000. */
  perAttemptTimeoutMs?: number;
  /**
   * Si está set, se llama cuando TODOS los attempts fallan. Su return
   * value se entrega al caller con `fromFallback: true` en vez de
   * lanzar ResilientReadError. Si lanza, el error original se propaga.
   */
  fallback?: () => Promise<T> | T;
  /** Override `Date.now()` para tests. */
  nowMs?: () => number;
  /** Override `setTimeout` para tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Si retorna `true`, el error NO se reintenta. Útil para errores
   * permanentes (`permission-denied`, `not-found`) donde reintentar
   * solo consume cuota.
   */
  isUnretriable?: (err: unknown) => boolean;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta `read` con la política de resilience. Si todos los attempts
 * fallan, intenta `fallback` (si fue provisto) y devuelve su valor con
 * `fromFallback: true`. Si no hay fallback o el fallback lanza,
 * propaga `ResilientReadError`.
 */
export async function resilientRead<T>(
  read: () => Promise<T>,
  opts: ResilientReadOptions<T> = {},
): Promise<ResilientReadResult<T>> {
  const now = opts.nowMs ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseBackoffMs = opts.baseBackoffMs ?? 500;
  const maxBackoffMs = opts.maxBackoffMs ?? 8000;
  const perAttemptTimeoutMs = opts.perAttemptTimeoutMs ?? 8000;
  const startedAt = now();
  const attempts: ReaderAttempt[] = [];
  let lastErr: unknown = null;

  for (let i = 1; i <= maxAttempts; i++) {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutP = new Promise<never>((_, rej) => {
        timeoutHandle = setTimeout(
          () => rej(new Error(`resilientRead: timeout ${perAttemptTimeoutMs}ms`)),
          perAttemptTimeoutMs,
        );
      });
      const value = await Promise.race([read(), timeoutP]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      attempts.push({ attempt: i, elapsedMs: now() - startedAt });
      return {
        value,
        fromFallback: false,
        attempts,
        latencyMs: now() - startedAt,
      };
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      lastErr = err;
      attempts.push({
        attempt: i,
        elapsedMs: now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      if (opts.isUnretriable?.(err)) {
        // Don't retry. Jump straight to fallback / throw.
        break;
      }
      if (i < maxAttempts) {
        const backoff = Math.min(
          maxBackoffMs,
          baseBackoffMs * Math.pow(2, i - 1),
        );
        await sleep(backoff);
      }
    }
  }

  // All attempts exhausted. Try fallback.
  if (opts.fallback) {
    try {
      const fallbackValue = await opts.fallback();
      return {
        value: fallbackValue,
        fromFallback: true,
        attempts,
        latencyMs: now() - startedAt,
      };
    } catch (fallbackErr) {
      throw new ResilientReadError(
        attempts,
        `resilientRead: primary + fallback failed. primary=${lastErr instanceof Error ? lastErr.message : String(lastErr)} | fallback=${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
      );
    }
  }

  throw new ResilientReadError(
    attempts,
    `resilientRead: ${maxAttempts} attempts exhausted. last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Convenience builders for common patterns
// ────────────────────────────────────────────────────────────────────────

/**
 * Builder común para reads con fallback IndexedDB:
 *
 *   const reader = resilientFirestoreWithCache(
 *     () => getDoc(docRef),
 *     () => loadFromIdb('users/123'),
 *   );
 *   const result = await reader();
 *
 * El doc del wrapper es el mismo que `resilientRead` pero con la
 * firma curried para no repetir las opciones.
 */
export function resilientFirestoreWithCache<T>(
  read: () => Promise<T>,
  loadFromCache: () => Promise<T> | T,
  opts: Omit<ResilientReadOptions<T>, 'fallback'> = {},
): () => Promise<ResilientReadResult<T>> {
  return () => resilientRead(read, { ...opts, fallback: loadFromCache });
}

/**
 * Detector default para errores Firestore conocidos como NO-retriable.
 * El caller puede pasar este predicado a `resilientRead({isUnretriable})`.
 */
export function isUnretriableFirebaseError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (!code) return false;
  return (
    code === 'permission-denied' ||
    code === 'not-found' ||
    code === 'invalid-argument' ||
    code === 'failed-precondition' ||
    code === 'unauthenticated'
  );
}
