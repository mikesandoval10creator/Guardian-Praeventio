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

// These are transport/domain sanity ceilings, not legal safety thresholds. They
// stop finite but absurd values from reaching calculations and producing a
// plausible-looking result; the normative thresholds remain the constants and
// rules documented by each validator below.
const NUMERIC_INPUT_SANITY_MAX = 1_000_000_000;

type UnknownRecord = Record<string, unknown>;

interface NumericFieldRule {
  key: string;
  label: string;
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxCode?: string;
  optional?: boolean;
  rangeCode?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidShapeIssue(message: string): CriticalIssue {
  return {
    severity: 'blocking',
    code: 'INVALID_METADATA_SHAPE',
    message,
  };
}

function displayLabel(label: string): string {
  const first = label.charAt(0);
  return first ? first.toLowerCase() + label.slice(1) : label;
}

function numericIssueMessage(
  rule: NumericFieldRule,
  belowMin: boolean,
  aboveMax: boolean,
): string {
  const label = displayLabel(rule.label);
  if (aboveMax) {
    return `Revisa ${label}: el valor es demasiado grande. Comprueba la unidad e inténtalo nuevamente.`;
  }
  if (belowMin && rule.minExclusive) {
    return `Revisa ${label}: debe ser mayor que cero.`;
  }
  if (belowMin) {
    return `Revisa ${label}: no puede ser negativo.`;
  }
  return `Revisa ${label}: ingresa un número válido para continuar.`;
}

function numericMetadataIssues(
  value: unknown,
  rules: readonly NumericFieldRule[],
): CriticalIssue[] {
  if (!isRecord(value)) {
    return [invalidShapeIssue('Revisa los datos del permiso: deben estar completos para continuar.')];
  }

  const issues: CriticalIssue[] = [];
  for (const rule of rules) {
    const raw = value[rule.key];
    if (raw === undefined && rule.optional) continue;
    if (raw === undefined) {
      issues.push(
        invalidShapeIssue(`Completa ${displayLabel(rule.label)} antes de continuar.`),
      );
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      issues.push({
        severity: 'blocking',
        code: 'INVALID_NUMERIC_METADATA',
        message: `Revisa ${displayLabel(rule.label)}: ingresa un número válido para continuar.`,
        context: { field: rule.key },
      });
      continue;
    }

    const belowMin =
      rule.min !== undefined &&
      (rule.minExclusive ? raw <= rule.min : raw < rule.min);
    const aboveMax = rule.max !== undefined && raw > rule.max;
    if (belowMin || aboveMax) {
      issues.push({
        severity: 'blocking',
        code: aboveMax
          ? rule.maxCode ?? 'NUMERIC_METADATA_OUT_OF_RANGE'
          : rule.rangeCode ?? 'NUMERIC_METADATA_OUT_OF_RANGE',
        message: numericIssueMessage(rule, belowMin, aboveMax),
        context: { field: rule.key },
      });
    }
  }
  return issues;
}

function excavationAtmosphereIssues(value: unknown): CriticalIssue[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [invalidShapeIssue('Revisa la medición atmosférica: completa los valores antes de continuar.')];
  }
  const issues = numericMetadataIssues(value, [
    {
      key: 'oxygenPct',
      label: 'Oxígeno',
      min: 0,
      max: 100,
    },
    {
      key: 'lelPct',
      label: 'LEL',
      min: 0,
      max: 100,
    },
  ]);
  if (typeof value.measuredAtIso !== 'string' || Number.isNaN(Date.parse(value.measuredAtIso))) {
    issues.push(invalidShapeIssue('Revisa la fecha de la medición atmosférica antes de continuar.'));
  }
  return issues;
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
  const preflightIssues = numericMetadataIssues(m, [
    {
      key: 'loadWeightKg',
      label: 'Carga',
      min: 0,
      minExclusive: true,
      max: NUMERIC_INPUT_SANITY_MAX,
      rangeCode: 'LOAD_INVALID',
    },
    {
      key: 'operatingRadiusMeters',
      label: 'Radio de operación',
      min: 0,
      minExclusive: true,
      max: NUMERIC_INPUT_SANITY_MAX,
      rangeCode: 'RADIUS_INVALID',
    },
    {
      key: 'craneCapacityAtRadiusKg',
      label: 'Capacidad de la grúa',
      min: 0,
      minExclusive: true,
      max: NUMERIC_INPUT_SANITY_MAX,
      rangeCode: 'CRANE_CAPACITY_INVALID',
    },
    {
      key: 'windSpeedMps',
      label: 'Velocidad del viento',
      min: 0,
      max: NUMERIC_INPUT_SANITY_MAX,
      optional: true,
      rangeCode: 'WIND_SPEED_INVALID',
    },
  ]);
  if (preflightIssues.length > 0) return summarize('izaje_critico', preflightIssues);

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
    if (!Number.isFinite(ratio)) {
      return summarize('izaje_critico', [
        {
          severity: 'blocking',
          code: 'NUMERIC_METADATA_OUT_OF_RANGE',
          message: 'La relación carga/capacidad no es finita.',
        },
      ]);
    }
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
  const preflightIssues = numericMetadataIssues(m, [
    {
      key: 'depthMeters',
      label: 'Profundidad',
      max: NUMERIC_INPUT_SANITY_MAX,
    },
    {
      key: 'slopeAngleDeg',
      label: 'Ángulo del talud',
      min: 0,
      max: 90,
      rangeCode: 'SLOPE_INVALID',
      maxCode: 'SLOPE_INVALID',
    },
    {
      key: 'rainfallLast24hMm',
      label: 'Lluvia de las últimas 24 horas',
      min: 0,
      max: NUMERIC_INPUT_SANITY_MAX,
      optional: true,
      rangeCode: 'RAINFALL_INVALID',
    },
  ]);
  if (isRecord(m)) {
    if (typeof m.soilKind !== 'string' || !(m.soilKind in MAX_SLOPE_BY_SOIL)) {
      preflightIssues.push(invalidShapeIssue('Revisa el tipo de suelo seleccionado antes de continuar.'));
    }
    if (typeof m.shoringInstalled !== 'boolean') {
      preflightIssues.push(invalidShapeIssue('Revisa si la entibación está instalada y marca la opción correspondiente.'));
    }
    if (typeof m.buriedServicesMapped !== 'boolean') {
      preflightIssues.push(invalidShapeIssue('Revisa el mapa de servicios enterrados antes de continuar.'));
    }
    preflightIssues.push(
      ...excavationAtmosphereIssues(m.atmosphereMeasurement),
    );
  }
  if (preflightIssues.length > 0) return summarize('excavacion', preflightIssues);

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

const ENERGY_SOURCES: readonly EnergySource[] = [
  'electrical',
  'mechanical',
  'hydraulic',
  'pneumatic',
  'thermal',
  'chemical',
  'gravitational',
  'radiation',
];

export interface LotoLock {
  /** Dueño del candado (uid trabajador). */
  ownerUid: string;
  /** Source aislada por este candado. */
  source: EnergySource;
  /** ID físico del candado para auditoría. */
  lockId: string;
  /** Timestamp de colocación, cuando el cliente lo conoce. */
  placedAtIso?: string;
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

function canonicalizeLotoMetadata(value: unknown): LotoMetadata {
  if (
    !isRecord(value) ||
    !Array.isArray(value.identifiedSources) ||
    !Array.isArray(value.locks)
  ) {
    throw new Error('Invalid LOTO metadata');
  }

  const sources = value.identifiedSources;
  const locks = value.locks;
  const canonicalShape =
    typeof value.tryoutPerformed === 'boolean' &&
    sources.every((source) => typeof source === 'string') &&
    locks.every(
      (lock) =>
        isRecord(lock) &&
        typeof lock.ownerUid === 'string' &&
        typeof lock.source === 'string' &&
        typeof lock.lockId === 'string',
    );
  const legacyShape =
    typeof value.tryoutCompleted === 'boolean' &&
    sources.every(
      (source) => isRecord(source) && typeof source.type === 'string',
    ) &&
    locks.every(
      (lock) =>
        isRecord(lock) &&
        typeof lock.workerUid === 'string' &&
        typeof lock.type === 'string' &&
        typeof lock.lockId === 'string',
    );

  let metadata: LotoMetadata;
  if (canonicalShape) {
    metadata = value as unknown as LotoMetadata;
  } else if (legacyShape) {
    metadata = {
      identifiedSources: sources.map(
        (source) => (source as UnknownRecord).type as EnergySource,
      ),
      locks: locks.map((lock) => {
        const legacy = lock as UnknownRecord;
        const source =
          typeof legacy.source === 'string'
            ? legacy.source
            : sources.length === 1
              ? (sources[0] as UnknownRecord).type
              : '';
        return {
          ownerUid: legacy.workerUid as string,
          source: source as EnergySource,
          lockId: legacy.lockId as string,
          ...(typeof legacy.placedAtIso === 'string'
            ? { placedAtIso: legacy.placedAtIso }
            : {}),
        };
      }),
      tryoutPerformed: value.tryoutCompleted as boolean,
      ...(typeof value.tryoutByUid === 'string'
        ? { tryoutByUid: value.tryoutByUid }
        : {}),
    };
  } else {
    throw new Error('Invalid LOTO metadata');
  }

  if (
    !metadata.identifiedSources.every((source) =>
      ENERGY_SOURCES.includes(source),
    )
  ) {
    throw new Error('Invalid LOTO metadata');
  }
  if (
    !metadata.locks.every((lock) => {
      if (!isRecord(lock)) return false;
      return (
        typeof lock.ownerUid === 'string' &&
        lock.ownerUid.length > 0 &&
        typeof lock.source === 'string' &&
        ENERGY_SOURCES.includes(lock.source as EnergySource) &&
        typeof lock.lockId === 'string' &&
        lock.lockId.length > 0 &&
        (lock.placedAtIso === undefined ||
          (typeof lock.placedAtIso === 'string' &&
            !Number.isNaN(Date.parse(lock.placedAtIso))))
      );
    })
  ) {
    throw new Error('Invalid LOTO metadata');
  }
  if (
    metadata.tryoutByUid !== undefined &&
    (typeof metadata.tryoutByUid !== 'string' ||
      metadata.tryoutByUid.length === 0)
  ) {
    throw new Error('Invalid LOTO metadata');
  }
  return metadata;
}

export function validateLoto(m: LotoMetadata): CriticalValidationResult {
  const metadata = canonicalizeLotoMetadata(m);
  const issues: CriticalIssue[] = [];

  // 1. Cada fuente identificada debe tener al menos un candado
  for (const source of metadata.identifiedSources) {
    const locksForSource = metadata.locks.filter((l) => l.source === source);
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
  const lockIds = metadata.locks.map((l) => l.lockId);
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
  if (metadata.locks.length === 0 && metadata.identifiedSources.length > 0) {
    issues.push({
      severity: 'blocking',
      code: 'NO_LOCKS_PLACED',
      message: 'Hay fuentes identificadas pero ningún candado colocado.',
    });
  }

  // 4. Try-out
  if (!metadata.tryoutPerformed) {
    issues.push({
      severity: 'blocking',
      code: 'TRYOUT_NOT_PERFORMED',
      message:
        'Try-out (verificación de energía cero) no realizado. Procedimiento NFPA 70E art. 120.',
    });
  } else if (!metadata.tryoutByUid) {
    issues.push({
      severity: 'advisory',
      code: 'TRYOUT_AUTHOR_MISSING',
      message: 'Try-out marcado como realizado pero sin UID del verificador.',
    });
  } else {
    // tryoutByUid debe tener su lock propio
    const hasLock = metadata.locks.some(
      (l) => l.ownerUid === metadata.tryoutByUid,
    );
    if (!hasLock) {
      issues.push({
        severity: 'blocking',
        code: 'TRYOUT_AUTHOR_NO_LOCK',
        message: `El verificador del try-out (${metadata.tryoutByUid}) debe tener su propio candado colocado.`,
        context: { tryoutByUid: metadata.tryoutByUid },
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
