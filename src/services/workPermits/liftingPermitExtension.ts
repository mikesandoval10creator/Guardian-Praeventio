// Praeventio Guard — Sprint 39 Fase L.7: Izaje Crítico.
//
// Cierra: Documento usuario "§341-346" — Top usuario #10
//
// Extiende `workPermitEngine` (que ya soporta `kind: 'izaje_critico'`)
// con metadata específica:
//   - peso de carga + radio operación
//   - capacidad de la grúa (validación uso% vs nominal)
//   - operador uid (validar licencia vigente fuera de este módulo)
//   - rigger uid
//   - señalero uid (validar autorización fuera)
//   - velocidad viento (umbral DS 132 + manual fabricante grúas)
//   - zona de exclusión (geocerca temporal)
//
// La lógica es DETERMINÍSTICA. NO reemplaza el cálculo de ingeniería
// (ese debe firmarlo un PI/ME competente) — esto valida datos mínimos.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface LiftingMetadata {
  /** Peso de la carga (kg). */
  loadWeightKg: number;
  /** Radio de operación al momento del izaje (m). */
  operationRadiusMeters: number;
  /** Capacidad nominal de la grúa al radio operación (kg). */
  craneRatedCapacityKg: number;
  /** Identificador del equipo grúa. */
  craneId: string;
  /** Operador de la grúa. */
  operatorUid: string;
  /** Rigger encargado del aparejo. */
  riggerUid: string;
  /** Señalero (puede ser el mismo rigger si está autorizado). */
  signalerUid: string;
  /** Velocidad del viento al momento (m/s). */
  windSpeedMs: number;
  /** Visibilidad reducida (lluvia/niebla). */
  reducedVisibility: boolean;
  /** Zona de exclusión: radio en m alrededor del punto de izaje. */
  exclusionZoneRadiusMeters: number;
}

export class LiftingValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'LiftingValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Thresholds (DS 132 + buenas prácticas fabricantes — Liebherr/Manitowoc)
// ────────────────────────────────────────────────────────────────────────

/** Por sobre 11 m/s (39 km/h) la mayoría de fabricantes recomienda detener. */
const WIND_SHUTDOWN_MS = 11;
/** Por encima del 90% capacidad, advertencia obligatoria. */
const CAPACITY_WARNING_RATIO = 0.9;
/** Por encima del 100% bloqueamos. */
const CAPACITY_BLOCK_RATIO = 1.0;

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export interface LiftingValidationReport {
  /** Ratio uso = loadWeightKg / craneRatedCapacityKg. */
  capacityUseRatio: number;
  /** True si capacityUseRatio > 1.0 → BLOQUEO. */
  isOverCapacity: boolean;
  /** True si entre 0.9 y 1.0 → ADVERTENCIA. */
  isNearLimit: boolean;
  /** True si viento >= 11 m/s → BLOQUEO. */
  windExceedsLimit: boolean;
  /** True si distintos UIDs entre operator, rigger, signaler (mejor práctica) */
  hasIndependentSignaler: boolean;
  /** Lista de bloqueos (BLOCK_*) y advertencias (WARN_*). */
  issues: Array<{ code: string; severity: 'block' | 'warn'; message: string }>;
}

export function validateLifting(meta: LiftingMetadata): LiftingValidationReport {
  if (meta.craneRatedCapacityKg <= 0) {
    throw new LiftingValidationError(
      'INVALID_RATED_CAPACITY',
      'craneRatedCapacityKg must be > 0',
    );
  }
  if (meta.loadWeightKg <= 0) {
    throw new LiftingValidationError('INVALID_LOAD_WEIGHT', 'loadWeightKg must be > 0');
  }
  if (meta.operationRadiusMeters <= 0) {
    throw new LiftingValidationError('INVALID_RADIUS', 'operationRadiusMeters must be > 0');
  }

  const capacityUseRatio = meta.loadWeightKg / meta.craneRatedCapacityKg;
  const isOverCapacity = capacityUseRatio > CAPACITY_BLOCK_RATIO;
  const isNearLimit = !isOverCapacity && capacityUseRatio >= CAPACITY_WARNING_RATIO;
  const windExceedsLimit = meta.windSpeedMs >= WIND_SHUTDOWN_MS;
  const hasIndependentSignaler =
    meta.signalerUid !== meta.operatorUid && meta.signalerUid !== meta.riggerUid;

  const issues: LiftingValidationReport['issues'] = [];

  if (isOverCapacity) {
    issues.push({
      code: 'BLOCK_OVER_CAPACITY',
      severity: 'block',
      message: `Carga ${(capacityUseRatio * 100).toFixed(1)}% de capacidad nominal — supera el 100%, prohibido izar.`,
    });
  } else if (isNearLimit) {
    issues.push({
      code: 'WARN_NEAR_LIMIT',
      severity: 'warn',
      message: `Carga ${(capacityUseRatio * 100).toFixed(1)}% de capacidad nominal — revisar tabla de cargas y supervisar.`,
    });
  }
  if (windExceedsLimit) {
    issues.push({
      code: 'BLOCK_WIND',
      severity: 'block',
      message: `Viento ${meta.windSpeedMs.toFixed(1)} m/s supera umbral ${WIND_SHUTDOWN_MS} m/s — postergar izaje.`,
    });
  }
  if (meta.reducedVisibility) {
    issues.push({
      code: 'WARN_VISIBILITY',
      severity: 'warn',
      message: 'Visibilidad reducida (lluvia/niebla) — evaluar postergar o usar comunicación radio dedicada.',
    });
  }
  if (!hasIndependentSignaler) {
    issues.push({
      code: 'WARN_SIGNALER_NOT_INDEPENDENT',
      severity: 'warn',
      message: 'Señalero coincide con operador o rigger — recomendable un señalero independiente.',
    });
  }
  if (meta.exclusionZoneRadiusMeters < meta.operationRadiusMeters * 1.2) {
    issues.push({
      code: 'WARN_EXCLUSION_ZONE_SMALL',
      severity: 'warn',
      message: `Zona de exclusión ${meta.exclusionZoneRadiusMeters}m < 120% del radio operación ${meta.operationRadiusMeters}m.`,
    });
  }

  return {
    capacityUseRatio,
    isOverCapacity,
    isNearLimit,
    windExceedsLimit,
    hasIndependentSignaler,
    issues,
  };
}

/**
 * Quick-helper: ¿se puede autorizar el izaje? True si NO hay issues
 * con severity='block'. Las advertencias no bloquean — requieren
 * registro pero no impiden ejecutar.
 */
export function canAuthorizeLifting(report: LiftingValidationReport): boolean {
  return !report.issues.some((i) => i.severity === 'block');
}
