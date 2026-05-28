// Praeventio Guard — §12.7.6: Reportes mensuales SUSESO.
//
// Construye el payload estructurado de reporte mensual a partir de:
//   - Cumplimiento del mes corriente (via cumplimientoCalculator §12.7.5).
//   - Cumplimiento del mes previo (opcional, para delta mes-sobre-mes).
//   - Benchmark sector (opcional, via compareAgainstSector).
//   - Metadata empresa (nombre + RUT).
//
// Función PURA (sin red, sin Firestore, sin filesystem). El payload
// devuelto puede ser:
//   - Serializado a JSON para almacenar como nodo DOCUMENT ZK.
//   - Pasado a un renderer PDF (pendiente: §12.7.6.PDF).
//   - Consumido por el dashboard frontend.
//
// IMPORTANT (regla producto inviolable):
//   Praeventio NO envía el reporte a SUSESO/Mutualidad. La empresa lo
//   descarga + firma + sube al portal SUSESO. Ver memoria producto
//   product_signing_no_blocking_directives_2026-05-06.

import {
  calculateCumplimientoSuseso,
  compareAgainstSector,
  type CumplimientoBenchmark,
  type CumplimientoInput,
  type CumplimientoResult,
} from './cumplimientoCalculator';

/** Datos agregados de un mes (excluye `period` — el builder lo construye). */
export type MonthlyAggregateData = Omit<CumplimientoInput, 'period'>;

export interface MonthlyReportMetadata {
  companyName: string;
  /** RUT formato chileno `XX.XXX.XXX-K` (no validado aquí). */
  rut: string;
  /** Industria sectorial opcional (ej. "Construcción"). */
  industrySector?: string;
}

export interface MonthlyReportBenchmarkInput {
  industrySector: string;
  sectorAvgTasaAccidentabilidad: number;
  sectorAvgTasaSiniestralidad: number;
}

export interface MonthlyReportInput {
  /** Año del reporte (ej. 2026). */
  year: number;
  /** Mes del reporte (1 = enero, 12 = diciembre). */
  month: number;
  /** Datos agregados del mes corriente. */
  currentMonthData: MonthlyAggregateData;
  /** Datos del mes previo (opcional, habilita delta mes-sobre-mes). */
  previousMonthData?: MonthlyAggregateData;
  /** Benchmark sector (opcional, habilita comparación). */
  benchmark?: MonthlyReportBenchmarkInput;
  metadata: MonthlyReportMetadata;
  /**
   * `now` ISO inyectable para tests deterministas. Default
   * `new Date().toISOString()` — usar solo si se requiere stable output.
   */
  generatedAtIso?: string;
}

export interface MonthOverMonthDelta {
  /** % cambio TA respecto mes previo. `undefined` si previo = 0. */
  tasaAccDeltaPct?: number;
  /** % cambio TS respecto mes previo. */
  tasaSinDeltaPct?: number;
  /** % cambio TF respecto mes previo. */
  tfDeltaPct?: number;
  /** % cambio TG respecto mes previo. */
  tgDeltaPct?: number;
}

export interface MonthlyReportPayload {
  /** ID determinístico del reporte (`{rut}-{YYYY-MM}`). */
  reportId: string;
  generatedAtIso: string;
  period: {
    fromIso: string;
    toIso: string;
    /** Etiqueta es-CL ("enero 2026"). */
    monthLabel: string;
    year: number;
    month: number;
  };
  current: CumplimientoResult;
  /** Resultado mes previo si se proveyó. */
  previous?: CumplimientoResult;
  /** Delta % mes-sobre-mes si hay mes previo. */
  monthOverMonth?: MonthOverMonthDelta;
  /** Comparación benchmark sector si se proveyó. */
  benchmark?: CumplimientoBenchmark;
  metadata: MonthlyReportMetadata;
  /** Resumen ejecutivo es-CL (1-2 oraciones). */
  summary: string;
}

const MONTHS_ES_CL = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Etiqueta es-CL ("enero 2026"). Lanza si month ∉ [1,12]. */
export function monthLabelEsCL(year: number, month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`monthLabelEsCL: month inválido (${month}); rango [1,12]`);
  }
  return `${MONTHS_ES_CL[month - 1]} ${year}`;
}

/**
 * Construye el rango ISO 8601 [first ms, last ms del mes] en UTC.
 * Maneja años bisiestos correctamente.
 */
function monthPeriod(year: number, month: number): { fromIso: string; toIso: string } {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`monthPeriod: month inválido (${month}); rango [1,12]`);
  }
  const monthStr = String(month).padStart(2, '0');
  const fromIso = `${year}-${monthStr}-01T00:00:00.000Z`;

  // Truco UTC: día 0 del mes siguiente = último día del mes actual.
  const lastDayDate = new Date(Date.UTC(year, month, 0));
  const lastDay = String(lastDayDate.getUTCDate()).padStart(2, '0');
  const toIso = `${year}-${monthStr}-${lastDay}T23:59:59.999Z`;

  return { fromIso, toIso };
}

function pctDelta(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return Math.round(((current - previous) / previous) * 100 * 100) / 100;
}

function buildSummary(
  current: CumplimientoResult,
  monthLabel: string,
  monthOverMonth: MonthOverMonthDelta | undefined,
): string {
  const tacc = current.tasaAccidentabilidad;
  const tsin = current.tasaSiniestralidad;
  const parts: string[] = [
    `Reporte ${monthLabel}: Tasa Accidentabilidad ${tacc}%, Tasa Siniestralidad ${tsin}%.`,
  ];
  if (monthOverMonth?.tasaAccDeltaPct !== undefined) {
    const arrow = monthOverMonth.tasaAccDeltaPct >= 0 ? 'sube' : 'baja';
    parts.push(
      `TA ${arrow} ${Math.abs(monthOverMonth.tasaAccDeltaPct)}% vs mes previo.`,
    );
  }
  const criticalAlerts = current.alerts.filter((a) => a.severity === 'critical');
  if (criticalAlerts.length > 0) {
    parts.push(`${criticalAlerts.length} alerta(s) crítica(s) — acción inmediata.`);
  }
  return parts.join(' ');
}

/**
 * Construye reporte mensual determinístico. Delega cálculo de tasas al
 * `cumplimientoCalculator` (§12.7.5) y agrega contexto temporal + sector.
 *
 * NO toca red, NO toca Firestore — función pura testeable.
 */
export function buildMonthlyReport(input: MonthlyReportInput): MonthlyReportPayload {
  const period = monthPeriod(input.year, input.month);
  const monthLabel = monthLabelEsCL(input.year, input.month);

  const currentInput: CumplimientoInput = {
    ...input.currentMonthData,
    period,
  };
  const current = calculateCumplimientoSuseso(currentInput);

  let previous: CumplimientoResult | undefined;
  let monthOverMonth: MonthOverMonthDelta | undefined;
  if (input.previousMonthData) {
    const prevPeriod = monthPeriod(
      input.month === 1 ? input.year - 1 : input.year,
      input.month === 1 ? 12 : input.month - 1,
    );
    previous = calculateCumplimientoSuseso({
      ...input.previousMonthData,
      period: prevPeriod,
    });
    monthOverMonth = {
      tasaAccDeltaPct: pctDelta(
        current.tasaAccidentabilidad,
        previous.tasaAccidentabilidad,
      ),
      tasaSinDeltaPct: pctDelta(
        current.tasaSiniestralidad,
        previous.tasaSiniestralidad,
      ),
      tfDeltaPct: pctDelta(current.tasaFrecuencia, previous.tasaFrecuencia),
      tgDeltaPct: pctDelta(current.tasaGravedad, previous.tasaGravedad),
    };
  }

  let benchmark: CumplimientoBenchmark | undefined;
  if (input.benchmark) {
    benchmark = compareAgainstSector(current, {
      industrySector: input.benchmark.industrySector,
      tasaAccidentabilidad: input.benchmark.sectorAvgTasaAccidentabilidad,
      tasaSiniestralidad: input.benchmark.sectorAvgTasaSiniestralidad,
    });
  }

  const monthStr = String(input.month).padStart(2, '0');
  const reportId = `${input.metadata.rut}-${input.year}-${monthStr}`;

  return {
    reportId,
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    period: {
      fromIso: period.fromIso,
      toIso: period.toIso,
      monthLabel,
      year: input.year,
      month: input.month,
    },
    current,
    previous,
    monthOverMonth,
    benchmark,
    metadata: input.metadata,
    summary: buildSummary(current, monthLabel, monthOverMonth),
  };
}
