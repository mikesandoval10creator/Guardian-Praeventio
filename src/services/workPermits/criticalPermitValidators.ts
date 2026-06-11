// Praeventio Guard — Validadores profundos por kind de permiso crítico.
//
// El `workPermitEngine.issuePermit` valida pre-condiciones genéricas
// (training, EPP, aprobador, checklist). Esta capa añade validaciones
// específicas por tipo industrial — las que requieren cálculo o tablas
// de referencia y que un prevencionista NO debería tener que memorizar:
//
//   - Izaje crítico: ratio carga/capacidad nominal, umbral viento,
//     operador con licencia, rigger asignado, señalero distinto del
//     operador (DS 132 + ISO 12480-1)
//   - Excavación segura: profundidad, ángulos talud, entibación
//     mandatoria, servicios enterrados, medición atmosférica si
//     profundidad > 1.2 m (DS 594 + NCh 349)
//   - LOTO/bloqueo: identificar todas las fuentes de energía,
//     candados personales, secuencia de aislamiento, verificación
//     "try-out" (DS 132 + NFPA 70E art. 120)
//   - Confinado: medición pre-ingreso (O₂, CO, H₂S, LEL), ventilación
//     forzada, vigía exterior con comm, equipo rescate (DS 594 + MINSAL)
//   - Caliente: distancia a combustibles, extintor, vigía contra
//     incendio, suspensión 30 min post-trabajo
//   - Altura: arnés + línea de vida + punto anclaje certificado,
//     viento umbral (11 m/s = ADVERTENCIA, 15 m/s = BLOQUEO según
//     ISO 21597), plan rescate
//
// El motor NO toma decisiones — devuelve issues con severidad:
//   - 'blocking': el permiso NO debe emitirse hasta resolver
//   - 'advisory': se emite pero con observación registrada (auditoría)
//   - 'info': contexto sin consecuencia operativa
//
// Caller decide cómo presentar al supervisor (mostrar todos los blockers
// + permitir override con razón documentada, mostrar advisories como
// banner, etc).

import type { WorkPermitKind } from './workPermitEngine.js';

// ────────────────────────────────────────────────────────────────────────
// Common types
// ────────────────────────────────────────────────────────────────────────

export type IssueSeverity = 'blocking' | 'advisory' | 'info';

export interface CriticalIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Contexto numérico/metadata para que la UI muestre el detalle. */
  context?: Record<string, string | number | boolean>;
}

export interface CriticalValidationResult {
  kind: WorkPermitKind;
  issues: CriticalIssue[];
  /** Convenience: hay al menos un blocking issue. */
  hasBlockers: boolean;
  /** Convenience: hay al menos un advisory issue. */
  hasAdvisories: boolean;
}

function summarize(
  kind: WorkPermitKind,
  issues: CriticalIssue[],
): CriticalValidationResult {
  return {
    kind,
    issues,
    hasBlockers: issues.some((i) => i.severity === 'blocking'),
    hasAdvisories: issues.some((i) => i.severity === 'advisory'),
  };
}

// ────────────────────────────────────────────────────────────────────────
// IZAJE CRÍTICO (§341-346)
// ────────────────────────────────────────────────────────────────────────

export interface IzajeMetadata {
  /** Peso de la carga en kg. */
  loadWeightKg: number;
  /** Radio de operación en metros (centro grúa → carga). */
  operatingRadiusMeters: number;
  /** Capacidad nominal de la grúa a ese radio (kg). */
  craneCapacityAtRadiusKg: number;
  /** UID operador grúa (DEBE tener licencia clase D + curso operador). */
  craneOperatorUid: string;
  /** True si el operador tiene licencia + curso vigentes. */
  craneOperatorCertified: boolean;
  /** UID rigger (encargado del rigging, distinto del operador). */
  riggerUid?: string;
  /** UID señalero (distinto del operador y rigger). */
  signalerUid?: string;
  /** Velocidad viento al momento del request (m/s). */
  windSpeedMps?: number;
  /** Marcada la zona de exclusión bajo la carga. */
  exclusionZoneMarked: boolean;
  /** Inspección de eslingas/grilletes/accesorios verificada. */
  riggingInspected: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Gas atmosphere thresholds (DS 594 + protocolo MINSAL espacios confinados)
// ────────────────────────────────────────────────────────────────────────
// Exported as the SINGLE source of truth for gas limits: consumed both by
// `validateExcavation` below (declared pre-entry measurement) and by the
// telemetry gas gate (`gasGate.ts`, arista C3) so the soft-block on
// confined-space permit signing uses exactly the same table. Do NOT
// duplicate these numbers elsewhere.

/** Safe oxygen range (volume %). Below = deficiency, above = enrichment. */
export const GAS_OXYGEN_MIN_PCT = 19.5;
export const GAS_OXYGEN_MAX_PCT = 23.5;
/** LEL (% of lower explosive limit): ≥10 blocks, ≥5 warrants re-measuring. */
export const GAS_LEL_BLOCKING_PCT = 10;
export const GAS_LEL_ADVISORY_PCT = 5;

/** Umbral wind speed — ISO 12480 + buenas prácticas mineras. */
const IZAJE_WIND_ADVISORY_MPS = 11; // ~40 km/h: pausar carga si supera
const IZAJE_WIND_BLOCKING_MPS = 15; // ~54 km/h: NO izar

/** Ratio carga/capacidad — sobre 85% es zona crítica. */
const IZAJE_LIFT_RATIO_CRITICAL = 0.85;
const IZAJE_LIFT_RATIO_OVER_CAPACITY = 1.0;

export function validateIzajeCritico(
  m: IzajeMetadata,
): CriticalValidationResult {
  const issues: CriticalIssue[] = [];

  // 1. Carga vs capacidad
  if (m.craneCapacityAtRadiusKg <= 0) {
    issues.push({
      severity: 'blocking',
      code: 'CRANE_CAPACITY_INVALID',
      message: 'Capacidad nominal de la grúa debe ser > 0.',
    });
  } else {
    const ratio = m.loadWeightKg / m.craneCapacityAtRadiusKg;
    if (ratio > IZAJE_LIFT_RATIO_OVER_CAPACITY) {
      issues.push({
        severity: 'blocking',
        code: 'OVER_CAPACITY',
        message: `Carga ${m.loadWeightKg} kg supera la capacidad nominal ${m.craneCapacityAtRadiusKg} kg a radio ${m.operatingRadiusMeters} m.`,
        context: { ratio: Number(ratio.toFixed(3)) },
      });
    } else if (ratio > IZAJE_LIFT_RATIO_CRITICAL) {
      issues.push({
        severity: 'advisory',
        code: 'NEAR_CAPACITY',
        message: `Uso de capacidad ${(ratio * 100).toFixed(1)}% (>85%). Considera una grúa de mayor capacidad o reducir el radio.`,
        context: { ratio: Number(ratio.toFixed(3)) },
      });
    }
  }

  // 2. Operador certificado
  if (!m.craneOperatorCertified) {
    issues.push({
      severity: 'blocking',
      code: 'OPERATOR_NOT_CERTIFIED',
      message: `Operador ${m.craneOperatorUid} sin licencia/curso vigente.`,
    });
  }

  // 3. Rigger + señalero presentes y distintos
  if (!m.riggerUid) {
    issues.push({
      severity: 'blocking',
      code: 'RIGGER_MISSING',
      message: 'Izaje crítico requiere rigger asignado.',
    });
  }
  if (!m.signalerUid) {
    issues.push({
      severity: 'blocking',
      code: 'SIGNALER_MISSING',
      message: 'Izaje crítico requiere señalero asignado.',
    });
  }
  if (
    m.signalerUid &&
    (m.signalerUid === m.craneOperatorUid || m.signalerUid === m.riggerUid)
  ) {
    issues.push({
      severity: 'blocking',
      code: 'SIGNALER_DUAL_ROLE',
      message:
        'El señalero NO puede ser el operador ni el rigger (independencia funcional, ISO 12480-1).',
    });
  }

  // 4. Viento
  if (m.windSpeedMps !== undefined) {
    if (m.windSpeedMps >= IZAJE_WIND_BLOCKING_MPS) {
      issues.push({
        severity: 'blocking',
        code: 'WIND_TOO_HIGH',
        message: `Viento ${m.windSpeedMps.toFixed(1)} m/s ≥ ${IZAJE_WIND_BLOCKING_MPS} m/s. NO izar.`,
        context: { windSpeedMps: m.windSpeedMps },
      });
    } else if (m.windSpeedMps >= IZAJE_WIND_ADVISORY_MPS) {
      issues.push({
        severity: 'advisory',
        code: 'WIND_ELEVATED',
        message: `Viento ${m.windSpeedMps.toFixed(1)} m/s ≥ ${IZAJE_WIND_ADVISORY_MPS} m/s. Pausar carga si excede ${IZAJE_WIND_BLOCKING_MPS}.`,
        context: { windSpeedMps: m.windSpeedMps },
      });
    }
  }

  // 5. Zona de exclusión + rigging inspection
  if (!m.exclusionZoneMarked) {
    issues.push({
      severity: 'blocking',
      code: 'EXCLUSION_ZONE_UNMARKED',
      message:
        'Zona de exclusión bajo la carga debe estar marcada y despejada antes del izaje.',
    });
  }
  if (!m.riggingInspected) {
    issues.push({
      severity: 'blocking',
      code: 'RIGGING_NOT_INSPECTED',
      message: 'Eslingas/grilletes/accesorios sin inspección pre-uso.',
    });
  }

  return summarize('izaje_critico', issues);
}

// ────────────────────────────────────────────────────────────────────────
// EXCAVACIÓN SEGURA (§347-349)
// ────────────────────────────────────────────────────────────────────────

export interface ExcavationMetadata {
  /** Profundidad excavación (m). */
  depthMeters: number;
  /** Ángulo del talud (grados desde horizontal). 90 = pared vertical. */
  slopeAngleDeg: number;
  /** Entibación instalada (cuando aplica). */
  shoringInstalled: boolean;
  /** Tipo de suelo: estable / suelto / saturado. */
  soilKind: 'stable' | 'loose' | 'saturated' | 'unknown';
  /** Servicios enterrados identificados (eléctrico, gas, agua, etc). */
  buriedServicesMapped: boolean;
  /**
   * Última medición atmosférica si depth >1.2 m: O2 % + LEL %.
   * Si depth ≤1.2 m, puede omitirse.
   */
  atmosphereMeasurement?: {
    oxygenPct: number;
    lelPct: number;
    measuredAtIso: string;
  };
  /** Lluvia en últimas 24h (mm). Suelo saturado → revisar talud. */
  rainfallLast24hMm?: number;
}

/** Ángulos máximos sin entibación según suelo (NCh 349). */
const MAX_SLOPE_BY_SOIL: Record<
  ExcavationMetadata['soilKind'],
  number
> = {
  stable: 76, // 4:1 horizontal:vertical → ~76° desde horizontal
  loose: 56, // 1.5:1
  saturated: 45, // 1:1
  unknown: 45, // worst-case
};

export function validateExcavation(
  m: ExcavationMetadata,
): CriticalValidationResult {
  const issues: CriticalIssue[] = [];

  if (m.depthMeters <= 0) {
    issues.push({
      severity: 'blocking',
      code: 'DEPTH_INVALID',
      message: 'Profundidad debe ser > 0.',
    });
    return summarize('excavacion', issues);
  }

  // 1. Talud o entibación
  const maxSafeSlope = MAX_SLOPE_BY_SOIL[m.soilKind];
  if (m.slopeAngleDeg > maxSafeSlope && !m.shoringInstalled) {
    issues.push({
      severity: 'blocking',
      code: 'UNSAFE_SLOPE_NO_SHORING',
      message: `Talud ${m.slopeAngleDeg}° para suelo '${m.soilKind}' supera máximo ${maxSafeSlope}° sin entibación. Instalar entibación o reducir ángulo.`,
      context: { slopeAngleDeg: m.slopeAngleDeg, maxSafeSlope, soilKind: m.soilKind },
    });
  }

  // 2. Profundidad > 1.5 m exige entibación si suelo no es 'stable'
  if (m.depthMeters >= 1.5 && m.soilKind !== 'stable' && !m.shoringInstalled) {
    issues.push({
      severity: 'blocking',
      code: 'DEPTH_REQUIRES_SHORING',
      message: `Profundidad ≥ 1.5 m con suelo '${m.soilKind}' requiere entibación.`,
      context: { depthMeters: m.depthMeters, soilKind: m.soilKind },
    });
  }

  // 3. Servicios enterrados
  if (!m.buriedServicesMapped) {
    issues.push({
      severity: 'blocking',
      code: 'BURIED_SERVICES_NOT_MAPPED',
      message:
        'Servicios enterrados (eléctrico/gas/agua/fibra) NO identificados. Riesgo de impacto.',
    });
  }

  // 4. Atmósfera si profundidad > 1.2 m (riesgo confinado)
  if (m.depthMeters > 1.2) {
    if (!m.atmosphereMeasurement) {
      issues.push({
        severity: 'blocking',
        code: 'ATMOSPHERE_MEASUREMENT_REQUIRED',
        message:
          'Profundidad > 1.2 m requiere medición atmosférica pre-ingreso (O₂ + LEL).',
      });
    } else {
      const { oxygenPct, lelPct } = m.atmosphereMeasurement;
      if (oxygenPct < GAS_OXYGEN_MIN_PCT || oxygenPct > GAS_OXYGEN_MAX_PCT) {
        issues.push({
          severity: 'blocking',
          code: 'OXYGEN_OUT_OF_RANGE',
          message: `O₂ ${oxygenPct}% fuera de rango seguro (${GAS_OXYGEN_MIN_PCT}%–${GAS_OXYGEN_MAX_PCT}%).`,
          context: { oxygenPct },
        });
      }
      if (lelPct >= GAS_LEL_BLOCKING_PCT) {
        issues.push({
          severity: 'blocking',
          code: 'LEL_TOO_HIGH',
          message: `LEL ${lelPct}% ≥ ${GAS_LEL_BLOCKING_PCT}%. Atmósfera potencialmente explosiva.`,
          context: { lelPct },
        });
      } else if (lelPct >= GAS_LEL_ADVISORY_PCT) {
        issues.push({
          severity: 'advisory',
          code: 'LEL_ELEVATED',
          message: `LEL ${lelPct}% entre ${GAS_LEL_ADVISORY_PCT}%–${GAS_LEL_BLOCKING_PCT}%. Re-medir antes de tareas con punto de ignición.`,
          context: { lelPct },
        });
      }
    }
  }

  // 5. Lluvia reciente sobre suelo saturado
  if (
    m.rainfallLast24hMm !== undefined &&
    m.rainfallLast24hMm > 25 &&
    m.soilKind === 'saturated'
  ) {
    issues.push({
      severity: 'advisory',
      code: 'RECENT_RAIN_SATURATED',
      message: `Lluvia ${m.rainfallLast24hMm} mm/24h sobre suelo saturado. Revisar estabilidad del talud antes de operar.`,
      context: { rainfallLast24hMm: m.rainfallLast24hMm },
    });
  }

  return summarize('excavacion', issues);
}

// ────────────────────────────────────────────────────────────────────────
// LOTO — Lockout/Tagout (DS 132 + NFPA 70E art. 120)
// ────────────────────────────────────────────────────────────────────────

export type EnergySource =
  | 'electrical'
  | 'mechanical'
  | 'hydraulic'
  | 'pneumatic'
  | 'thermal'
  | 'chemical'
  | 'gravitational'
  | 'radiation';

export interface LotoLock {
  /** Dueño del candado (uid trabajador). */
  ownerUid: string;
  /** Source aislada por este candado. */
  source: EnergySource;
  /** ID físico del candado para auditoría. */
  lockId: string;
  /** Timestamp de colocación. */
  placedAtIso: string;
}

export interface LotoMetadata {
  /** Fuentes de energía identificadas en la máquina/tarea. */
  identifiedSources: EnergySource[];
  /** Candados colocados. */
  locks: LotoLock[];
  /** Verificación "try-out" realizada (intentar arrancar para confirmar 0 energía). */
  tryoutPerformed: boolean;
  /** UID de quien realizó el try-out (debe ser un worker con lock propio). */
  tryoutByUid?: string;
}

export function validateLoto(m: LotoMetadata): CriticalValidationResult {
  const issues: CriticalIssue[] = [];

  // 1. Cada fuente identificada debe tener al menos un candado
  for (const source of m.identifiedSources) {
    const locksForSource = m.locks.filter((l) => l.source === source);
    if (locksForSource.length === 0) {
      issues.push({
        severity: 'blocking',
        code: 'SOURCE_NOT_LOCKED',
        message: `Fuente '${source}' identificada pero sin candado colocado.`,
        context: { source },
      });
    }
  }

  // 2. Candados duplicados (mismo lockId)
  const lockIds = m.locks.map((l) => l.lockId);
  const dupIds = lockIds.filter((id, i) => lockIds.indexOf(id) !== i);
  for (const dup of new Set(dupIds)) {
    issues.push({
      severity: 'blocking',
      code: 'DUPLICATE_LOCK_ID',
      message: `Lock ID '${dup}' aparece más de una vez. Cada candado debe ser único.`,
      context: { lockId: dup },
    });
  }

  // 3. Cada worker que va a intervenir DEBE tener su propio candado
  // (esto se valida al integrar con la lista de workers asignados; aquí
  // verificamos solo que al menos UN owner aparezca, sino el try-out
  // no puede asociarse). El check completo lo hace el caller con la
  // lista de workers asignados.
  if (m.locks.length === 0 && m.identifiedSources.length > 0) {
    issues.push({
      severity: 'blocking',
      code: 'NO_LOCKS_PLACED',
      message: 'Hay fuentes identificadas pero ningún candado colocado.',
    });
  }

  // 4. Try-out
  if (!m.tryoutPerformed) {
    issues.push({
      severity: 'blocking',
      code: 'TRYOUT_NOT_PERFORMED',
      message:
        'Try-out (verificación de energía cero) no realizado. Procedimiento NFPA 70E art. 120.',
    });
  } else if (!m.tryoutByUid) {
    issues.push({
      severity: 'advisory',
      code: 'TRYOUT_AUTHOR_MISSING',
      message: 'Try-out marcado como realizado pero sin UID del verificador.',
    });
  } else {
    // tryoutByUid debe tener su lock propio
    const hasLock = m.locks.some((l) => l.ownerUid === m.tryoutByUid);
    if (!hasLock) {
      issues.push({
        severity: 'blocking',
        code: 'TRYOUT_AUTHOR_NO_LOCK',
        message: `El verificador del try-out (${m.tryoutByUid}) debe tener su propio candado colocado.`,
        context: { tryoutByUid: m.tryoutByUid },
      });
    }
  }

  return summarize('loto', issues);
}

// ────────────────────────────────────────────────────────────────────────
// Convenience — dispatcher por kind
// ────────────────────────────────────────────────────────────────────────

export type CriticalMetadata =
  | { kind: 'izaje_critico'; data: IzajeMetadata }
  | { kind: 'excavacion'; data: ExcavationMetadata }
  | { kind: 'loto'; data: LotoMetadata };

/**
 * Dispatcher único para que el caller no tenga que hacer switch.
 * Devuelve el `CriticalValidationResult` del validator apropiado.
 */
export function validateCriticalPermit(
  meta: CriticalMetadata,
): CriticalValidationResult {
  switch (meta.kind) {
    case 'izaje_critico':
      return validateIzajeCritico(meta.data);
    case 'excavacion':
      return validateExcavation(meta.data);
    case 'loto':
      return validateLoto(meta.data);
  }
}
