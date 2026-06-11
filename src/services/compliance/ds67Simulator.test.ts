// Praeventio Guard — Épica B1 (capa 2): DS 67 additional-cotización simulator.
//
// RED-first TDD for the pure engine `ds67Simulator.ts`. Every threshold in
// the legal tables is pinned here against the verbatim text of DS 67/1999
// (MINTRAB, BCN idNorma=159800), verified 2026-06-11:
//
//   - art. 2 f): Promedio Anual de Trabajadores — 2 decimals, half-up.
//   - art. 2 h): Tasa de Siniestralidad por Incapacidades Temporales —
//     (días perdidos / promedio anual de trabajadores) × 100, 2 dec half-up.
//   - art. 2 i): Tasa Promedio — average over evaluation period, expressed
//     WITHOUT decimals, half-up on the first decimal.
//   - art. 2 j): invalidity/death values + Factor → Tasa de Siniestralidad
//     por Invalideces y Muertes lookup table (0..385).
//   - art. 2 k): Tasa de Siniestralidad Total = i) + j).
//   - art. 5: Tasa Total → cotización adicional table (0,00% .. 6,80%).
//
// Do NOT change a single boundary without re-reading the norm.

import { describe, it, expect } from 'vitest';
import {
  DS67_INVALIDITY_VALUES,
  Ds67ValidationError,
  evaluationPeriodWindows,
  formatClp,
  lookupAdditionalCotizacion,
  lookupInvalidityDeathRate,
  roundHalfUp,
  simulateDs67,
  type Ds67SimulationInput,
} from './ds67Simulator';

// ─────────────────────────────────────────────────────────────────────────
// roundHalfUp — the rounding rule the norm repeats verbatim in art. 2
// letters f), h), i) and j): raise the last kept digit when the next one
// is ≥ 5, discard otherwise.
// ─────────────────────────────────────────────────────────────────────────

describe('roundHalfUp (art. 2 rounding rule)', () => {
  it('rounds 2-decimal half-up exactly at the .xx5 boundary', () => {
    expect(roundHalfUp(3.125, 2)).toBe(3.13);
    expect(roundHalfUp(3.124, 2)).toBe(3.12);
    expect(roundHalfUp(0.105, 2)).toBe(0.11);
    expect(roundHalfUp(0.104, 2)).toBe(0.1);
  });

  it('survives IEEE-754 representation noise (1.005, 2.675)', () => {
    // Naive Math.round(x*100)/100 returns 1.0 / 2.67 here.
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
  });

  it('rounds to integer half-up on the first decimal (art. 2 i)', () => {
    expect(roundHalfUp(32.5, 0)).toBe(33);
    expect(roundHalfUp(32.49, 0)).toBe(32);
    expect(roundHalfUp(0.5, 0)).toBe(1);
    expect(roundHalfUp(0.49, 0)).toBe(0);
  });

  it('is identity for already-quantized values', () => {
    expect(roundHalfUp(425, 0)).toBe(425);
    expect(roundHalfUp(2.5, 2)).toBe(2.5);
    expect(roundHalfUp(0, 2)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// art. 2 j) — values per invalidity degree / death.
// ─────────────────────────────────────────────────────────────────────────

describe('DS67_INVALIDITY_VALUES (art. 2 j))', () => {
  it('pins the six legal values verbatim', () => {
    expect(DS67_INVALIDITY_VALUES.invalidez_15_25).toBe(0.25);
    expect(DS67_INVALIDITY_VALUES.invalidez_27_5_37_5).toBe(0.5);
    expect(DS67_INVALIDITY_VALUES.invalidez_40_65).toBe(1.0);
    expect(DS67_INVALIDITY_VALUES.invalidez_70_plus).toBe(1.5);
    expect(DS67_INVALIDITY_VALUES.gran_invalidez).toBe(2.0);
    expect(DS67_INVALIDITY_VALUES.muerte).toBe(2.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// art. 2 j) — Factor promedio → Tasa de Siniestralidad por Invalideces y
// Muertes. All 12 rows, both bounds of each range. The promedio is
// expressed with two decimals, so consecutive ranges are contiguous at
// the centésima.
// ─────────────────────────────────────────────────────────────────────────

describe('lookupInvalidityDeathRate (tabla art. 2 j))', () => {
  const rows: Array<[lower: number, upper: number, rate: number]> = [
    [0.0, 0.1, 0],
    [0.11, 0.3, 35],
    [0.31, 0.5, 70],
    [0.51, 0.7, 105],
    [0.71, 0.9, 140],
    [0.91, 1.2, 175],
    [1.21, 1.5, 210],
    [1.51, 1.8, 245],
    [1.81, 2.1, 280],
    [2.11, 2.4, 315],
    [2.41, 2.7, 350],
  ];
  it.each(rows)('promedio %f a %f → tasa %i', (lower, upper, rate) => {
    expect(lookupInvalidityDeathRate(lower)).toBe(rate);
    expect(lookupInvalidityDeathRate(upper)).toBe(rate);
  });

  it('promedio 2,71 y más → 385 (last row, open-ended)', () => {
    expect(lookupInvalidityDeathRate(2.71)).toBe(385);
    expect(lookupInvalidityDeathRate(7.5)).toBe(385);
  });

  it('rejects negative or non-finite promedios', () => {
    expect(() => lookupInvalidityDeathRate(-0.01)).toThrow(Ds67ValidationError);
    expect(() => lookupInvalidityDeathRate(Number.NaN)).toThrow(Ds67ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// art. 5 — Tasa de Siniestralidad Total → cotización adicional. All 21
// rows, both bounds of each integer range (the Tasa Total is an integer:
// art. 2 i) is expressed without decimals and the art. 2 j) tasas are
// multiples of 35).
// ─────────────────────────────────────────────────────────────────────────

describe('lookupAdditionalCotizacion (tabla art. 5)', () => {
  const rows: Array<[lower: number, upper: number, pct: number]> = [
    [0, 32, 0.0],
    [33, 64, 0.34],
    [65, 96, 0.68],
    [97, 128, 1.02],
    [129, 160, 1.36],
    [161, 192, 1.7],
    [193, 224, 2.04],
    [225, 272, 2.38],
    [273, 320, 2.72],
    [321, 368, 3.06],
    [369, 416, 3.4],
    [417, 464, 3.74],
    [465, 512, 4.08],
    [513, 560, 4.42],
    [561, 630, 4.76],
    [631, 700, 5.1],
    [701, 770, 5.44],
    [771, 840, 5.78],
    [841, 910, 6.12],
    [911, 980, 6.46],
  ];
  it.each(rows)('tasa total %i a %i → %f%%', (lower, upper, pct) => {
    expect(lookupAdditionalCotizacion(lower)).toBe(pct);
    expect(lookupAdditionalCotizacion(upper)).toBe(pct);
  });

  it('tasa total 981 y más → 6,80% (ceiling of the table)', () => {
    expect(lookupAdditionalCotizacion(981)).toBe(6.8);
    expect(lookupAdditionalCotizacion(50_000)).toBe(6.8);
  });

  it('rejects negative or non-finite tasas', () => {
    expect(() => lookupAdditionalCotizacion(-1)).toThrow(Ds67ValidationError);
    expect(() => lookupAdditionalCotizacion(Number.POSITIVE_INFINITY)).toThrow(
      Ds67ValidationError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// evaluationPeriodWindows — períodos anuales 1 julio → 30 junio (art. 2 b),
// the N períodos immediately preceding the most recent 1° de julio
// (art. 2 a).
// ─────────────────────────────────────────────────────────────────────────

describe('evaluationPeriodWindows (arts. 2 a) y 2 b))', () => {
  it('before July 1st the cut is the previous year (3 periods)', () => {
    const windows = evaluationPeriodWindows(new Date('2026-06-11T12:00:00Z'), 3);
    expect(windows).toHaveLength(3);
    expect(windows[0].startIso).toBe('2022-07-01T00:00:00.000Z');
    expect(windows[0].endIso).toBe('2023-07-01T00:00:00.000Z');
    expect(windows[2].startIso).toBe('2024-07-01T00:00:00.000Z');
    expect(windows[2].endIso).toBe('2025-07-01T00:00:00.000Z');
  });

  it('on/after July 1st the cut moves to the current year', () => {
    const windows = evaluationPeriodWindows(new Date('2026-07-01T00:00:00Z'), 3);
    expect(windows[2].endIso).toBe('2026-07-01T00:00:00.000Z');
  });

  it('labels use DD-MM-YYYY (convención es-CL)', () => {
    const windows = evaluationPeriodWindows(new Date('2026-06-11T12:00:00Z'), 3);
    expect(windows[2].label).toBe('01-07-2024 al 30-06-2025');
  });

  it('supports the 2-period evaluation (afiliación entre 2 y 3 años)', () => {
    const windows = evaluationPeriodWindows(new Date('2026-06-11T12:00:00Z'), 2);
    expect(windows).toHaveLength(2);
    expect(windows[0].startIso).toBe('2023-07-01T00:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// formatClp — rule #2: CLP `$1.234.567`.
// ─────────────────────────────────────────────────────────────────────────

describe('formatClp (convención CLP es-CL)', () => {
  it('groups thousands with dots and prefixes $', () => {
    expect(formatClp(1_234_567)).toBe('$1.234.567');
    expect(formatClp(0)).toBe('$0');
    expect(formatClp(999)).toBe('$999');
    expect(formatClp(57_120_000)).toBe('$57.120.000');
  });

  it('keeps the minus sign outside the $ (rebaja)', () => {
    expect(formatClp(-20_400_000)).toBe('-$20.400.000');
  });

  it('rounds fractional pesos to the nearest integer', () => {
    expect(formatClp(1000.6)).toBe('$1.001');
  });

  it('rejects non-finite amounts', () => {
    expect(() => formatClp(Number.NaN)).toThrow(Ds67ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// simulateDs67 — end-to-end pure computation.
// ─────────────────────────────────────────────────────────────────────────

function recargoInput(): Ds67SimulationInput {
  return {
    periods: [
      { averageWorkers: 100, lostDays: 350 },
      { averageWorkers: 100, lostDays: 425 },
      {
        averageWorkers: 100,
        lostDays: 500,
        invalidityEvents: { muerte: 1 },
      },
    ],
    currentAdditionalCotizacionPct: 0.68,
    annualPayrollClp: 1_200_000_000,
  };
}

describe('simulateDs67', () => {
  it('worked recargo example: tasas + tabla art. 5 + costo CLP', () => {
    const r = simulateDs67(recargoInput());
    // art. 2 h: 350/100×100, 425/100×100, 500/100×100.
    expect(r.periods.map((p) => p.temporaryRate)).toEqual([350, 425, 500]);
    // art. 2 i: (350+425+500)/3 = 425 (integer).
    expect(r.averageTemporaryRate).toBe(425);
    // art. 2 j: factor P3 = 2,5×100/100 = 2,50; promedio (0+0+2,50)/3 = 0,83.
    expect(r.periods.map((p) => p.imFactor)).toEqual([0, 0, 2.5]);
    expect(r.imFactorAverage).toBe(0.83);
    // tabla art. 2 j: 0,71–0,90 → 140.
    expect(r.invalidityDeathRate).toBe(140);
    // art. 2 k: 425 + 140 = 565 → tabla art. 5: 561–630 → 4,76%.
    expect(r.totalRate).toBe(565);
    expect(r.additionalCotizacionPct).toBe(4.76);
    // Delta vs current 0,68% and projected annual cost on the payroll.
    expect(r.deltaPct).toBe(4.08);
    expect(r.annualCostClp).toBe(57_120_000);
    expect(r.currentAnnualCostClp).toBe(8_160_000);
    expect(r.annualCostDeltaClp).toBe(48_960_000);
    expect(r.legalCitation).toContain('DS 67');
    expect(r.legalCitation).toContain('5°');
    expect(r.legalCitation).toContain('159800');
  });

  it('zero-incident case is a REBAJA: 0% and negative deltas', () => {
    const r = simulateDs67({
      periods: [
        { averageWorkers: 80, lostDays: 0 },
        { averageWorkers: 80, lostDays: 0 },
        { averageWorkers: 80, lostDays: 0 },
      ],
      currentAdditionalCotizacionPct: 3.4,
      annualPayrollClp: 600_000_000,
    });
    expect(r.totalRate).toBe(0);
    expect(r.additionalCotizacionPct).toBe(0);
    expect(r.deltaPct).toBe(-3.4);
    expect(r.annualCostClp).toBe(0);
    expect(r.annualCostDeltaClp).toBe(-20_400_000);
  });

  it('art. 2 i integer rounding decides the art. 5 bracket at 32/33', () => {
    const up = simulateDs67({
      periods: [
        { averageWorkers: 100, lostDays: 33 },
        { averageWorkers: 100, lostDays: 32 },
      ],
    });
    // (33 + 32)/2 = 32,5 → 33 → bracket 33–64 → 0,34%.
    expect(up.averageTemporaryRate).toBe(33);
    expect(up.additionalCotizacionPct).toBe(0.34);

    const down = simulateDs67({
      periods: [
        { averageWorkers: 100, lostDays: 32 },
        { averageWorkers: 100, lostDays: 32 },
      ],
    });
    expect(down.averageTemporaryRate).toBe(32);
    expect(down.additionalCotizacionPct).toBe(0);
  });

  it('art. 2 h keeps two decimals per period (1/32×100 = 3,13)', () => {
    const r = simulateDs67({
      periods: [
        { averageWorkers: 32, lostDays: 1 },
        { averageWorkers: 32, lostDays: 1 },
      ],
    });
    expect(r.periods[0].temporaryRate).toBe(3.13);
  });

  it('art. 2 j factor centésima boundary: 0,13 → 35; 0,08 → 0', () => {
    const over = simulateDs67({
      periods: [
        { averageWorkers: 2000, lostDays: 0, invalidityEvents: { muerte: 1 } },
        { averageWorkers: 2000, lostDays: 0, invalidityEvents: { muerte: 1 } },
      ],
    });
    // factor = 2,5×100/2000 = 0,125 → 0,13 per period; promedio 0,13 → 35.
    expect(over.imFactorAverage).toBe(0.13);
    expect(over.invalidityDeathRate).toBe(35);

    const under = simulateDs67({
      periods: [
        { averageWorkers: 3000, lostDays: 0, invalidityEvents: { muerte: 1 } },
        { averageWorkers: 3000, lostDays: 0, invalidityEvents: { muerte: 1 } },
      ],
    });
    // factor = 0,0833… → 0,08 → tramo 0,00–0,10 → 0.
    expect(under.imFactorAverage).toBe(0.08);
    expect(under.invalidityDeathRate).toBe(0);
  });

  it('mixes invalidity bands with their legal values', () => {
    const r = simulateDs67({
      periods: [
        { averageWorkers: 100, lostDays: 0 },
        { averageWorkers: 100, lostDays: 0 },
        {
          averageWorkers: 100,
          lostDays: 0,
          invalidityEvents: {
            invalidez_15_25: 2, // 2 × 0,25 = 0,50
            invalidez_40_65: 1, // 1,00
            gran_invalidez: 1, // 2,00
          },
        },
      ],
    });
    // factor P3 = 3,5×100/100 = 3,50; promedio = 3,50/3 = 1,17 → 0,91–1,20 → 175.
    expect(r.periods[2].imFactor).toBe(3.5);
    expect(r.imFactorAverage).toBe(1.17);
    expect(r.invalidityDeathRate).toBe(175);
  });

  it('quantizes averageWorkers to two decimals first (art. 2 f)', () => {
    const r = simulateDs67({
      periods: [
        // 100,005 → 100,01 per art. 2 f; 50/100,01×100 = 49,995… → 50,00.
        { averageWorkers: 100.005, lostDays: 50 },
        { averageWorkers: 100.005, lostDays: 50 },
      ],
    });
    expect(r.periods[0].temporaryRate).toBe(50);
  });

  it('omits delta/cost outputs when current rate or payroll are missing', () => {
    const r = simulateDs67({
      periods: [
        { averageWorkers: 10, lostDays: 5 },
        { averageWorkers: 10, lostDays: 5 },
      ],
    });
    expect(r.deltaPct).toBeNull();
    expect(r.annualCostClp).toBeNull();
    expect(r.currentAnnualCostClp).toBeNull();
    expect(r.annualCostDeltaClp).toBeNull();
  });

  it('rejects invalid period counts (art. 2 a: 2 o 3 períodos)', () => {
    expect(() => simulateDs67({ periods: [] })).toThrow(Ds67ValidationError);
    expect(() =>
      simulateDs67({ periods: [{ averageWorkers: 10, lostDays: 0 }] }),
    ).toThrow(Ds67ValidationError);
    expect(() =>
      simulateDs67({
        periods: Array.from({ length: 4 }, () => ({
          averageWorkers: 10,
          lostDays: 0,
        })),
      }),
    ).toThrow(Ds67ValidationError);
  });

  it('rejects non-positive workforce, negative days and negative counts', () => {
    const base = { averageWorkers: 10, lostDays: 0 };
    expect(() =>
      simulateDs67({ periods: [{ ...base, averageWorkers: 0 }, base] }),
    ).toThrow(Ds67ValidationError);
    expect(() =>
      simulateDs67({ periods: [{ ...base, lostDays: -1 }, base] }),
    ).toThrow(Ds67ValidationError);
    expect(() =>
      simulateDs67({ periods: [{ ...base, lostDays: 1.5 }, base] }),
    ).toThrow(Ds67ValidationError);
    expect(() =>
      simulateDs67({
        periods: [{ ...base, invalidityEvents: { muerte: -1 } }, base],
      }),
    ).toThrow(Ds67ValidationError);
    expect(() =>
      simulateDs67({
        periods: [{ ...base, invalidityEvents: { muerte: 0.5 } }, base],
      }),
    ).toThrow(Ds67ValidationError);
  });

  it('rejects invalid optional inputs (current rate / payroll)', () => {
    const periods = [
      { averageWorkers: 10, lostDays: 0 },
      { averageWorkers: 10, lostDays: 0 },
    ];
    expect(() =>
      simulateDs67({ periods, currentAdditionalCotizacionPct: -0.1 }),
    ).toThrow(Ds67ValidationError);
    expect(() =>
      simulateDs67({ periods, annualPayrollClp: -1 }),
    ).toThrow(Ds67ValidationError);
  });

  it('is deterministic (same input → same output)', () => {
    expect(simulateDs67(recargoInput())).toEqual(simulateDs67(recargoInput()));
  });
});
