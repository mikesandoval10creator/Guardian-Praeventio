// Praeventio Guard — Épica B1 (capa 2 de aristas): simulador de cotización
// adicional diferenciada DS 67 desde la siniestralidad real del proyecto.
//
// Pure calc engine (hard convention #9): no side effects, no Firestore, no
// clocks other than the caller-provided reference date, deterministic.
//
// LEGAL SOURCE: DS 67/1999 MINTRAB — "Reglamento para aplicación de los
// artículos 15 y 16 de la Ley 16.744, sobre exenciones, rebajas y recargos
// de la cotización adicional diferenciada". BCN idNorma=159800
// (https://www.bcn.cl/leychile/navegar?idNorma=159800). The corpus entry
// `cl-ds-67` in `src/data/normativa/cl.ts` carries only metadata (title,
// reference, scope, URL) — every numeric threshold below was transcribed
// from the BCN norm text on 2026-06-11 and is pinned, boundary by boundary,
// in `ds67Simulator.test.ts`. Do NOT alter any value without re-reading the
// norm.
//
// Model implemented (citations per article):
//   art. 2 b) Período Anual: 12 months, 1° de julio → 30 de junio.
//   art. 2 a) Período de Evaluación: the 3 períodos anuales immediately
//             before the 1° de julio of the evaluation year (2 if the
//             employer has been affiliated between 2 and 3 years).
//   art. 2 f) Promedio Anual de Trabajadores: monthly headcount sum / 12,
//             expressed with 2 decimals, half-up on the third decimal.
//   art. 2 g) Día Perdido: day under subsidio for accidente del trabajo or
//             enfermedad profesional.
//   art. 2 h) Tasa de Siniestralidad por Incapacidades Temporales =
//             (días perdidos del período anual / promedio anual de
//             trabajadores) × 100, 2 decimals half-up.
//   art. 2 i) Tasa PROMEDIO de Siniestralidad por Incapacidades Temporales:
//             average of the h) tasas over the evaluation period, expressed
//             WITHOUT decimals, half-up on the first decimal.
//   art. 2 j) Tasa de Siniestralidad por Invalideces y Muertes: each
//             invalidez/muerte gets a value (table below); per período
//             anual, factor = (sum of values × 100) / promedio anual de
//             trabajadores, 2 decimals half-up; the average factor (2
//             decimals) maps through a lookup table to the tasa (0..385).
//   art. 2 k) Tasa de Siniestralidad Total = i) + j).
//   art. 5    Tasa de Siniestralidad Total → cotización adicional
//             diferenciada (0,00% .. 6,80%, steps of 0,34).
//   art. 6    Evaluation runs every two years, during the second semester.
//   art. 13   The resulting exención/rebaja/recargo rules from the 1° de
//             enero following the evaluation process (for two years).
//
// The projected annual cost in CLP = planilla anual imponible × cotización
// adicional %. The base cotización (Ley 16.744 art. 15 a)) and the DS 110
// presumed rate are OUT of scope: this engine simulates only the
// differentiated additional cotización governed by DS 67.

export class Ds67ValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'Ds67ValidationError';
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Rounding — DS 67 art. 2 letters f), h), i), j) repeat the same rule:
// keep N digits, raise the last kept digit if the next is ≥ 5, discard
// otherwise ("elevando ... al valor superior si el ... decimal es igual o
// superior a cinco y despreciando ... si fuere inferior a cinco").
// ─────────────────────────────────────────────────────────────────────────

/**
 * Half-up rounding to `decimals` places, robust to IEEE-754 noise
 * (e.g. `1.005 * 100 === 100.49999…`). `toPrecision(12)` collapses that
 * noise deterministically before `Math.round`.
 */
export function roundHalfUp(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new Ds67ValidationError('not_finite', `Cannot round non-finite value: ${value}`);
  }
  const factor = 10 ** decimals;
  const scaled = Number((value * factor).toPrecision(12));
  return Math.round(scaled) / factor;
}

// ─────────────────────────────────────────────────────────────────────────
// LEGAL SOURCE: DS 67/1999 art. 2 letra j) (BCN idNorma=159800) — value
// assigned to each invalidez declared (first time) in the evaluation
// period, and to each death.
// ─────────────────────────────────────────────────────────────────────────

export type Ds67InvalidityBand =
  | 'invalidez_15_25' // invalidez 15,0% a 25,0%
  | 'invalidez_27_5_37_5' // invalidez 27,5% a 37,5%
  | 'invalidez_40_65' // invalidez 40,0% a 65,0%
  | 'invalidez_70_plus' // invalidez 70,0% o más
  | 'gran_invalidez' // gran invalidez
  | 'muerte'; // muerte

export const DS67_INVALIDITY_VALUES: Readonly<Record<Ds67InvalidityBand, number>> = Object.freeze({
  invalidez_15_25: 0.25,
  invalidez_27_5_37_5: 0.5,
  invalidez_40_65: 1.0,
  invalidez_70_plus: 1.5,
  gran_invalidez: 2.0,
  muerte: 2.5,
});

// ─────────────────────────────────────────────────────────────────────────
// LEGAL SOURCE: DS 67/1999 art. 2 letra j) (BCN idNorma=159800) — mapping
// from the average invalidity/death factor (2 decimals) to the Tasa de
// Siniestralidad por Invalideces y Muertes. Ranges are contiguous at the
// centésima because the promedio is expressed with two decimals.
// Each row: inclusive upper bound of the range → tasa.
// ─────────────────────────────────────────────────────────────────────────

const DS67_IM_RATE_TABLE: ReadonlyArray<readonly [upperInclusive: number, rate: number]> = [
  [0.1, 0], // 0,00 a 0,10
  [0.3, 35], // 0,11 a 0,30
  [0.5, 70], // 0,31 a 0,50
  [0.7, 105], // 0,51 a 0,70
  [0.9, 140], // 0,71 a 0,90
  [1.2, 175], // 0,91 a 1,20
  [1.5, 210], // 1,21 a 1,50
  [1.8, 245], // 1,51 a 1,80
  [2.1, 280], // 1,81 a 2,10
  [2.4, 315], // 2,11 a 2,40
  [2.7, 350], // 2,41 a 2,70
  [Number.POSITIVE_INFINITY, 385], // 2,71 y más
];

/** Tabla art. 2 j): promedio de factores (2 decimales) → tasa IM. */
export function lookupInvalidityDeathRate(averageFactor: number): number {
  if (!Number.isFinite(averageFactor) || averageFactor < 0) {
    throw new Ds67ValidationError(
      'invalid_im_factor',
      `Average invalidity/death factor must be a non-negative finite number, got ${averageFactor}`,
    );
  }
  const quantized = roundHalfUp(averageFactor, 2);
  for (const [upper, rate] of DS67_IM_RATE_TABLE) {
    if (quantized <= upper) return rate;
  }
  /* istanbul ignore next -- last row is +Infinity, unreachable */
  return 385;
}

// ─────────────────────────────────────────────────────────────────────────
// LEGAL SOURCE: DS 67/1999 art. 5 (BCN idNorma=159800) — Tasa de
// Siniestralidad Total → cotización adicional diferenciada. 21 rows,
// 0,00% up to the 6,80% ceiling ("981 y más"). The Tasa Total is an
// integer (art. 2 i) has no decimals; art. 2 j) tasas are multiples of
// 35), so integer range bounds are exact.
// Each row: inclusive upper bound of the range → cotización adicional %.
// ─────────────────────────────────────────────────────────────────────────

const DS67_ADDITIONAL_COTIZACION_TABLE: ReadonlyArray<
  readonly [upperInclusive: number, pct: number]
> = [
  [32, 0.0], // 0 a 32
  [64, 0.34], // 33 a 64
  [96, 0.68], // 65 a 96
  [128, 1.02], // 97 a 128
  [160, 1.36], // 129 a 160
  [192, 1.7], // 161 a 192
  [224, 2.04], // 193 a 224
  [272, 2.38], // 225 a 272
  [320, 2.72], // 273 a 320
  [368, 3.06], // 321 a 368
  [416, 3.4], // 369 a 416
  [464, 3.74], // 417 a 464
  [512, 4.08], // 465 a 512
  [560, 4.42], // 513 a 560
  [630, 4.76], // 561 a 630
  [700, 5.1], // 631 a 700
  [770, 5.44], // 701 a 770
  [840, 5.78], // 771 a 840
  [910, 6.12], // 841 a 910
  [980, 6.46], // 911 a 980
  [Number.POSITIVE_INFINITY, 6.8], // 981 y más
];

/** Tabla art. 5: Tasa de Siniestralidad Total → cotización adicional %. */
export function lookupAdditionalCotizacion(totalRate: number): number {
  if (!Number.isFinite(totalRate) || totalRate < 0) {
    throw new Ds67ValidationError(
      'invalid_total_rate',
      `Tasa de Siniestralidad Total must be a non-negative finite number, got ${totalRate}`,
    );
  }
  for (const [upper, pct] of DS67_ADDITIONAL_COTIZACION_TABLE) {
    if (totalRate <= upper) return pct;
  }
  /* istanbul ignore next -- last row is +Infinity, unreachable */
  return 6.8;
}

// ─────────────────────────────────────────────────────────────────────────
// Período anual windows (arts. 2 a) y 2 b)) — shared by the server route
// (incident aggregation) and the UI (labels). Pure: the reference date is
// an argument.
// ─────────────────────────────────────────────────────────────────────────

export interface Ds67AnnualPeriodWindow {
  /** Inclusive start (1° de julio, UTC midnight). */
  startIso: string;
  /** Exclusive end (the next 1° de julio, UTC midnight). */
  endIso: string;
  /** es-CL label, DD-MM-YYYY (rule #2): `01-07-2024 al 30-06-2025`. */
  label: string;
}

/**
 * The `count` períodos anuales (1 julio → 30 junio, art. 2 b)) immediately
 * preceding the most recent 1° de julio at or before `reference`
 * (art. 2 a)). Ordered oldest → newest. `count` is 3, or 2 for employers
 * affiliated between 2 and 3 years (art. 2 a) inciso segundo).
 */
export function evaluationPeriodWindows(
  reference: Date,
  count: 2 | 3 = 3,
): Ds67AnnualPeriodWindow[] {
  const refMs = reference.getTime();
  if (!Number.isFinite(refMs)) {
    throw new Ds67ValidationError('invalid_reference_date', 'Reference date is invalid');
  }
  const year = reference.getUTCFullYear();
  const julyFirstOfYear = Date.UTC(year, 6, 1);
  const cutYear = refMs >= julyFirstOfYear ? year : year - 1;
  const windows: Ds67AnnualPeriodWindow[] = [];
  for (let i = count; i >= 1; i--) {
    const startYear = cutYear - i;
    const start = new Date(Date.UTC(startYear, 6, 1));
    const end = new Date(Date.UTC(startYear + 1, 6, 1));
    windows.push({
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      label: `01-07-${startYear} al 30-06-${startYear + 1}`,
    });
  }
  return windows;
}

// ─────────────────────────────────────────────────────────────────────────
// CLP formatting — rule #2: `$1.234.567`, sign before the `$`.
// ─────────────────────────────────────────────────────────────────────────

export function formatClp(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new Ds67ValidationError('invalid_clp_amount', `CLP amount must be finite, got ${amount}`);
  }
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${grouped}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Simulation
// ─────────────────────────────────────────────────────────────────────────

export interface Ds67AnnualPeriodInput {
  /** Display label (e.g. from `evaluationPeriodWindows`). Optional. */
  label?: string;
  /** Promedio Anual de Trabajadores (art. 2 f)). Must be > 0. */
  averageWorkers: number;
  /** Días Perdidos of the período anual (art. 2 g)). Integer ≥ 0. */
  lostDays: number;
  /**
   * Invalideces declared for the first time in the period, and deaths
   * (art. 3). Counts per legal band — integer ≥ 0 each. The incident
   * schema does not carry invalidity gradings (those come from the
   * organismo administrador's resolution), so these are always
   * user-provided inputs, never inferred.
   */
  invalidityEvents?: Partial<Record<Ds67InvalidityBand, number>>;
}

export interface Ds67SimulationInput {
  /** 2 or 3 períodos anuales, oldest → newest (art. 2 a)). */
  periods: Ds67AnnualPeriodInput[];
  /** Current cotización adicional % the employer pays today (optional). */
  currentAdditionalCotizacionPct?: number;
  /** Planilla anual imponible in CLP (optional — enables $ projections). */
  annualPayrollClp?: number;
}

export interface Ds67PeriodBreakdown {
  label: string;
  /** Tasa de Siniestralidad por Incapacidades Temporales (art. 2 h)). */
  temporaryRate: number;
  /** Factor de Invalideces y Muertes of the period (art. 2 j)). */
  imFactor: number;
}

export interface Ds67SimulationResult {
  periods: Ds67PeriodBreakdown[];
  /** Tasa Promedio de Siniestralidad por Incapacidades Temporales (art. 2 i)) — integer. */
  averageTemporaryRate: number;
  /** Promedio de factores de invalideces y muertes (art. 2 j)) — 2 decimals. */
  imFactorAverage: number;
  /** Tasa de Siniestralidad por Invalideces y Muertes (tabla art. 2 j)). */
  invalidityDeathRate: number;
  /** Tasa de Siniestralidad Total (art. 2 k)). */
  totalRate: number;
  /** Cotización adicional resultante según tabla art. 5 (%). */
  additionalCotizacionPct: number;
  /** Resulting − current, percentage points (null without current). */
  deltaPct: number | null;
  /** Projected annual cost of the resulting cotización, CLP (null without payroll). */
  annualCostClp: number | null;
  /** Annual cost at the CURRENT cotización, CLP (null without both inputs). */
  currentAnnualCostClp: number | null;
  /** annualCostClp − currentAnnualCostClp (null without both inputs). */
  annualCostDeltaClp: number | null;
  /** Human-readable legal citation for the UI/PDF. */
  legalCitation: string;
}

export const DS67_LEGAL_CITATION =
  'DS 67/1999 MINTRAB, arts. 2°, 3°, 5° y 13 — Ley 16.744, arts. 15 y 16 (BCN idNorma 159800)';

const INVALIDITY_BANDS = Object.keys(DS67_INVALIDITY_VALUES) as Ds67InvalidityBand[];

function assertNonNegativeInteger(value: number, code: string, what: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Ds67ValidationError(code, `${what} must be a non-negative integer, got ${value}`);
  }
}

function validatePeriod(period: Ds67AnnualPeriodInput, index: number): void {
  if (
    !Number.isFinite(period.averageWorkers) ||
    period.averageWorkers <= 0 ||
    period.averageWorkers > 10_000_000
  ) {
    throw new Ds67ValidationError(
      'invalid_average_workers',
      `Period ${index}: averageWorkers must be > 0 and finite, got ${period.averageWorkers}`,
    );
  }
  assertNonNegativeInteger(period.lostDays, 'invalid_lost_days', `Period ${index}: lostDays`);
  if (period.invalidityEvents) {
    for (const band of Object.keys(period.invalidityEvents)) {
      if (!INVALIDITY_BANDS.includes(band as Ds67InvalidityBand)) {
        throw new Ds67ValidationError(
          'invalid_invalidity_band',
          `Period ${index}: unknown invalidity band '${band}'`,
        );
      }
      const count = period.invalidityEvents[band as Ds67InvalidityBand] ?? 0;
      assertNonNegativeInteger(
        count,
        'invalid_invalidity_count',
        `Period ${index}: invalidityEvents.${band}`,
      );
    }
  }
}

/**
 * Simulate the DS 67 evaluation over the given períodos anuales.
 * Pure + deterministic — see module header for the article-by-article map.
 */
export function simulateDs67(input: Ds67SimulationInput): Ds67SimulationResult {
  const { periods } = input;
  if (!Array.isArray(periods) || (periods.length !== 2 && periods.length !== 3)) {
    throw new Ds67ValidationError(
      'invalid_period_count',
      `Evaluation requires 2 or 3 períodos anuales (art. 2 a)), got ${periods?.length ?? 0}`,
    );
  }
  periods.forEach(validatePeriod);

  if (input.currentAdditionalCotizacionPct !== undefined) {
    const pct = input.currentAdditionalCotizacionPct;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Ds67ValidationError(
        'invalid_current_pct',
        `currentAdditionalCotizacionPct must be within [0, 100], got ${pct}`,
      );
    }
  }
  if (input.annualPayrollClp !== undefined) {
    const payroll = input.annualPayrollClp;
    if (!Number.isFinite(payroll) || payroll < 0) {
      throw new Ds67ValidationError(
        'invalid_payroll',
        `annualPayrollClp must be a non-negative finite number, got ${payroll}`,
      );
    }
  }

  const breakdown: Ds67PeriodBreakdown[] = periods.map((period, i) => {
    // art. 2 f): the promedio anual de trabajadores is expressed with two
    // decimals before any division.
    const avgWorkers = roundHalfUp(period.averageWorkers, 2);
    // art. 2 h).
    const temporaryRate = roundHalfUp((period.lostDays / avgWorkers) * 100, 2);
    // art. 2 j): sum of values × 100 / promedio anual de trabajadores.
    let valueSum = 0;
    for (const band of INVALIDITY_BANDS) {
      valueSum += (period.invalidityEvents?.[band] ?? 0) * DS67_INVALIDITY_VALUES[band];
    }
    const imFactor = roundHalfUp((valueSum * 100) / avgWorkers, 2);
    return {
      label: period.label ?? `Período anual ${i + 1}`,
      temporaryRate,
      imFactor,
    };
  });

  // art. 2 i): average of the temporary rates, integer half-up.
  const averageTemporaryRate = roundHalfUp(
    breakdown.reduce((acc, p) => acc + p.temporaryRate, 0) / breakdown.length,
    0,
  );
  // art. 2 j): average of the factors, 2 decimals, then table lookup.
  const imFactorAverage = roundHalfUp(
    breakdown.reduce((acc, p) => acc + p.imFactor, 0) / breakdown.length,
    2,
  );
  const invalidityDeathRate = lookupInvalidityDeathRate(imFactorAverage);
  // art. 2 k).
  const totalRate = averageTemporaryRate + invalidityDeathRate;
  // art. 5.
  const additionalCotizacionPct = lookupAdditionalCotizacion(totalRate);

  const current = input.currentAdditionalCotizacionPct;
  const payroll = input.annualPayrollClp;
  const deltaPct = current === undefined ? null : roundHalfUp(additionalCotizacionPct - current, 2);
  const annualCostClp =
    payroll === undefined ? null : Math.round((payroll * additionalCotizacionPct) / 100);
  const currentAnnualCostClp =
    payroll === undefined || current === undefined ? null : Math.round((payroll * current) / 100);
  const annualCostDeltaClp =
    annualCostClp === null || currentAnnualCostClp === null
      ? null
      : annualCostClp - currentAnnualCostClp;

  return {
    periods: breakdown,
    averageTemporaryRate,
    imFactorAverage,
    invalidityDeathRate,
    totalRate,
    additionalCotizacionPct,
    deltaPct,
    annualCostClp,
    currentAnnualCostClp,
    annualCostDeltaClp,
    legalCitation: DS67_LEGAL_CITATION,
  };
}
