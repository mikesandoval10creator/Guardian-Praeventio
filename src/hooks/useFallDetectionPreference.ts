import { useEffect, useState, useCallback } from 'react';
import { get, set } from 'idb-keyval';

const STORAGE_KEY = 'gp.fallDetection.enabled';

/**
 * Synchronous durability mirror. IndexedDB remains the primary store, but a
 * reload can happen before its promise resolves; localStorage closes that
 * narrow loss window and also acts as a fallback when IndexedDB is unavailable.
 */
function readSynchronousPreference(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // Private browsing or a denied storage area — use IndexedDB/default.
  }
  return null;
}

function writeSynchronousPreference(next: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // IndexedDB remains the primary persistence path.
  }
}

/**
 * Preferencia opt-in del usuario para activar el monitor de Hombre Caído
 * (Fall Detection Monitor).
 *
 * **Por qué opt-in (default OFF):** el monitor consume el acelerómetro de
 * forma continua, lo que drena batería en segundo plano. La mayoría de los
 * trabajadores NO están expuestos a riesgos de caída por altura — para
 * ellos, prender el sensor es desperdicio. Solo trabajadores en techos,
 * andamios, torres, espacios confinados con desnivel, etc. deberían
 * activarlo conscientemente.
 *
 * **Persistencia:** IndexedDB via idb-keyval. La preferencia es por
 * dispositivo (no Firestore), porque depende del rol/turno actual del
 * trabajador, no de su identidad cross-device.
 *
 * **Uso:**
 * ```tsx
 * const { enabled, setEnabled, loading } = useFallDetectionPreference();
 * if (enabled) startMonitor();
 * ```
 */
export function useFallDetectionPreference(): {
  enabled: boolean;
  loading: boolean;
  setEnabled: (next: boolean) => Promise<void>;
} {
  const [enabled, setEnabledState] = useState<boolean>(
    () => readSynchronousPreference() ?? false,
  );
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await get<boolean>(STORAGE_KEY);
        if (!cancelled) {
          // Re-read after the async boundary so a just-completed toggle wins
          // over a stale IndexedDB value (or an IndexedDB write still in flight).
          setEnabledState(readSynchronousPreference() ?? (stored === true));
        }
      } catch {
        // SSR or storage unavailable — keep the synchronous value/default OFF.
        if (!cancelled) setEnabledState(readSynchronousPreference() ?? false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback(async (next: boolean): Promise<void> => {
    setEnabledState(next);
    // Write synchronously before awaiting IndexedDB so an immediate browser
    // reload cannot lose the user's explicit opt-in/opt-out.
    writeSynchronousPreference(next);
    try {
      await set(STORAGE_KEY, next);
    } catch {
      // The synchronous mirror is the durable fallback.
    }
  }, []);

  return { enabled, loading, setEnabled };
}
