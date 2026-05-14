/**
 * useResilientAsesorFlag — feature flag local-first para conmutar
 * entre el `<ResilientAsesorPanel />` nuevo (default ON desde Sprint
 * 55) y el `<AsesorChat>` legacy (opt-out).
 *
 * **Cambio de Sprint 55 (#242)**: Tras validación canary del nuevo
 * orchestrator resiliente (#221-#241), el default es ahora ON. El
 * caller power-user que quiera revertir al legacy debe explícitamente
 * setear `praeventio:asesor:legacy-optout:v2` = '1' en localStorage.
 *
 * Diseño:
 *   - Default ON (nuevo). Si el caller quiere legacy, opt-out
 *     explícito.
 *   - Reactivo a cambios en otras pestañas via `storage` event.
 *   - Env var override: `VITE_FORCE_LEGACY_ASESOR=1` fuerza el
 *     LEGACY (útil para rollback de emergencia sin un release).
 *     `VITE_FORCE_RESILIENT_ASESOR=1` fuerza el NUEVO ignorando
 *     localStorage (mantenido para compatibilidad con builds canary).
 *
 * El motivo de un feature flag local (no remoto) es que el flujo
 * crítico de IA debe seguir funcionando sin tocar Firestore para
 * leer un config. Esto deja la decisión en el dispositivo del
 * usuario y permite QA / staged rollout vía build env var.
 *
 * Migración de la clave vieja:
 *   - `praeventio:asesor:resilient:v1` (Sprint 54): opt-IN para
 *     nuevo. Si encontramos ese valor='1' en localStorage,
 *     respetamos el opt-in (= ON), pero ya es redundante porque ON
 *     es default ahora.
 *   - `praeventio:asesor:legacy-optout:v2` (Sprint 55): opt-OUT
 *     hacia legacy. Default no presente = nuevo.
 */

import { useCallback, useEffect, useState } from 'react';

/** Clave legacy de Sprint 54 — leída para detectar opt-IN previo (todavía válido pero redundante). */
const LEGACY_OPT_IN_KEY = 'praeventio:asesor:resilient:v1';
/** Clave nueva de Sprint 55 — opt-OUT explícito al legacy. */
const LEGACY_OPT_OUT_KEY = 'praeventio:asesor:legacy-optout:v2';

interface EnvForce {
  forceResilient: boolean;
  forceLegacy: boolean;
}

function readEnvForce(): EnvForce {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> })
      .env;
    const r = env?.VITE_FORCE_RESILIENT_ASESOR;
    const l = env?.VITE_FORCE_LEGACY_ASESOR;
    return {
      forceResilient: r === '1' || r === 'true',
      forceLegacy: l === '1' || l === 'true',
    };
  } catch {
    return { forceResilient: false, forceLegacy: false };
  }
}

function readEnabledFromStorage(): boolean {
  if (typeof localStorage === 'undefined') return true; // default ON
  try {
    // Si hay opt-out explícito hacia legacy → resilient OFF.
    if (localStorage.getItem(LEGACY_OPT_OUT_KEY) === '1') return false;
    // Si hay opt-in del Sprint 54 → resilient ON (redundante con el
    // default actual pero respetado para no romper a quien lo prendió).
    if (localStorage.getItem(LEGACY_OPT_IN_KEY) === '1') return true;
    // Default ON.
    return true;
  } catch {
    return true;
  }
}

function writeLegacyOptOut(v: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (v) localStorage.setItem(LEGACY_OPT_OUT_KEY, '1');
    else localStorage.removeItem(LEGACY_OPT_OUT_KEY);
  } catch {
    // quota / private mode — silently swallow
  }
}

function resolveEnabled(envForce: EnvForce, storageEnabled: boolean): boolean {
  // Priority: env force wins. legacy force tiene mayor prioridad que
  // resilient force (porque es rollback de emergencia).
  if (envForce.forceLegacy) return false;
  if (envForce.forceResilient) return true;
  return storageEnabled;
}

export interface UseResilientAsesorFlagResult {
  /** True si el ResilientAsesorPanel debe renderizarse. */
  enabled: boolean;
  /**
   * Toggle local. Pasar `true` (default ON) limpia el opt-out;
   * pasar `false` setea el opt-out al legacy.
   * NO afecta a otros usuarios — feature flag local.
   */
  setEnabled: (v: boolean) => void;
  /** True si está forzado por env var (UI debería mostrar lock). */
  forcedByEnv: boolean;
}

export function useResilientAsesorFlag(): UseResilientAsesorFlagResult {
  const envForce = readEnvForce();
  const forcedByEnv = envForce.forceLegacy || envForce.forceResilient;
  const [enabled, setEnabledLocal] = useState<boolean>(() =>
    resolveEnabled(envForce, readEnabledFromStorage()),
  );

  // Cross-tab sync.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === LEGACY_OPT_OUT_KEY || e.key === LEGACY_OPT_IN_KEY) {
        setEnabledLocal(resolveEnabled(envForce, readEnabledFromStorage()));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [envForce]);

  const setEnabled = useCallback(
    (v: boolean) => {
      if (forcedByEnv) return; // env force domina, ignoramos toggle local.
      // `v=true` significa "usuario quiere nuevo": eliminar opt-out.
      // `v=false` significa "usuario quiere legacy": setear opt-out.
      writeLegacyOptOut(!v);
      setEnabledLocal(resolveEnabled(envForce, readEnabledFromStorage()));
    },
    [envForce, forcedByEnv],
  );

  return { enabled, setEnabled, forcedByEnv };
}
