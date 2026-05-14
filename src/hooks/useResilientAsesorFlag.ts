/**
 * useResilientAsesorFlag — feature flag local-first para conmutar
 * entre el `<AsesorChat>` legacy y el `<ResilientAsesorPanel />`
 * nuevo (pipeline #221).
 *
 * Diseño:
 *   - Persiste en localStorage por usuario (clave versioned). Default
 *     `false` para no romper la experiencia actual.
 *   - Reactivo a cambios en otras pestañas via `storage` event.
 *   - Resolución cascada: env var (`VITE_FORCE_RESILIENT_ASESOR=1`)
 *     fuerza ON ignorando localStorage. Útil para canary deploys o
 *     beta opt-in.
 *
 * El motivo de un feature flag local (no remoto) es que el flujo
 * crítico de IA debe seguir funcionando sin tocar Firestore para
 * leer un config. Esto deja la decisión en el dispositivo del
 * usuario y permite QA / staged rollout vía build env var.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'praeventio:asesor:resilient:v1';

function readEnvForce(): boolean {
  try {
    const v = (import.meta as { env?: Record<string, string | undefined> })
      .env?.VITE_FORCE_RESILIENT_ASESOR;
    if (v === '1' || v === 'true') return true;
  } catch {
    // env not available (e.g. tests without Vite globals)
  }
  return false;
}

function readFromStorage(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeToStorage(v: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (v) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // quota / private mode — silently swallow
  }
}

export interface UseResilientAsesorFlagResult {
  enabled: boolean;
  /** Toggle local. NO afecta a otros usuarios. */
  setEnabled: (v: boolean) => void;
  /** True si está forzado por env var (UI debería mostrar lock). */
  forcedByEnv: boolean;
}

export function useResilientAsesorFlag(): UseResilientAsesorFlagResult {
  const forcedByEnv = readEnvForce();
  const [enabled, setEnabledLocal] = useState<boolean>(
    () => forcedByEnv || readFromStorage(),
  );

  // Listen for cross-tab changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setEnabledLocal(forcedByEnv || e.newValue === '1');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [forcedByEnv]);

  const setEnabled = useCallback(
    (v: boolean) => {
      if (forcedByEnv) return; // No-op cuando el env force está activo.
      writeToStorage(v);
      setEnabledLocal(v);
    },
    [forcedByEnv],
  );

  return { enabled, setEnabled, forcedByEnv };
}
