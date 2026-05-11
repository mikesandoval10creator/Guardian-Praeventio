// Praeventio Guard — Sprint 39 Fase L.8: Plan de Excavación Segura.
//
// Cierra: Documento usuario "§347-349" — Top usuario #11
//
// Extiende `workPermitEngine` (que ya soporta `kind: 'excavacion'`)
// con metadata específica:
//   - profundidad + ángulo de talud
//   - presencia de entibación
//   - servicios enterrados identificados
//   - acceso/escape (escalera, rampa)
//   - condición atmosférica (si profundidad >1.2m DS 132)
//   - lluvia → bloqueo soft
//
// Determinístico. Las reglas vienen de DS 594 + DS 132 + OSHA 1926
// Subpart P (referencia internacional).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SoilType = 'roca' | 'tipoA' | 'tipoB' | 'tipoC';

export interface BurialService {
  kind: 'electric' | 'gas' | 'water' | 'fiber' | 'sewer' | 'unknown';
  /** Profundidad estimada del servicio (m). */
  depthMeters?: number;
  /** Si fue confirmado por planos / detección. */
  confirmed: boolean;
}

export type AccessKind = 'escalera_fija' | 'escalera_portatil' | 'rampa' | 'plataforma_elevadora';

export interface ExcavationMetadata {
  /** Profundidad estimada de la excavación (m). */
  depthMeters: number;
  /** Ángulo de talud lateral (grados, 0=vertical, 45=normal). */
  slopeAngleDegrees: number;
  /** Si hay entibación instalada. */
  hasShoring: boolean;
  /** Tipo de suelo. */
  soilType: SoilType;
  /** Servicios enterrados identificados. */
  identifiedServices: BurialService[];
  /** Métodos de acceso/escape (mínimo 1). */
  accessKinds: AccessKind[];
  /** Distancia desde el extremo de la excavación al acceso más cercano (m). */
  maxDistanceToAccessMeters: number;
  /** Atmósfera medida si profundidad > 1.2m. */
  atmosphereMeasurement?: {
    o2Percent: number;
    coPpm: number;
    lel: number; // % límite explosivo inferior
  };
  /** Probabilidad de lluvia en las próximas 24h (%). */
  rainProbability24h?: number;
}

export class ExcavationValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'ExcavationValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Thresholds (DS 594 + OSHA 1926 Subpart P)
// ────────────────────────────────────────────────────────────────────────

/** Profundidad sobre la que se exige entibación o talud certificado. */
const DEPTH_REQUIRING_SHORING = 1.5;
/** Profundidad sobre la que se exige medición atmosférica. */
const DEPTH_REQUIRING_ATMOSPHERE = 1.2;
/** Distancia máxima permitida entre cualquier punto y un acceso. */
const MAX_DISTANCE_TO_ACCESS = 7.5;
/** Ángulo de talud mínimo seguro por tipo de suelo (OSHA Subpart P). */
const MIN_SLOPE_ANGLE: Record<SoilType, number> = {
  roca: 0,
  tipoA: 53,
  tipoB: 45,
  tipoC: 34,
};
/** Probabilidad lluvia > 60% → soft block. */
const RAIN_SOFT_BLOCK_PCT = 60;

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export interface ExcavationValidationReport {
  isShoringRequired: boolean;
  isAtmosphereRequired: boolean;
  isAtmosphereCompliant: boolean;
  slopeIsCompliant: boolean;
  accessIsCompliant: boolean;
  rainSoftBlock: boolean;
  unconfirmedServicesCount: number;
  issues: Array<{ code: string; severity: 'block' | 'warn'; message: string }>;
}

export function validateExcavation(meta: ExcavationMetadata): ExcavationValidationReport {
  if (meta.depthMeters <= 0) {
    throw new ExcavationValidationError('INVALID_DEPTH', 'depthMeters must be > 0');
  }
  if (meta.accessKinds.length === 0) {
    throw new ExcavationValidationError('NO_ACCESS', 'al menos un acceso/escape requerido');
  }

  const issues: ExcavationValidationReport['issues'] = [];

  // Shoring requirement
  const isShoringRequired = meta.depthMeters >= DEPTH_REQUIRING_SHORING;
  if (isShoringRequired && !meta.hasShoring) {
    issues.push({
      code: 'BLOCK_NO_SHORING',
      severity: 'block',
      message: `Profundidad ${meta.depthMeters}m ≥ ${DEPTH_REQUIRING_SHORING}m y sin entibación instalada.`,
    });
  }

  // Slope compliance
  const minAngle = MIN_SLOPE_ANGLE[meta.soilType];
  const slopeIsCompliant = meta.slopeAngleDegrees >= minAngle;
  if (!slopeIsCompliant && !meta.hasShoring) {
    issues.push({
      code: 'BLOCK_SLOPE_INADEQUATE',
      severity: 'block',
      message: `Talud ${meta.slopeAngleDegrees}° < mínimo ${minAngle}° para suelo ${meta.soilType} y sin entibación compensatoria.`,
    });
  }

  // Atmosphere
  const isAtmosphereRequired = meta.depthMeters >= DEPTH_REQUIRING_ATMOSPHERE;
  let isAtmosphereCompliant = true;
  if (isAtmosphereRequired) {
    if (!meta.atmosphereMeasurement) {
      isAtmosphereCompliant = false;
      issues.push({
        code: 'BLOCK_NO_ATMOSPHERE_MEASURE',
        severity: 'block',
        message: `Profundidad ${meta.depthMeters}m ≥ ${DEPTH_REQUIRING_ATMOSPHERE}m exige medición atmosférica previa.`,
      });
    } else {
      const m = meta.atmosphereMeasurement;
      const o2Ok = m.o2Percent >= 19.5 && m.o2Percent <= 23.5;
      const coOk = m.coPpm < 35;
      const lelOk = m.lel < 10;
      isAtmosphereCompliant = o2Ok && coOk && lelOk;
      if (!o2Ok) {
        issues.push({
          code: 'BLOCK_O2_OUT_OF_RANGE',
          severity: 'block',
          message: `O2 ${m.o2Percent}% fuera de rango [19.5, 23.5].`,
        });
      }
      if (!coOk) {
        issues.push({
          code: 'BLOCK_CO_HIGH',
          severity: 'block',
          message: `CO ${m.coPpm} ppm >= 35 ppm.`,
        });
      }
      if (!lelOk) {
        issues.push({
          code: 'BLOCK_LEL_HIGH',
          severity: 'block',
          message: `LEL ${m.lel}% >= 10%.`,
        });
      }
    }
  }

  // Access
  const accessIsCompliant = meta.maxDistanceToAccessMeters <= MAX_DISTANCE_TO_ACCESS;
  if (!accessIsCompliant) {
    issues.push({
      code: 'WARN_ACCESS_TOO_FAR',
      severity: 'warn',
      message: `Distancia a acceso ${meta.maxDistanceToAccessMeters}m > ${MAX_DISTANCE_TO_ACCESS}m. Agregar punto de escape adicional.`,
    });
  }

  // Rain soft block
  const rainSoftBlock = (meta.rainProbability24h ?? 0) > RAIN_SOFT_BLOCK_PCT;
  if (rainSoftBlock) {
    issues.push({
      code: 'WARN_RAIN_RISK',
      severity: 'warn',
      message: `Probabilidad lluvia próximas 24h: ${meta.rainProbability24h}%. Reevaluar antes de operar.`,
    });
  }

  // Unconfirmed services
  const unconfirmedServices = meta.identifiedServices.filter((s) => !s.confirmed);
  if (unconfirmedServices.length > 0) {
    issues.push({
      code: 'WARN_UNCONFIRMED_SERVICES',
      severity: 'warn',
      message: `${unconfirmedServices.length} servicio(s) enterrado(s) sin confirmar (${unconfirmedServices
        .map((s) => s.kind)
        .join(', ')}). Coordinar verificación por planos o detección.`,
    });
  }

  return {
    isShoringRequired,
    isAtmosphereRequired,
    isAtmosphereCompliant,
    slopeIsCompliant,
    accessIsCompliant,
    rainSoftBlock,
    unconfirmedServicesCount: unconfirmedServices.length,
    issues,
  };
}

export function canAuthorizeExcavation(report: ExcavationValidationReport): boolean {
  return !report.issues.some((i) => i.severity === 'block');
}
