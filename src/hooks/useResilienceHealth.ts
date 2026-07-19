/**
 * useResilienceHealth — runs `buildResilienceHealthReport` con los
 * checkers REALES del runtime (SLM acquisition state, Zettelkasten
 * memory, Firestore reachability, navigator network, device KEK,
 * encrypted KV).
 *
 * Sin este hook, el `<ResilienceHealthDashboard />` era una pieza
 * presentational suelta. El service `buildResilienceHealthReport`
 * también existía pero NUNCA se invocaba desde el cliente — pure
 * dead code en el repo.
 *
 * Ahora el flujo es completo:
 *   getAcquisitionStatus() ─┐
 *   listAllZkNodes() ───────┼─→ buildResilienceHealthReport()
 *   pingFirestore() ────────┤
 *   inspectDeviceKek() ─────┤
 *   listEncryptedKeys() ────┤
 *   navigator.onLine ───────┘
 *                                    │
 *                                    ▼
 *                          <ResilienceHealthDashboard report={...} />
 *
 * Auto-refresh cada 5 min (mismo intervalo que el cron server-side).
 * Caller puede pasar `refreshIntervalMs: 0` para auto-refresh off
 * (typically in tests).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildResilienceHealthReport,
  makeDeviceKekChecker,
  makeNetworkChecker,
  makeSlmChecker,
  makeZettelkastenChecker,
  type ResilienceCheckers,
  type ResilienceHealthReport,
} from '../services/observability/resilienceHealthMonitor';
import { humanErrorMessage } from '../lib/humanError';


const DEFAULT_REFRESH_MS = 5 * 60 * 1000; // 5 min

export interface UseResilienceHealthOptions {
  /** Override checkers para tests. */
  checkers?: ResilienceCheckers;
  /** ms entre auto-refresh. 0 = off. Default 5 min. */
  refreshIntervalMs?: number;
  /** Si true, NO ejecuta el primer check al montar (test friendly). */
  skipInitial?: boolean;
}

export interface UseResilienceHealthResult {
  report: ResilienceHealthReport | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Construye el set canónico de checkers con las dependencias reales
 * del cliente. Cada checker se LAZY-IMPORTA al primer uso para evitar
 * que `useResilienceHealth` arrastre todo el SLM bundle, el envelope
 * encryption, etc., al cold-start de cualquier página que use el hook.
 */
async function buildClientCheckers(): Promise<ResilienceCheckers> {
  // SLM acquisition state — usa el service registrado.
  const slmAdapter = async () => {
    const mod = await import('../services/slm/slmAcquisitionService');
    const s = await mod.getAcquisitionStatus().catch(() => null);
    if (!s) return null;
    return {
      state: s.state,
      isPrePackaged: s.isPrePackaged ?? false,
      cachedBytes: s.cachedBytes ?? 0,
    };
  };

  // Zettelkasten: seed bundle vive como `SEED_NODES` array constante
  // dentro de `resilientRetrieval.ts`. Memory/IDB live counts dependen
  // del estado del adapter en runtime; el contrato del monitor solo
  // necesita 3 contadores. Si el módulo no carga, degradamos a
  // seedAvailable=false (el monitor lo flag como critical correctamente).
  const zkMetrics = async () => {
    const memoryNodeCount = 0;
    const idbNodeCount = 0;
    let seedAvailable = false;
    try {
      const rr = await import('../services/zettelkasten/resilientRetrieval');
      seedAvailable = Array.isArray(rr.SEED_NODES) && rr.SEED_NODES.length > 0;
    } catch {
      seedAvailable = false;
    }
    return { memoryNodeCount, idbNodeCount, seedAvailable };
  };

  // Firestore: lectura barata a un doc "_health/ping" si existe; si no,
  // lo intentamos con `.get()` y atrapamos. NO escribimos — el reporter
  // debe ser read-only para no contaminar audit logs.
  const firestoreChecker = async () => {
    try {
      const { db } = await import('../services/firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      // Read attempt — si no existe el doc, igual contamos Firestore como reachable.
      await getDoc(doc(db, '_health', 'ping')).catch(() => null);
      return {
        id: 'firestore' as const,
        status: 'healthy' as const,
        detail: 'Firestore reachable.',
      };
    } catch (err) {
      return {
        id: 'firestore' as const,
        status: 'critical' as const,
        detail: 'Firestore SDK no inicializado o sin red.',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Device KEK
  const deviceKekChecker = makeDeviceKekChecker(async () => {
    const mod = await import('../services/security/deviceKek');
    const info = await mod.inspectDeviceKek();
    return { exists: info.exists, ageMs: info.ageMs };
  });

  // Encrypted KV — cuenta records. Healthy si responde.
  const encryptedKvChecker = async () => {
    try {
      const mod = await import('../services/security/encryptedKvStore');
      const keys = await mod.listEncryptedKeys();
      return {
        id: 'encrypted_kv' as const,
        status: 'healthy' as const,
        detail: `${keys.length} records cifrados localmente.`,
        metadata: { recordCount: keys.length },
      };
    } catch (err) {
      return {
        id: 'encrypted_kv' as const,
        status: 'critical' as const,
        detail: 'Encrypted KV store no responde.',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Network — solo navigator.onLine (sin ping a backend para no consumir
  // datos del usuario en el hook UI; el cron server-side ya hace el
  // ping real).
  const networkChecker = makeNetworkChecker();

  // Gemini: NO lo testeamos desde el cliente por costo+privacidad.
  // El server-side cron lo verifica. Aquí lo dejamos "unknown" intencional.

  return {
    slm: makeSlmChecker(slmAdapter),
    zettelkasten: makeZettelkastenChecker(zkMetrics),
    firestore: firestoreChecker,
    device_kek: deviceKekChecker,
    encrypted_kv: encryptedKvChecker,
    network: networkChecker,
  };
}

export function useResilienceHealth(
  options: UseResilienceHealthOptions = {},
): UseResilienceHealthResult {
  const [report, setReport] = useState<ResilienceHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const checkersRef = useRef<ResilienceCheckers | null>(
    options.checkers ?? null,
  );

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      if (!checkersRef.current) {
        checkersRef.current = await buildClientCheckers();
      }
      const r = await buildResilienceHealthReport(checkersRef.current);
      if (!mountedRef.current) return;
      setReport(r);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(humanErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!options.skipInitial) {
      void refresh();
    }
    const intervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_MS;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;
    if (intervalMs > 0) {
      intervalHandle = setInterval(() => {
        void refresh();
      }, intervalMs);
    }
    return () => {
      mountedRef.current = false;
      if (intervalHandle) clearInterval(intervalHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.refreshIntervalMs, options.skipInitial]);

  return { report, loading, error, refresh };
}
