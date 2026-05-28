// Praeventio Guard — §12.7.5: Dashboard Cumplimiento SUSESO (cálculo interno).
//
// Reemplaza la propuesta original de "scraping SUSESO" (descartada por
// directiva founder: no push, no scraping). En su lugar, calcula
// internamente las Tasas de Accidentabilidad y Siniestralidad usando
// los datos que la propia empresa cliente carga en Praeventio (DIAT
// firmadas + workers + horas-hombre trabajadas).
//
// Fórmulas oficiales SUSESO/Ley 16.744 (Circular 2.345/2007 + 3.355):
//
//   Tasa Accidentabilidad =
//     (Nº accidentes con tiempo perdido / Nº promedio trabajadores) × 100
//
//   Tasa Siniestralidad =
//     (Días perdidos / Nº promedio trabajadores) × 100
//
//   Tasa Frecuencia (TF, OIT/OSHA equivalente) =
//     (Nº accidentes × 1.000.000) / horas-hombre trabajadas
//
//   Tasa Gravedad (TG) =
//     (Días perdidos × 1.000.000) / horas-hombre trabajadas
//
// Output: payload que el frontend renderiza como dashboard SUSESO-style.
// La empresa puede exportarlo a PDF para presentar al CPHS / Mutualidad.
//
// IMPORTANT (regla producto): los valores son REFERENCIALES desde nuestros
// datos. La empresa SIGUE obligada a reportar a SUSESO/Mutualidad oficialmente.

export interface CumplimientoPeriod {
  /** Fecha inicio del período (ISO 8601). */
  fromIso: string;
  /** Fecha fin del período (ISO 8601, inclusive). */
  toIso: string;
}

export interface CumplimientoInput {
  period: CumplimientoPeriod;
  /** Nº promedio de trabajadores en el período. */
  averageWorkers: number;
  /**
   * Accidentes con tiempo perdido en el período (Ley 16.744 art. 5+7).
   * Solo cuentan los que generaron incapacidad ≥1 día.
   */
  accidentsWithTimeLoss: number;
  /** Días perdidos totales por accidentes en el período. */
  daysLost: number;
  /** Horas-hombre trabajadas totales en el período. */
  manHoursWorked: number;
  /**
   * Accidentes fatales en el período. Reportar separado per
   * directriz Mutual + SUSESO (se cuentan en TF como 6.000 días).
   */
  fatalAccidents?: number;
  /**
   * Enfermedades profesionales declaradas (DIEP firmadas).
   * No suman en Tasa Acc pero sí TF si se acumulan al desglose.
   */
  occupationalDiseases?: number;
}

export interface CumplimientoResult {
  period: CumplimientoPeriod;
  /** Tasa Accidentabilidad (Ley 16.744, %). */
  tasaAccidentabilidad: number;
  /** Tasa Siniestralidad (días perdidos / trabajadores, %). */
  tasaSiniestralidad: number;
  /** Tasa de Frecuencia (TF, accidentes por millón h-h, OIT). */
  tasaFrecuencia: number;
  /** Tasa de Gravedad (TG, días perdidos por millón h-h, OIT). */
  tasaGravedad: number;
  /** Índice Compuesto (IF × IG)^0.5 — Walsh score. */
  indiceCompuestoWalsh: number;
  /** Compara contra promedio sector (si se proveyó context). */
  benchmarkComparison?: CumplimientoBenchmark;
  /** Bandera regulatoria si Tasa Acc > umbral. */
  alerts: CumplimientoAlert[];
  /** Inputs originales para auditabilidad. */
  inputs: CumplimientoInput;
}

export interface CumplimientoBenchmark {
  industrySector: string;
  sectorAvgTasaAccidentabilidad: number;
  sectorAvgTasaSiniestralidad: number;
  /** % diferencia del tenant vs sector (positivo = peor que promedio). */
  delta: {
    tasaAccidentabilidad: number;
    tasaSiniestralidad: number;
  };
}

export type CumplimientoAlertSeverity = 'info' | 'warning' | 'critical';

export interface CumplimientoAlert {
  severity: CumplimientoAlertSeverity;
  code: string;
  message: string;
  recommendedAction?: string;
}

const FATAL_DAYS_PENALTY = 6_000; // Convención OIT/INE para fatales en TG
const MILLION = 1_000_000;

/**
 * Validación defensiva — inputs deben ser números finitos y no-negativos.
 */
function validateInput(input: CumplimientoInput): void {
  const checks: Array<[string, number]> = [
    ['averageWorkers', input.averageWorkers],
    ['accidentsWithTimeLoss', input.accidentsWithTimeLoss],
    ['daysLost', input.daysLost],
    ['manHoursWorked', input.manHoursWorked],
  ];
  for (const [name, value] of checks) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `cumplimientoCalculator: ${name} debe ser número finito ≥ 0 (recibido: ${value})`,
      );
    }
  }
  if (input.averageWorkers === 0) {
    throw new Error(
      'cumplimientoCalculator: averageWorkers no puede ser 0 (división por cero)',
    );
  }
  if (input.manHoursWorked === 0) {
    throw new Error(
      'cumplimientoCalculator: manHoursWorked no puede ser 0 (división por cero en TF/TG)',
    );
  }
}

/**
 * Calcula Tasa Accidentabilidad + Siniestralidad + TF + TG según las
 * fórmulas oficiales SUSESO + Ley 16.744 + OIT.
 *
 * NO toca red ni Firestore — función pura, totalmente testeable.
 */
export function calculateCumplimientoSuseso(input: CumplimientoInput): CumplimientoResult {
  validateInput(input);

  const tasaAccidentabilidad =
    (input.accidentsWithTimeLoss / input.averageWorkers) * 100;
  const tasaSiniestralidad = (input.daysLost / input.averageWorkers) * 100;
  const tasaFrecuencia =
    ((input.accidentsWithTimeLoss + (input.fatalAccidents ?? 0)) * MILLION) /
    input.manHoursWorked;
  const fatalPenalty = (input.fatalAccidents ?? 0) * FATAL_DAYS_PENALTY;
  const tasaGravedad =
    ((input.daysLost + fatalPenalty) * MILLION) / input.manHoursWorked;

  // Índice Compuesto Walsh = √(TF × TG)
  const indiceCompuestoWalsh = Math.sqrt(tasaFrecuencia * tasaGravedad);

  const alerts: CumplimientoAlert[] = [];

  // Alertas regulatorias contra umbrales típicos sector chileno.
  // Mutualidad evalúa cotización adicional Decreto 67 si TA > umbral.
  if (tasaAccidentabilidad > 6) {
    alerts.push({
      severity: 'critical',
      code: 'tasa_acc_high_risk',
      message: `Tasa Accidentabilidad ${tasaAccidentabilidad.toFixed(2)}% supera 6% — alta probabilidad recargo cotización SUSESO (DS 67).`,
      recommendedAction:
        'Revisar plan de prevención + intervención inmediata Mutualidad.',
    });
  } else if (tasaAccidentabilidad > 4) {
    alerts.push({
      severity: 'warning',
      code: 'tasa_acc_elevated',
      message: `Tasa Accidentabilidad ${tasaAccidentabilidad.toFixed(2)}% sobre 4% — monitoreo cercano sugerido.`,
      recommendedAction:
        'Reforzar programa prevención según resultados IPER y observaciones de comportamiento.',
    });
  }

  if (tasaSiniestralidad > 80) {
    alerts.push({
      severity: 'critical',
      code: 'tasa_sin_high',
      message: `Tasa Siniestralidad ${tasaSiniestralidad.toFixed(2)}% — gravedad alta de accidentes.`,
      recommendedAction:
        'Revisar protocolos atención post-accidente + reintegro laboral.',
    });
  }

  if ((input.fatalAccidents ?? 0) > 0) {
    alerts.push({
      severity: 'critical',
      code: 'fatal_accident_period',
      message: `${input.fatalAccidents} accidente(s) fatal(es) en el período — declarar a SUSESO ≤24h + investigación obligatoria DS 30.`,
      recommendedAction:
        'Generar DIAT urgente, investigación causa raíz + plan corrective DS 30/DS 132.',
    });
  }

  return {
    period: input.period,
    tasaAccidentabilidad: round2(tasaAccidentabilidad),
    tasaSiniestralidad: round2(tasaSiniestralidad),
    tasaFrecuencia: round2(tasaFrecuencia),
    tasaGravedad: round2(tasaGravedad),
    indiceCompuestoWalsh: round2(indiceCompuestoWalsh),
    alerts,
    inputs: input,
  };
}

/**
 * Compara resultado vs benchmark sector. Helper opcional para enriquecer
 * el dashboard si el tenant proveyó context industria.
 */
export function compareAgainstSector(
  result: CumplimientoResult,
  sectorAvg: {
    tasaAccidentabilidad: number;
    tasaSiniestralidad: number;
    industrySector: string;
  },
): CumplimientoBenchmark {
  return {
    industrySector: sectorAvg.industrySector,
    sectorAvgTasaAccidentabilidad: sectorAvg.tasaAccidentabilidad,
    sectorAvgTasaSiniestralidad: sectorAvg.tasaSiniestralidad,
    delta: {
      tasaAccidentabilidad: round2(
        result.tasaAccidentabilidad - sectorAvg.tasaAccidentabilidad,
      ),
      tasaSiniestralidad: round2(
        result.tasaSiniestralidad - sectorAvg.tasaSiniestralidad,
      ),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
