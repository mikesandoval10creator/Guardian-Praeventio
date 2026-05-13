// Praeventio Guard — Sprint 51 §161-162: AI Mode Controller (AI-off toggle + local fallback)
//
// Cierra §161 (modo sin IA: toggle global que apaga LLM y usa solo reglas
// determinísticas) y §162 (IA local fallback: cuando red está mala, usar SLM
// local) de la 2da tanda usuario.
//
// 100% determinístico. NO invoca LLMs ni red. Es la capa que decide ANTES
// de cualquier llamada a Gemini/Vertex si el caller debe ir a cloud, a SLM
// local, o quedarse en reglas determinísticas.

// ────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────────

/**
 * Modos disponibles para la capa de IA.
 *
 * - `full_cloud`: todas las llamadas van a Gemini/Vertex.
 * - `cloud_with_local_fallback`: intenta cloud primero, si falla cae a SLM local.
 * - `local_only`: solo SLM local (sin red).
 * - `rules_only`: cero LLM. Todo se resuelve con motores determinísticos
 *   (compliance, hazard rules, normativa, etc.).
 */
export type AiMode =
  | 'full_cloud'
  | 'cloud_with_local_fallback'
  | 'local_only'
  | 'rules_only';

/** Calidad de red detectada por el cliente. */
export type NetworkClass =
  | 'wifi'
  | 'cellular_4g'
  | 'cellular_3g'
  | 'edge_or_worse'
  | 'offline';

/** Estado de batería del dispositivo. */
export type BatteryClass = 'plenty' | 'sufficient' | 'low' | 'critical';

/** Preferencia explícita del usuario en settings. */
export type UserAiPreference = 'auto' | 'cloud' | 'local' | 'off';

/**
 * Snapshot del estado del dispositivo / tenant para tomar la decisión.
 * Debe ser construido por el caller justo antes de pedir la decisión.
 */
export interface AiCapabilitySnapshot {
  networkClass: NetworkClass;
  batteryClass: BatteryClass;
  userPref: UserAiPreference;
  /** Si el SLM local ya está cargado en memoria (loader.ts lo dice). */
  localModelLoaded: boolean;
  /** Si el tenant ya quemó su cuota mensual de cloud LLM. */
  tenantBudgetExceeded: boolean;
}

/** Resultado de la decisión: cómo debe comportarse la app respecto a IA. */
export interface AiModeDecision {
  mode: AiMode;
  reason: string;
  /** Si el caller debe usar solo determinísticos (no llamar a LLMs). */
  useRulesOnly: boolean;
  /** Si debe avisar al usuario que está degradado. */
  informUserOfDegradation: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────

const GOOD_NETWORK: ReadonlySet<NetworkClass> = new Set<NetworkClass>([
  'wifi',
  'cellular_4g',
]);

const POOR_NETWORK: ReadonlySet<NetworkClass> = new Set<NetworkClass>([
  'edge_or_worse',
  'cellular_3g',
]);

function isGoodNetwork(n: NetworkClass): boolean {
  return GOOD_NETWORK.has(n);
}

function isPoorButOnline(n: NetworkClass): boolean {
  return POOR_NETWORK.has(n);
}

/**
 * Resuelve fallback cuando NO podemos ir a cloud:
 *  - si hay SLM local cargado → `local_only`
 *  - si no → `rules_only`
 */
function fallbackOffCloud(
  snapshot: AiCapabilitySnapshot,
  reasonIfLocal: string,
  reasonIfRules: string,
  informUser: boolean,
): AiModeDecision {
  if (snapshot.localModelLoaded) {
    return {
      mode: 'local_only',
      reason: reasonIfLocal,
      useRulesOnly: false,
      informUserOfDegradation: informUser,
    };
  }
  return {
    mode: 'rules_only',
    reason: reasonIfRules,
    useRulesOnly: true,
    informUserOfDegradation: informUser,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Decisión principal
// ────────────────────────────────────────────────────────────────────────

/**
 * Decide el modo de operación de IA en base al snapshot del dispositivo.
 *
 * Orden de prioridad (el primero que matchea gana):
 *  1. userPref='off' → `rules_only`
 *  2. tenantBudgetExceeded → `rules_only` + informUser
 *  3. networkClass='offline' → local o rules según localModelLoaded
 *  4. userPref='local' → local o rules según localModelLoaded
 *  5. userPref='cloud' + good network → `full_cloud`
 *  6. batteryClass='critical' o networkClass poor → `cloud_with_local_fallback`
 *     (si NO hay localModelLoaded, sigue siendo cloud_with_local_fallback;
 *      cloud intentará y si truena el caller usa reglas)
 *  7. userPref='auto' + good network → `full_cloud`
 *  8. default → `cloud_with_local_fallback`
 */
export function decideAiMode(snapshot: AiCapabilitySnapshot): AiModeDecision {
  // 1) Toggle explícito del usuario: AI OFF
  if (snapshot.userPref === 'off') {
    return {
      mode: 'rules_only',
      reason: 'user_pref_off',
      useRulesOnly: true,
      // no es "degradación", es decisión consciente del usuario
      informUserOfDegradation: false,
    };
  }

  // 2) Budget tenant agotado: no podemos quemar más cloud
  if (snapshot.tenantBudgetExceeded) {
    return {
      mode: 'rules_only',
      reason: 'tenant_budget_exceeded',
      useRulesOnly: true,
      informUserOfDegradation: true,
    };
  }

  // 3) Sin red: solo local o reglas
  if (snapshot.networkClass === 'offline') {
    return fallbackOffCloud(
      snapshot,
      'offline_using_local_slm',
      'offline_no_local_model_rules_only',
      true,
    );
  }

  // 4) Preferencia local explícita
  if (snapshot.userPref === 'local') {
    return fallbackOffCloud(
      snapshot,
      'user_pref_local',
      'user_pref_local_but_no_model_rules_only',
      !snapshot.localModelLoaded, // solo informa si no hay modelo
    );
  }

  // 5) Preferencia cloud explícita + red buena
  if (snapshot.userPref === 'cloud' && isGoodNetwork(snapshot.networkClass)) {
    return {
      mode: 'full_cloud',
      reason: 'user_pref_cloud_good_network',
      useRulesOnly: false,
      informUserOfDegradation: false,
    };
  }

  // 6) Batería crítica o red pobre pero online → fallback híbrido
  const battCritical = snapshot.batteryClass === 'critical';
  const poorNet = isPoorButOnline(snapshot.networkClass);
  if (battCritical || poorNet) {
    return {
      mode: 'cloud_with_local_fallback',
      reason: battCritical
        ? 'battery_critical_hybrid'
        : 'poor_network_hybrid',
      useRulesOnly: false,
      informUserOfDegradation: true,
    };
  }

  // 7) Auto + red buena → full cloud
  if (snapshot.userPref === 'auto' && isGoodNetwork(snapshot.networkClass)) {
    return {
      mode: 'full_cloud',
      reason: 'auto_good_network',
      useRulesOnly: false,
      informUserOfDegradation: false,
    };
  }

  // 8) Default seguro: híbrido
  return {
    mode: 'cloud_with_local_fallback',
    reason: 'default_hybrid',
    useRulesOnly: false,
    informUserOfDegradation: false,
  };
}

/**
 * Helper de conveniencia: devuelve `true` si el caller debe esquivar
 * cualquier LLM y resolver con reglas determinísticas.
 */
export function shouldUseRulesOnly(snapshot: AiCapabilitySnapshot): boolean {
  return decideAiMode(snapshot).useRulesOnly;
}
