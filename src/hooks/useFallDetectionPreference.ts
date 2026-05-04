import { useEffect, useState, useCallback } from 'react';
import { get, set } from 'idb-keyval';

const STORAGE_KEY = 'gp.fallDetection.enabled';

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
  const [enabled, setEnabledState] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await get<boolean>(STORAGE_KEY);
        if (!cancelled) {
          setEnabledState(stored === true);
        }
      } catch {
        // SSR or storage unavailable — default OFF.
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
    try {
      await set(STORAGE_KEY, next);
    } catch {
      // best-effort persistence
    }
  }, []);

  return { enabled, loading, setEnabled };
}
