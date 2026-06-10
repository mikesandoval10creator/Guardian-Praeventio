/**
 * useSlmAcquisition — React hook que orquesta el flujo de adquisición
 * del modelo SLM tipo videojuego.
 *
 * Responsabilidades:
 *   - Computa el `AcquisitionStatus` al mount (y on-demand vía
 *     `refresh()`).
 *   - Expone callbacks `accept` / `postpone` / `decline` que persisten
 *     la decisión y disparan la descarga real cuando aplica.
 *   - Trackea el progreso de la descarga vía el callback que el caller
 *     pasa al `<SlmAcquisitionPrompt />`.
 *   - Sprint 56 (stream-slm-shell): pause / resume / retry con
 *     AbortController + backoff exponencial. UI cellular-gate
 *     persistida. Keep-awake nativo durante la descarga.
 *
 * Diseño:
 *   - Dynamic imports para el adapter de descarga (evita arrastrar
 *     ORT/Comlink al bundle hasta que el usuario acepta).
 *   - State machine local que NO se acopla al stack de React Router;
 *     funciona como overlay del shell.
 *   - Errores de descarga NO crashean la app — quedan disponibles en
 *     `error` para que el caller los muestre.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  detectNetworkAdvisory,
  getAcquisitionStatus,
  recordAccepted,
  recordDeclined,
  recordPostponed,
  type AcquisitionStatus,
  type NetworkAdvisory,
} from '../services/slm/slmAcquisitionService';

export interface UseSlmAcquisitionOptions {
  /** Override which model to acquire. Defaults to DEFAULT_MODEL_ID. */
  modelId?: string;
  /**
   * Cooldown en horas cuando el usuario elige "después". Default 24h.
   */
  postponeHours?: number;
  /**
   * Si `true`, el hook intenta computar el status al mount. Default true.
   * Set a `false` cuando el caller quiere control manual (e.g. esperar a
   * que el usuario llegue a una ruta específica).
   */
  autoCheck?: boolean;
  /**
   * Sprint 56: máximo de reintentos automáticos por interrupción de red.
   * Cada reintento espera `2^n * 1500ms` con jitter. Default 4 (≈ 45s
   * total). El usuario puede gatillar más reintentos con `retry()`.
   */
  maxAutoRetries?: number;
}

/**
 * Estado de descarga expuesto a la UI. `active` mientras corre,
 * `paused` cuando el user pausa manualmente, `retrying` mientras
 * esperamos el backoff antes de reintentar, `failed` cuando se
 * agotan los reintentos automáticos.
 */
export type DownloadPhase =
  | 'idle'
  | 'active'
  | 'retrying'
  | 'paused'
  | 'failed'
  | 'done';

export interface UseSlmAcquisitionResult {
  /** Status actual. `null` mientras la primera evaluación corre. */
  status: AcquisitionStatus | null;
  /** Network advisory del momento (revaluado en cada `refresh`). */
  networkAdvisory: NetworkAdvisory;
  /** Progreso 0..1 si está descargando. */
  downloadProgress: number;
  /** Bytes descargados hasta ahora. */
  downloadedBytes: number;
  /** Último error de descarga (mensaje legible). */
  error: string | null;
  /** Sprint 56: fase fina de la descarga. */
  downloadPhase: DownloadPhase;
  /** Sprint 56: cuántos reintentos automáticos llevamos. */
  retryAttempt: number;
  /** Usuario acepta — dispara la descarga real. */
  accept: () => Promise<void>;
  /** Usuario elige "después". */
  postpone: () => void;
  /** Usuario elige "solo modo online". */
  decline: () => void;
  /** Recomputar el status (caller puede llamar al volver online, etc.). */
  refresh: () => Promise<void>;
  /** Sprint 56: pausar la descarga en curso (abort + keep flag local). */
  pause: () => void;
  /** Sprint 56: reanudar tras pausa o error. */
  resume: () => Promise<void>;
  /** Sprint 56: reset error y reintenta de cero. Alias semántico. */
  retry: () => Promise<void>;
}

/**
 * El adapter real de descarga se importa dinámicamente para que el
 * bundle de cold-start NO arrastre ORT + Comlink + workerProxy. Solo
 * cuando el usuario acepta cargamos el adapter.
 */
type SlmRuntimeModule = typeof import('../services/slm/slmRuntime');
let runtimePromise: Promise<SlmRuntimeModule> | null = null;
async function getRuntime(): Promise<SlmRuntimeModule> {
  if (!runtimePromise) {
    runtimePromise = import('../services/slm/slmRuntime');
  }
  return runtimePromise;
}

/**
 * Keep-awake helper. Lazy import del plugin Capacitor para no afectar
 * el bundle web puro. Devuelve no-op si el plugin no está disponible
 * (web sin native runtime, tests, etc.).
 */
async function acquireKeepAwake(): Promise<() => Promise<void>> {
  try {
    const [{ KeepAwake }, { Capacitor }] = await Promise.all([
      import('@capacitor-community/keep-awake'),
      import('@capacitor/core'),
    ]);
    if (!Capacitor.isNativePlatform()) {
      // Web wakeLock — best-effort.
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        try {
          const sentinel = await (
            navigator as unknown as {
              wakeLock: { request: (k: string) => Promise<{ release: () => Promise<void> }> };
            }
          ).wakeLock.request('screen');
          return async () => {
            try {
              await sentinel.release();
            } catch {
              /* ignore */
            }
          };
        } catch {
          return async () => {};
        }
      }
      return async () => {};
    }
    await KeepAwake.keepAwake();
    return async () => {
      try {
        await KeepAwake.allowSleep();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return async () => {};
  }
}

/** Backoff exponencial con jitter (cap a 30s). */
function backoffDelayMs(attempt: number): number {
  const base = Math.min(30_000, 1500 * 2 ** attempt);
  const jitter = Math.random() * 0.3 * base;
  return Math.round(base + jitter);
}

/**
 * Sprint 56: gate persistido para confirmación de uso de datos móviles.
 * Cuando el user descarga >500MB sobre cellular, le pedimos confirmación
 * adicional. La decisión se guarda en localStorage para no repetir.
 */
const STORAGE_KEY_CELLULAR_OK = 'praeventio:slm:cellular-confirmed:v1';

export function hasCellularConfirmation(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY_CELLULAR_OK) === '1';
  } catch {
    return false;
  }
}

export function recordCellularConfirmation(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CELLULAR_OK, '1');
  } catch {
    /* ignore */
  }
}

export function resetCellularConfirmation(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_CELLULAR_OK);
  } catch {
    /* ignore */
  }
}

export function useSlmAcquisition(
  options: UseSlmAcquisitionOptions = {},
): UseSlmAcquisitionResult {
  const { modelId, postponeHours, autoCheck = true, maxAutoRetries = 4 } = options;

  const [status, setStatus] = useState<AcquisitionStatus | null>(null);
  const [networkAdvisory, setNetworkAdvisory] = useState<NetworkAdvisory>(() =>
    detectNetworkAdvisory(),
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>('idle');
  const [retryAttempt, setRetryAttempt] = useState(0);

  // Track mount state for safe setState after async work.
  const mountedRef = useRef(true);
  // AbortController activo durante la descarga. Reseteado en cada start.
  const abortRef = useRef<AbortController | null>(null);
  // Flag para distinguir un abort por "pause" de un abort por unmount/error.
  const pausedRef = useRef(false);
  // Release callback del keep-awake, válido durante el ciclo activo.
  const releaseKeepAwakeRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort cualquier descarga activa para no leak fetch en jsdom.
      abortRef.current?.abort();
      void releaseKeepAwakeRef.current?.();
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await getAcquisitionStatus({ modelId });
      if (!mountedRef.current) return;
      setStatus(s);
      setNetworkAdvisory(detectNetworkAdvisory());
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [modelId]);

  // Initial check + network event subscriptions.
  useEffect(() => {
    if (!autoCheck) return;
    void refresh();
  }, [autoCheck, refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = () => setNetworkAdvisory(detectNetworkAdvisory());
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    return () => {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, []);

  /**
   * Run del download. Encapsula el ciclo completo:
   *   1) keep-awake on
   *   2) intentar descarga con AbortController + onProgress
   *   3) en fallo de red, reintentar con backoff hasta maxAutoRetries
   *   4) release keep-awake al terminar (ok / fail / pause)
   *
   * Re-utilizable: lo llamamos desde `accept`, `resume` y `retry`.
   */
  const runDownload = useCallback(
    async (currentStatus: AcquisitionStatus) => {
      pausedRef.current = false;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setDownloadPhase('active');
      setStatus({ ...currentStatus, state: 'downloading' });

      // Best-effort keep-awake. Reset cualquier instancia previa.
      await releaseKeepAwakeRef.current?.();
      releaseKeepAwakeRef.current = await acquireKeepAwake();

      let attempt = 0;

      while (true) {
        try {
          const { createSlmRuntime } = await getRuntime();
          const runtime = createSlmRuntime();
          const completedFileBytes: number[] = [];
          const handle = await runtime.loadModel(currentStatus.modelId, {
            signal: controller.signal,
            onProgress: (e) => {
              if (!mountedRef.current) return;
              let totalLoaded = e.loaded;
              for (let i = 0; i < e.fileIndex; i++) {
                totalLoaded += completedFileBytes[i] ?? 0;
              }
              setDownloadedBytes(totalLoaded);
              if (currentStatus.totalBytes > 0) {
                setDownloadProgress(
                  Math.min(1, totalLoaded / currentStatus.totalBytes),
                );
              }
              if (e.total != null && e.loaded === e.total) {
                completedFileBytes[e.fileIndex] = e.total;
              }
            },
          });

          if (!mountedRef.current) return;
          setDownloadProgress(1);
          setDownloadedBytes(currentStatus.totalBytes);
          setDownloadPhase('done');
          recordAccepted(currentStatus.modelId);
          await runtime.release(handle).catch(() => {
            /* best-effort */
          });
          await releaseKeepAwakeRef.current?.();
          releaseKeepAwakeRef.current = null;
          await refresh();
          return;
        } catch (err) {
          // Abort por pause manual: salir limpio, NO reintentar.
          if (pausedRef.current) {
            if (mountedRef.current) {
              setDownloadPhase('paused');
              setStatus({ ...currentStatus, state: 'needs_prompt' });
            }
            await releaseKeepAwakeRef.current?.();
            releaseKeepAwakeRef.current = null;
            return;
          }
          if (!mountedRef.current) return;

          const message = err instanceof Error ? err.message : String(err);
          // Si llegamos al cap, marcar fallo terminal.
          if (attempt >= maxAutoRetries) {
            setError(message);
            setDownloadPhase('failed');
            setStatus({ ...currentStatus, state: 'needs_prompt' });
            await releaseKeepAwakeRef.current?.();
            releaseKeepAwakeRef.current = null;
            return;
          }
          attempt += 1;
          setRetryAttempt(attempt);
          setDownloadPhase('retrying');
          setError(message);
          // Esperar backoff. Si el user pausa durante el wait, salimos.
          const wait = backoffDelayMs(attempt);

          await new Promise<void>((resolve) => {
            const id = setTimeout(resolve, wait);
            controller.signal.addEventListener('abort', () => {
              clearTimeout(id);
              resolve();
            });
          });
          if (pausedRef.current || !mountedRef.current) {
            if (mountedRef.current) {
              setDownloadPhase('paused');
              setStatus({ ...currentStatus, state: 'needs_prompt' });
            }
            await releaseKeepAwakeRef.current?.();
            releaseKeepAwakeRef.current = null;
            return;
          }
          // Loop: nuevo intento. Limpiamos el error transitorio para
          // que la UI no muestre el último mensaje mientras retomamos.
          setError(null);
          setDownloadPhase('active');
        }
      }
    },
    [maxAutoRetries, refresh],
  );

  const accept = useCallback(async () => {
    if (!status) return;
    setDownloadProgress(0);
    setDownloadedBytes(0);
    setRetryAttempt(0);
    await runDownload(status);
  }, [runDownload, status]);

  const pause = useCallback(() => {
    if (!abortRef.current) return;
    pausedRef.current = true;
    abortRef.current.abort();
  }, []);

  const resume = useCallback(async () => {
    if (!status) return;
    // Reanudamos desde 0 (no Range): el usuario verá una barra clara
    // que parte de 0 pero la UI muestra "Reanudando…". Cache de bytes
    // ya integros se rescata por slmRuntime si está implementado.
    setRetryAttempt(0);
    setError(null);
    await runDownload(status);
  }, [runDownload, status]);

  const retry = useCallback(async () => {
    if (!status) return;
    setDownloadProgress(0);
    setDownloadedBytes(0);
    setRetryAttempt(0);
    setError(null);
    await runDownload(status);
  }, [runDownload, status]);

  const postpone = useCallback(() => {
    if (!status) return;
    pausedRef.current = true;
    abortRef.current?.abort();
    recordPostponed(status.modelId, postponeHours);
    void refresh();
  }, [postponeHours, refresh, status]);

  const decline = useCallback(() => {
    if (!status) return;
    pausedRef.current = true;
    abortRef.current?.abort();
    recordDeclined(status.modelId);
    void refresh();
  }, [refresh, status]);

  return {
    status,
    networkAdvisory,
    downloadProgress,
    downloadedBytes,
    error,
    downloadPhase,
    retryAttempt,
    accept,
    postpone,
    decline,
    refresh,
    pause,
    resume,
    retry,
  };
}
