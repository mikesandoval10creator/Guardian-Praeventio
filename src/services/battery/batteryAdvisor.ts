// Praeventio Guard — TODO.md §12.2.8: Battery-aware polling advisor.
//
// IMPLEMENTATION_ROADMAP:1054-1080 — los hooks de sensor (BLE, HR, GPS,
// camera, MediaPipe) en un turno de 12h no pueden agotar la batería del
// teléfono antes de que termine. Budget aceptable documentado:
//   - BLE proximity poll: <3%/hora
//   - MediaPipe pose worker: <8%/hora
//   - GPS continuous: <5%/hora
//   - Total combinado: <12%/hora → batería 100% sobrevive 8h+ turno
//
// Cuando la batería baja de umbral, este módulo expone multiplicadores
// que cada hook de sensor consulta para REDUCIR su polling automático.
// No bloquea sensores críticos (panic button, fall detect) — esos
// SIEMPRE corren a max-priority. Política directiva #2: nunca decidir
// por el humano, solo ajustar consumo del polling automático.
//
// Pure module + navigator.getBattery() API. Sin Zustand para mantenerlo
// usable desde el sensorBus correlation y desde hooks individuales.

export type BatteryMode = 'normal' | 'conservative' | 'low' | 'critical';

export interface BatterySnapshot {
  /** 0..1 fracción de batería disponible (null si API no disponible). */
  level: number | null;
  /** True si está cargando (no aplica throttling). */
  charging: boolean;
  /** Mode derivado del level + charging. */
  mode: BatteryMode;
  /** ISO-8601 cuando se tomó la lectura. */
  capturedAt: string;
}

/**
 * Multiplicadores de intervalo de polling por tipo de sensor. Si el
 * hook normalmente polla cada 5000ms y el multiplicador es 2.0, polla
 * cada 10000ms (consume mitad). Mode 'critical' multiplica por 5x
 * (poll cada 25s) — datos siguen llegando pero el consumo es mínimo.
 *
 * IMPORTANT: los sensores críticos para emergencia (fall_detect,
 * lone_worker_panic) NUNCA usan estos multiplicadores — siempre van
 * a `intervalMs` original. Solo el polling activo de telemetría se
 * ajusta. Lo refleja `applyThrottle` con el flag `criticalSensor`.
 */
export const POLL_MULTIPLIERS: Record<BatteryMode, number> = {
  normal: 1,
  conservative: 1.5,
  low: 3,
  critical: 5,
};

/** Umbrales (level 0..1) para transición de modo. */
const LOW_THRESHOLD = 0.2;       // <20% → conservative
const CRITICAL_THRESHOLD = 0.1;  // <10% → critical
const RESTORE_BUFFER = 0.03;     // hysteresis para no oscilar

let cachedSnapshot: BatterySnapshot | null = null;

interface NavigatorBatteryShape {
  getBattery?: () => Promise<{
    level: number;
    charging: boolean;
    addEventListener?: (kind: string, fn: () => void) => void;
  }>;
}

function classifyMode(level: number, charging: boolean): BatteryMode {
  if (charging) return 'normal';
  if (level < CRITICAL_THRESHOLD) return 'critical';
  if (level < LOW_THRESHOLD - RESTORE_BUFFER) return 'low';
  if (level < LOW_THRESHOLD) return 'conservative';
  return 'normal';
}

/**
 * Lee el snapshot actual. Cachea el último resultado y registra
 * listeners para invalidar cuando el browser dispara `levelchange` /
 * `chargingchange`. En entornos donde `navigator.getBattery` no existe
 * (iOS Safari, server-side, jsdom) devuelve `mode: 'normal'` con
 * `level: null` — el caller asume comportamiento default.
 */
export async function getBatterySnapshot(): Promise<BatterySnapshot> {
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as NavigatorBatteryShape)
      : null;
  if (!nav?.getBattery) {
    return {
      level: null,
      charging: false,
      mode: 'normal',
      capturedAt: new Date().toISOString(),
    };
  }
  try {
    const b = await nav.getBattery();
    const mode = classifyMode(b.level, b.charging);
    cachedSnapshot = {
      level: b.level,
      charging: b.charging,
      mode,
      capturedAt: new Date().toISOString(),
    };
    // Register listeners una sola vez para que el cache se invalide.
    if (b.addEventListener) {
      b.addEventListener('levelchange', () => {
        cachedSnapshot = null;
      });
      b.addEventListener('chargingchange', () => {
        cachedSnapshot = null;
      });
    }
    return cachedSnapshot;
  } catch {
    return {
      level: null,
      charging: false,
      mode: 'normal',
      capturedAt: new Date().toISOString(),
    };
  }
}

export interface ApplyThrottleOptions {
  /** Sensores que NUNCA se throttlean (fall, panic, lone_worker). */
  criticalSensor?: boolean;
  /** Override mode para tests (skip la API del navegador). */
  modeOverride?: BatteryMode;
}

/**
 * Calcula el intervalo de polling ajustado según el modo de batería.
 * `baseIntervalMs` es el valor que el hook usaría a batería 100%.
 *
 *   const ms = await applyBatteryThrottle(5000); // poll cada 5s normal,
 *                                                // 25s en critical.
 *
 * Sensores críticos (panic, fall) deben pasar `{ criticalSensor: true }`
 * para retornar el intervalo original sin throttle.
 */
export async function applyBatteryThrottle(
  baseIntervalMs: number,
  options: ApplyThrottleOptions = {},
): Promise<number> {
  if (options.criticalSensor) return baseIntervalMs;
  const mode = options.modeOverride
    ? options.modeOverride
    : (await getBatterySnapshot()).mode;
  return Math.round(baseIntervalMs * POLL_MULTIPLIERS[mode]);
}

/**
 * Sincrónico variant — si el caller ya tiene el snapshot (cacheado o
 * inyectado), evita el await. Útil dentro de loops de polling donde
 * llamar getBatterySnapshot() en cada tick sería desperdicio.
 */
export function applyBatteryThrottleSync(
  baseIntervalMs: number,
  mode: BatteryMode,
  options: { criticalSensor?: boolean } = {},
): number {
  if (options.criticalSensor) return baseIntervalMs;
  return Math.round(baseIntervalMs * POLL_MULTIPLIERS[mode]);
}

/** Reset cache para tests (vitest no comparte process entre files). */
export function __resetBatteryCache(): void {
  cachedSnapshot = null;
}

/** Inject snapshot para tests. */
export function __setBatterySnapshotForTests(
  s: BatterySnapshot | null,
): void {
  cachedSnapshot = s;
}

/** Lee el cache directo sin tocar navigator (para sensorBus que ya
 *  capturó un reading de tipo 'battery'). */
export function getCachedBatterySnapshot(): BatterySnapshot | null {
  return cachedSnapshot;
}
