/**
 * Resilience Health Monitor — agrega el estado de todos los
 * subsistemas que garantizan la promesa "la IA NUNCA falla" en una
 * sola estructura consumible por UI dashboards y auditores de
 * cumplimiento.
 *
 * Sistemas monitoreados:
 *   - SLM offline (modelo cacheado / pre-empaquetado / acquisition
 *     decision del usuario)
 *   - Zettelkasten retrieval (memory snapshot hidratado / IDB cache
 *     / seed bundle siempre presente)
 *   - Firestore knowledge base (last successful read, offline cache
 *     populated)
 *   - Gemini server reachability
 *   - Device KEK (existe / edad / rotación recomendada)
 *   - Encrypted KV store (records cacheados / tamaño aproximado)
 *
 * Diseñado para correr en frecuencia baja (1× cada 5 min, o on-demand
 * cuando el usuario abre un panel "Estado del Asistente"). Cada
 * checker es inyectable para tests deterministicos.
 *
 * Output: `ResilienceHealthReport` con:
 *   - `overallStatus`: 'healthy' | 'degraded' | 'critical'
 *   - `subsystems[]`: array de estado per subsystem
 *   - `recommendations[]`: acciones sugeridas (e.g. "rotar KEK >90d",
 *     "descargar SLM porque acquisition postponed")
 *   - `generatedAt`: ISO timestamp
 *
 * Pure-function: el caller inyecta los checkers (closures sobre los
 * adapters reales) y el monitor solo agrega + clasifica.
 */

export type SubsystemId =
  | 'slm'
  | 'zettelkasten'
  | 'firestore'
  | 'gemini'
  | 'device_kek'
  | 'encrypted_kv'
  | 'network';

export type SubsystemStatus =
  | 'healthy' // funcionando normal
  | 'degraded' // funciona pero con limitaciones
  | 'critical' // no disponible / falla bloqueante
  | 'unknown'; // no se pudo medir (checker timeout)

export interface SubsystemReport {
  id: SubsystemId;
  status: SubsystemStatus;
  /** Detalle humano de qué se midió. */
  detail: string;
  /** Metadata específica del subsistema (opt). */
  metadata?: Record<string, string | number | boolean | null>;
  /** Latencia del check ms. */
  checkLatencyMs: number;
  /** Error message si status='unknown' (checker falló). */
  error?: string;
}

export interface ResilienceRecommendation {
  /** Severity de la acción sugerida. */
  severity: 'info' | 'warn' | 'critical';
  /** Subsystem que motiva la recomendación. */
  subsystem: SubsystemId;
  /** Acción concreta sugerida al user/operador. */
  action: string;
}

export interface ResilienceHealthReport {
  overallStatus: SubsystemStatus;
  subsystems: SubsystemReport[];
  recommendations: ResilienceRecommendation[];
  generatedAt: string;
  /** Latencia total del agregado ms. */
  totalLatencyMs: number;
}

/**
 * Un checker es una función pura que devuelve la salud de UN
 * subsistema. Recibe `nowMs` para tests deterministicos.
 */
export type SubsystemChecker = (
  nowMs: number,
) => Promise<Omit<SubsystemReport, 'checkLatencyMs'>>;

export interface MonitorOptions {
  /** Override `Date.now()` para tests. */
  nowMs?: () => number;
  /** Timeout por checker en ms. Default 3000. */
  checkerTimeoutMs?: number;
  /**
   * Política de status overall:
   *   - 'strict' = critical si cualquier subsystem es critical
   *   - 'majority' = critical si >50% críticos, degraded si ≥1
   *   - 'slm_priority' = critical solo si slm + zk fallan (los demás
   *     son nice-to-have). Default.
   */
  overallPolicy?: 'strict' | 'majority' | 'slm_priority';
}

interface CheckerInput {
  id: SubsystemId;
  checker: SubsystemChecker | undefined;
}

const DEFAULT_TIMEOUT_MS = 3000;

async function runChecker(
  input: CheckerInput,
  nowMs: () => number,
  timeoutMs: number,
): Promise<SubsystemReport> {
  const startedAt = nowMs();
  if (!input.checker) {
    return {
      id: input.id,
      status: 'unknown',
      detail: `${input.id}: checker not provided`,
      checkLatencyMs: 0,
      error: 'no_checker',
    };
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutP = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(
        () => rej(new Error(`${input.id}: timeout ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    const result = await Promise.race([input.checker(startedAt), timeoutP]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return { ...result, checkLatencyMs: nowMs() - startedAt };
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return {
      id: input.id,
      status: 'unknown',
      detail: `${input.id}: check threw`,
      checkLatencyMs: nowMs() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Overall policy
// ────────────────────────────────────────────────────────────────────────

function aggregateOverallStatus(
  reports: SubsystemReport[],
  policy: NonNullable<MonitorOptions['overallPolicy']>,
): SubsystemStatus {
  const counts: Record<SubsystemStatus, number> = {
    healthy: 0,
    degraded: 0,
    critical: 0,
    unknown: 0,
  };
  for (const r of reports) counts[r.status]++;

  switch (policy) {
    case 'strict':
      if (counts.critical > 0) return 'critical';
      if (counts.degraded > 0 || counts.unknown > 0) return 'degraded';
      return 'healthy';

    case 'majority': {
      const total = reports.length || 1;
      if (counts.critical / total > 0.5) return 'critical';
      if (counts.critical > 0 || counts.degraded > 0) return 'degraded';
      if (counts.unknown > 0) return 'degraded';
      return 'healthy';
    }

    case 'slm_priority':
    default: {
      const slm = reports.find((r) => r.id === 'slm');
      const zk = reports.find((r) => r.id === 'zettelkasten');
      // CRITICAL: slm + zk ambos críticos = la IA local no responde.
      if (slm?.status === 'critical' && zk?.status === 'critical') {
        return 'critical';
      }
      // Si tampoco hay seed bundle (zk crítico) → degraded fuerte
      if (
        slm?.status === 'critical' ||
        zk?.status === 'critical' ||
        counts.critical > 0
      ) {
        return 'degraded';
      }
      if (counts.degraded > 0 || counts.unknown > 0) return 'degraded';
      return 'healthy';
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Recommendation builders
// ────────────────────────────────────────────────────────────────────────

function buildRecommendations(
  reports: SubsystemReport[],
): ResilienceRecommendation[] {
  const recs: ResilienceRecommendation[] = [];

  for (const r of reports) {
    if (r.status === 'critical') {
      recs.push({
        severity: 'critical',
        subsystem: r.id,
        action: actionForCriticalSubsystem(r),
      });
    } else if (r.status === 'degraded') {
      recs.push({
        severity: 'warn',
        subsystem: r.id,
        action: actionForDegradedSubsystem(r),
      });
    } else if (r.status === 'unknown') {
      recs.push({
        severity: 'info',
        subsystem: r.id,
        action: `Verificar conectividad / configuración del subsistema "${r.id}".`,
      });
    }
  }

  // Recomendaciones derivadas de metadata (e.g. KEK vieja).
  const kek = reports.find((r) => r.id === 'device_kek');
  if (kek?.metadata && typeof kek.metadata.ageDays === 'number') {
    const age = kek.metadata.ageDays;
    if (age > 90) {
      recs.push({
        severity: 'warn',
        subsystem: 'device_kek',
        action: `KEK del dispositivo tiene ${age} días. Considera rotación.`,
      });
    }
  }

  return recs;
}

function actionForCriticalSubsystem(r: SubsystemReport): string {
  switch (r.id) {
    case 'slm':
      return 'SLM offline no disponible. Verifica descarga del modelo o reinstala la app.';
    case 'zettelkasten':
      return 'Grafo de conocimiento no responde. Revisa Firestore + IndexedDB cache.';
    case 'firestore':
      return 'Sin conexión a Firestore. Revisa red + permisos de la cuenta.';
    case 'gemini':
      return 'Gemini server no responde. La app sigue funcionando en modo offline.';
    case 'device_kek':
      return 'KEK del dispositivo ausente o corrupta. Datos cacheados serán irrecuperables.';
    case 'encrypted_kv':
      return 'Encrypted store falla. Posible quota IDB exceeded o permisos.';
    case 'network':
      return 'Sin conectividad de red. La app sigue en modo offline.';
    default:
      return `Subsistema ${r.id} no disponible.`;
  }
}

function actionForDegradedSubsystem(r: SubsystemReport): string {
  switch (r.id) {
    case 'slm':
      return 'SLM disponible pero degradado. Revisa cache del modelo o re-descarga.';
    case 'zettelkasten':
      return 'Grafo parcialmente disponible. Algunas queries pueden caer al seed bundle.';
    case 'firestore':
      return 'Firestore responde con latencia. Verifica conexión.';
    case 'gemini':
      return 'Gemini server con latencia alta. La app prioriza tiers locales.';
    case 'device_kek':
      return 'KEK necesita atención (rotación o re-generación).';
    case 'encrypted_kv':
      return 'Encrypted store con records antiguos. Considera limpieza.';
    case 'network':
      return 'Conexión inestable. Algunas funciones server-side pueden fallar.';
    default:
      return `Subsistema ${r.id} degradado.`;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main aggregator
// ────────────────────────────────────────────────────────────────────────

export interface ResilienceCheckers {
  slm?: SubsystemChecker;
  zettelkasten?: SubsystemChecker;
  firestore?: SubsystemChecker;
  gemini?: SubsystemChecker;
  device_kek?: SubsystemChecker;
  encrypted_kv?: SubsystemChecker;
  network?: SubsystemChecker;
}

const ALL_IDS: SubsystemId[] = [
  'slm',
  'zettelkasten',
  'firestore',
  'gemini',
  'device_kek',
  'encrypted_kv',
  'network',
];

export async function buildResilienceHealthReport(
  checkers: ResilienceCheckers,
  options: MonitorOptions = {},
): Promise<ResilienceHealthReport> {
  const nowMsFn = options.nowMs ?? Date.now;
  const timeoutMs = options.checkerTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policy = options.overallPolicy ?? 'slm_priority';

  const startedAt = nowMsFn();
  const reports = await Promise.all(
    ALL_IDS.map((id) =>
      runChecker(
        { id, checker: checkers[id] },
        nowMsFn,
        timeoutMs,
      ),
    ),
  );
  const overallStatus = aggregateOverallStatus(reports, policy);
  const recommendations = buildRecommendations(reports);
  const totalLatencyMs = nowMsFn() - startedAt;

  return {
    overallStatus,
    subsystems: reports,
    recommendations,
    generatedAt: new Date(nowMsFn()).toISOString(),
    totalLatencyMs,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Built-in checker builders (closures que el caller cablea con sus
// dependencias reales)
// ────────────────────────────────────────────────────────────────────────

/**
 * Builder de checker para SLM. Caller pasa una función que devuelve
 * el `AcquisitionStatus` (de `slmAcquisitionService`) y el monitor
 * traduce a healthy/degraded/critical.
 */
export function makeSlmChecker(
  getStatus: () => Promise<{
    state: string;
    isPrePackaged: boolean;
    cachedBytes: number;
  } | null>,
): SubsystemChecker {
  return async () => {
    const s = await getStatus();
    if (!s) {
      return {
        id: 'slm',
        status: 'unknown',
        detail: 'slm: no status returned',
      };
    }
    if (s.state === 'ready') {
      return {
        id: 'slm',
        status: 'healthy',
        detail: s.isPrePackaged
          ? 'SLM pre-empaquetado disponible en el bundle.'
          : `SLM cacheado (${Math.round(s.cachedBytes / 1024 / 1024)} MB).`,
        metadata: {
          state: s.state,
          isPrePackaged: s.isPrePackaged,
          cachedMb: Math.round(s.cachedBytes / 1024 / 1024),
        },
      };
    }
    if (s.state === 'declined') {
      return {
        id: 'slm',
        status: 'degraded',
        detail: 'Usuario eligió solo modo online. SLM no disponible.',
        metadata: { state: s.state },
      };
    }
    if (s.state === 'postponed') {
      return {
        id: 'slm',
        status: 'degraded',
        detail: 'Usuario postergó la descarga del SLM.',
        metadata: { state: s.state },
      };
    }
    if (s.state === 'needs_prompt') {
      return {
        id: 'slm',
        status: 'critical',
        detail: 'SLM no descargado. Sin IA local en emergencias.',
        metadata: { state: s.state },
      };
    }
    if (s.state === 'downloading') {
      return {
        id: 'slm',
        status: 'degraded',
        detail: 'SLM descargándose.',
        metadata: { state: s.state },
      };
    }
    return {
      id: 'slm',
      status: 'unknown',
      detail: `SLM en estado desconocido: ${s.state}`,
    };
  };
}

/**
 * Builder de checker para Zettelkasten. El seed bundle SIEMPRE está
 * disponible — este checker mide si memory/IDB están hidratados o
 * solo el seed.
 */
export function makeZettelkastenChecker(
  getMetrics: () => Promise<{
    memoryNodeCount: number;
    idbNodeCount: number;
    seedAvailable: boolean;
  }>,
): SubsystemChecker {
  return async () => {
    const m = await getMetrics();
    if (!m.seedAvailable) {
      // El seed siempre debería estar — si no, algo está roto en imports.
      return {
        id: 'zettelkasten',
        status: 'critical',
        detail: 'Seed bundle no disponible. Bug en imports.',
        metadata: m as unknown as Record<string, number | boolean>,
      };
    }
    if (m.memoryNodeCount > 0) {
      return {
        id: 'zettelkasten',
        status: 'healthy',
        detail: `${m.memoryNodeCount} nodos en memoria + seed bundle.`,
        metadata: m as unknown as Record<string, number | boolean>,
      };
    }
    if (m.idbNodeCount > 0) {
      return {
        id: 'zettelkasten',
        status: 'degraded',
        detail: `Memoria sin hidratar; ${m.idbNodeCount} nodos en cache IDB + seed.`,
        metadata: m as unknown as Record<string, number | boolean>,
      };
    }
    return {
      id: 'zettelkasten',
      status: 'degraded',
      detail: 'Solo seed bundle disponible (memoria + cache vacíos).',
      metadata: m as unknown as Record<string, number | boolean>,
    };
  };
}

/**
 * Builder de checker para network. Usa `navigator.onLine` (y opcional
 * un ping a un endpoint del backend).
 */
export function makeNetworkChecker(
  pingEndpoint?: (
    nowMs: number,
  ) => Promise<{ ok: boolean; latencyMs?: number }>,
): SubsystemChecker {
  return async (nowMs) => {
    const online =
      typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    if (!online) {
      return {
        id: 'network',
        status: 'degraded',
        detail: 'Sin conexión a red (navigator.onLine=false).',
        metadata: { online: false },
      };
    }
    if (!pingEndpoint) {
      return {
        id: 'network',
        status: 'healthy',
        detail: 'Online según navigator.onLine.',
        metadata: { online: true },
      };
    }
    const r = await pingEndpoint(nowMs);
    if (!r.ok) {
      return {
        id: 'network',
        status: 'degraded',
        detail: 'Online según navigator pero ping al endpoint falló.',
        metadata: { online: true, pingOk: false },
      };
    }
    return {
      id: 'network',
      status: 'healthy',
      detail: r.latencyMs
        ? `Online. Ping ${Math.round(r.latencyMs)}ms.`
        : 'Online.',
      metadata: {
        online: true,
        pingOk: true,
        pingLatencyMs: r.latencyMs ?? null,
      },
    };
  };
}

/**
 * Builder de checker para device KEK. Caller pasa una función que
 * devuelve `{exists, ageMs}` (típicamente `inspectDeviceKek` del
 * módulo deviceKek).
 */
export function makeDeviceKekChecker(
  inspect: () => Promise<{ exists: boolean; ageMs?: number }>,
): SubsystemChecker {
  return async () => {
    const info = await inspect();
    if (!info.exists) {
      return {
        id: 'device_kek',
        status: 'critical',
        detail: 'KEK del dispositivo no existe. Cache encriptado no funciona.',
        metadata: { exists: false },
      };
    }
    const ageMs = info.ageMs ?? 0;
    const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24));
    return {
      id: 'device_kek',
      status: ageDays > 365 ? 'degraded' : 'healthy',
      detail: `KEK del dispositivo ${ageDays} días.`,
      metadata: { exists: true, ageDays, ageMs: Math.round(ageMs) },
    };
  };
}
