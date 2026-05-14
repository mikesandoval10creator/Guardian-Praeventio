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
}

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
  /** Usuario acepta — dispara la descarga real. */
  accept: () => Promise<void>;
  /** Usuario elige "después". */
  postpone: () => void;
  /** Usuario elige "solo modo online". */
  decline: () => void;
  /** Recomputar el status (caller puede llamar al volver online, etc.). */
  refresh: () => Promise<void>;
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

export function useSlmAcquisition(
  options: UseSlmAcquisitionOptions = {},
): UseSlmAcquisitionResult {
  const { modelId, postponeHours, autoCheck = true } = options;

  const [status, setStatus] = useState<AcquisitionStatus | null>(null);
  const [networkAdvisory, setNetworkAdvisory] = useState<NetworkAdvisory>(() =>
    detectNetworkAdvisory(),
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Track mount state for safe setState after async work.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    if (typeof window === 'undefined') return;
    const onChange = () => setNetworkAdvisory(detectNetworkAdvisory());
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    return () => {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, []);

  const accept = useCallback(async () => {
    if (!status) return;
    setError(null);
    setDownloadProgress(0);
    setDownloadedBytes(0);
    // Optimistic state flip: the prompt switches to "downloading" view.
    setStatus({ ...status, state: 'downloading' });

    try {
      const { createSlmRuntime } = await getRuntime();
      const runtime = createSlmRuntime();

      // The current slmRuntime API doesn't expose a streaming progress
      // callback yet — it does cache-first read-through + integrity.
      // We mark a discrete "started → 1.0" progress so the user sees
      // SOMETHING happening; per-byte progress arrives in a follow-up
      // when the streaming fetcher lands. Below the loadModel call we
      // fire-and-forget a tick to show the bar advancing during the
      // fetch+verify+cache sequence.
      const tickerInterval = window.setInterval(() => {
        if (!mountedRef.current) return;
        setDownloadProgress((p) => Math.min(0.9, p + 0.07));
      }, 800);

      try {
        const handle = await runtime.loadModel(status.modelId);
        window.clearInterval(tickerInterval);
        if (!mountedRef.current) return;
        setDownloadProgress(1);
        setDownloadedBytes(status.totalBytes);
        recordAccepted(status.modelId);
        // Release the handle — the bytes stay in cache, the session
        // gets re-instantiated when the user actually invokes the AI.
        await runtime.release(handle).catch(() => {
          /* best-effort */
        });
        await refresh();
      } catch (err) {
        window.clearInterval(tickerInterval);
        throw err;
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      // Roll back the optimistic state so the prompt shows the options
      // again — the user can retry, postpone, or decline.
      setStatus({ ...status, state: 'needs_prompt' });
    }
  }, [refresh, status]);

  const postpone = useCallback(() => {
    if (!status) return;
    recordPostponed(status.modelId, postponeHours);
    void refresh();
  }, [postponeHours, refresh, status]);

  const decline = useCallback(() => {
    if (!status) return;
    recordDeclined(status.modelId);
    void refresh();
  }, [refresh, status]);

  return {
    status,
    networkAdvisory,
    downloadProgress,
    downloadedBytes,
    error,
    accept,
    postpone,
    decline,
    refresh,
  };
}
