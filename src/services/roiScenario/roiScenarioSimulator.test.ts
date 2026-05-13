import { describe, it, expect } from 'vitest';
import {
  compareScenarios,
  type InvestmentScenario,
  type BaselineState,
} from './roiScenarioSimulator.js';

const baseline: BaselineState = {
  averageDirectCostPerIncidentClp: 5_000_000,
  baselineRatePerYear: 10,
  workersCount: 200,
  indirectMultiplier: 4,
};

function makeScenario(
  overrides: Partial<InvestmentScenario> & { id: string },
): InvestmentScenario {
  return {
    id: overrides.id,
    name: overrides.name ?? `Scenario ${overrides.id}`,
    description: overrides.description ?? 'test scenario',
    investments: overrides.investments ?? [
      { category: 'training', amountClp: 5_000_000 },
      { category: 'epp', amountClp: 5_000_000 },
    ],
    assumptions: overrides.assumptions ?? {
      expectedIncidentReductionPct: 30,
      expectedComplianceImprovementPct: 20,
      paybackMonthsEstimate: 12,
      confidenceLevel: 'medium',
    },
  };
}

describe('compareScenarios — §175 extendido ROI scenario simulator', () => {
  it('lanza si no se pasa ningún escenario', () => {
    expect(() => compareScenarios([], baseline)).toThrow(/at least 1/i);
  });

  it('devuelve outcomes 1:1 con escenarios entregados', () => {
    const scenarios = [
      makeScenario({ id: 'a' }),
      makeScenario({ id: 'b' }),
      makeScenario({ id: 'c' }),
    ];
    const result = compareScenarios(scenarios, baseline);
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.map((o) => o.scenarioId)).toEqual(['a', 'b', 'c']);
  });

  it('totalInvestmentClp suma todas las categorías', () => {
    const result = compareScenarios(
      [
        makeScenario({
          id: 's1',
          investments: [
            { category: 'training', amountClp: 1_000_000 },
            { category: 'epp', amountClp: 2_000_000 },
            { category: 'engineering', amountClp: 3_000_000 },
            { category: 'controls', amountClp: 1_500_000 },
            { category: 'audits', amountClp: 500_000 },
          ],
        }),
      ],
      baseline,
    );
    expect(result.outcomes[0].totalInvestmentClp).toBe(8_000_000);
  });

  it('ignora montos negativos en inversiones', () => {
    const result = compareScenarios(
      [
        makeScenario({
          id: 'neg',
          investments: [
            { category: 'training', amountClp: 1_000_000 },
            { category: 'epp', amountClp: -500_000 },
          ],
        }),
      ],
      baseline,
    );
    expect(result.outcomes[0].totalInvestmentClp).toBe(1_000_000);
  });

  it('savings refleja reducción × baseline × Heinrich', () => {
    // 30% × 10 incidentes × 5M directo + 4× indirecto = 3 × 5M × 5 = 75M.
    const result = compareScenarios(
      [
        makeScenario({
          id: 'savings',
          assumptions: {
            expectedIncidentReductionPct: 30,
            expectedComplianceImprovementPct: 0,
            paybackMonthsEstimate: 12,
            confidenceLevel: 'medium',
          },
        }),
      ],
      baseline,
    );
    expect(result.outcomes[0].projectedSavingsClp).toBe(75_000_000);
  });

  it('ROI% = (savings - investment) / investment * 100', () => {
    // savings=75M, inv=10M → ROI = 650%.
    const result = compareScenarios(
      [
        makeScenario({
          id: 'roi',
          investments: [
            { category: 'training', amountClp: 5_000_000 },
            { category: 'epp', amountClp: 5_000_000 },
          ],
          assumptions: {
            expectedIncidentReductionPct: 30,
            expectedComplianceImprovementPct: 0,
            paybackMonthsEstimate: 12,
            confidenceLevel: 'medium',
          },
        }),
      ],
      baseline,
    );
    expect(result.outcomes[0].projectedRoiPercent).toBe(650);
  });

  it('clampea expectedIncidentReductionPct > 100 a 100', () => {
    const result = compareScenarios(
      [
        makeScenario({
          id: 'over',
          assumptions: {
            expectedIncidentReductionPct: 500,
            expectedComplianceImprovementPct: 0,
            paybackMonthsEstimate: 6,
            confidenceLevel: 'high',
          },
        }),
      ],
      baseline,
    );
    // 100% × 10 × 5M × 5 = 250M savings.
    expect(result.outcomes[0].projectedSavingsClp).toBe(250_000_000);
  });

  it('clampea expectedIncidentReductionPct < 0 a 0', () => {
    const result = compareScenarios(
      [
        makeScenario({
          id: 'neg',
          assumptions: {
            expectedIncidentReductionPct: -50,
            expectedComplianceImprovementPct: 0,
            paybackMonthsEstimate: 999,
            confidenceLevel: 'low',
          },
        }),
      ],
      baseline,
    );
    expect(result.outcomes[0].projectedSavingsClp).toBe(0);
    expect(result.outcomes[0].paybackMonths).toBe(Number.POSITIVE_INFINITY);
  });

  it('paybackMonths es Infinity cuando savings <= 0', () => {
    const result = compareScenarios(
      [
        makeScenario({
          id: 'no-savings',
          assumptions: {
            expectedIncidentReductionPct: 0,
            expectedComplianceImprovementPct: 0,
            paybackMonthsEstimate: 0,
            confidenceLevel: 'low',
          },
        }),
      ],
      baseline,
    );
    expect(result.outcomes[0].paybackMonths).toBe(Number.POSITIVE_INFINITY);
  });

  it('ROI es Infinity si inversión = 0 y savings > 0', () => {
    const result = compareScenarios(
      [
        makeScenario({
          id: 'free',
          investments: [],
          assumptions: {
            expectedIncidentReductionPct: 50,
            expectedComplianceImprovementPct: 0,
            paybackMonthsEstimate: 1,
            confidenceLevel: 'high',
          },
        }),
      ],
      baseline,
    );
    expect(result.outcomes[0].projectedRoiPercent).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('sensitivityBand: lower <= proyectado <= upper', () => {
    const result = compareScenarios(
      [
        makeScenario({
          id: 'sens',
          assumptions: {
            expectedIncidentReductionPct: 40,
            expectedComplianceImprovementPct: 20,
            paybackMonthsEstimate: 8,
            confidenceLevel: 'medium',
          },
        }),
      ],
      baseline,
    );
    const o = result.outcomes[0];
    expect(o.sensitivityBand.roiLowerBound).toBeLessThanOrEqual(
      o.projectedRoiPercent as number,
    );
    expect(o.sensitivityBand.roiUpperBound).toBeGreaterThanOrEqual(
      o.projectedRoiPercent as number,
    );
  });

  it('sensitivityBand ±20% en supuestos produce delta esperado', () => {
    // reduction=50, low=40, high=60.
    // baseline = 10 incidentes, costo 5M, Heinrich 5×.
    // Inv = 10M.
    // savings low  = 0.4 × 10 × 5M × 5 = 100M → ROI = 900%
    // savings high = 0.6 × 10 × 5M × 5 = 150M → ROI = 1400%
    const result = compareScenarios(
      [
        makeScenario({
          id: 'band',
          assumptions: {
            expectedIncidentReductionPct: 50,
            expectedComplianceImprovementPct: 0,
            paybackMonthsEstimate: 6,
            confidenceLevel: 'high',
          },
        }),
      ],
      baseline,
    );
    expect(result.outcomes[0].sensitivityBand.roiLowerBound).toBe(900);
    expect(result.outcomes[0].sensitivityBand.roiUpperBound).toBe(1400);
  });

  it('recommendationScore mayor ROI gana sobre score menor', () => {
    const great = makeScenario({
      id: 'great',
      name: 'Great',
      investments: [{ category: 'training', amountClp: 5_000_000 }],
      assumptions: {
        expectedIncidentReductionPct: 50,
        expectedComplianceImprovementPct: 40,
        paybackMonthsEstimate: 3,
        confidenceLevel: 'high',
      },
    });
    const poor = makeScenario({
      id: 'poor',
      name: 'Poor',
      investments: [{ category: 'training', amountClp: 100_000_000 }],
      assumptions: {
        expectedIncidentReductionPct: 5,
        expectedComplianceImprovementPct: 5,
        paybackMonthsEstimate: 36,
        confidenceLevel: 'low',
      },
    });
    const result = compareScenarios([poor, great], baseline);
    expect(result.recommendedScenario.scenarioId).toBe('great');
    const greatScore = result.outcomes.find((o) => o.scenarioId === 'great')!
      .recommendationScore;
    const poorScore = result.outcomes.find((o) => o.scenarioId === 'poor')!
      .recommendationScore;
    expect(greatScore).toBeGreaterThan(poorScore);
  });

  it('confidence high penaliza menos que confidence low (con resto igual)', () => {
    const high = makeScenario({
      id: 'h',
      assumptions: {
        expectedIncidentReductionPct: 30,
        expectedComplianceImprovementPct: 20,
        paybackMonthsEstimate: 12,
        confidenceLevel: 'high',
      },
    });
    const low = makeScenario({
      id: 'l',
      assumptions: {
        expectedIncidentReductionPct: 30,
        expectedComplianceImprovementPct: 20,
        paybackMonthsEstimate: 12,
        confidenceLevel: 'low',
      },
    });
    const result = compareScenarios([high, low], baseline);
    const hScore = result.outcomes.find((o) => o.scenarioId === 'h')!
      .recommendationScore;
    const lScore = result.outcomes.find((o) => o.scenarioId === 'l')!
      .recommendationScore;
    expect(hScore).toBeGreaterThan(lScore);
  });

  it('recommendationScore está clampeado en [0, 100]', () => {
    const stellar = makeScenario({
      id: 'stellar',
      investments: [{ category: 'training', amountClp: 1_000_000 }],
      assumptions: {
        expectedIncidentReductionPct: 100,
        expectedComplianceImprovementPct: 100,
        paybackMonthsEstimate: 1,
        confidenceLevel: 'high',
      },
    });
    const awful = makeScenario({
      id: 'awful',
      investments: [{ category: 'training', amountClp: 999_000_000 }],
      assumptions: {
        expectedIncidentReductionPct: 0,
        expectedComplianceImprovementPct: 0,
        paybackMonthsEstimate: 999,
        confidenceLevel: 'low',
      },
    });
    const result = compareScenarios([stellar, awful], baseline);
    for (const o of result.outcomes) {
      expect(o.recommendationScore).toBeGreaterThanOrEqual(0);
      expect(o.recommendationScore).toBeLessThanOrEqual(100);
    }
  });

  it('recommendedScenario es el de mayor score', () => {
    const a = makeScenario({
      id: 'a',
      assumptions: {
        expectedIncidentReductionPct: 25,
        expectedComplianceImprovementPct: 10,
        paybackMonthsEstimate: 18,
        confidenceLevel: 'low',
      },
    });
    const b = makeScenario({
      id: 'b',
      assumptions: {
        expectedIncidentReductionPct: 45,
        expectedComplianceImprovementPct: 30,
        paybackMonthsEstimate: 6,
        confidenceLevel: 'high',
      },
    });
    const c = makeScenario({
      id: 'c',
      assumptions: {
        expectedIncidentReductionPct: 35,
        expectedComplianceImprovementPct: 20,
        paybackMonthsEstimate: 10,
        confidenceLevel: 'medium',
      },
    });
    const result = compareScenarios([a, b, c], baseline);
    const maxScore = Math.max(
      ...result.outcomes.map((o) => o.recommendationScore),
    );
    expect(result.recommendedScenario.recommendationScore).toBe(maxScore);
    expect(result.recommendedScenario.scenarioId).toBe('b');
  });

  it('rationale incluye nombre + score del escenario recomendado', () => {
    const result = compareScenarios(
      [
        makeScenario({ id: 'x', name: 'Plan Alfa' }),
        makeScenario({
          id: 'y',
          name: 'Plan Beta',
          assumptions: {
            expectedIncidentReductionPct: 70,
            expectedComplianceImprovementPct: 40,
            paybackMonthsEstimate: 4,
            confidenceLevel: 'high',
          },
        }),
      ],
      baseline,
    );
    expect(result.rationale.join('\n')).toContain('Plan Beta');
    expect(result.rationale.some((r) => r.includes('/100'))).toBe(true);
  });

  it('rationale menciona runner-up cuando hay > 1 escenario', () => {
    const result = compareScenarios(
      [
        makeScenario({ id: 'a', name: 'Alfa' }),
        makeScenario({
          id: 'b',
          name: 'Beta',
          assumptions: {
            expectedIncidentReductionPct: 80,
            expectedComplianceImprovementPct: 50,
            paybackMonthsEstimate: 3,
            confidenceLevel: 'high',
          },
        }),
      ],
      baseline,
    );
    expect(
      result.rationale.some((r) => r.toLowerCase().includes('runner-up')),
    ).toBe(true);
  });

  it('rationale no incluye runner-up si solo hay 1 escenario', () => {
    const result = compareScenarios([makeScenario({ id: 'solo' })], baseline);
    expect(
      result.rationale.some((r) => r.toLowerCase().includes('runner-up')),
    ).toBe(false);
  });

  it('rationale advierte cuando score < 40', () => {
    const result = compareScenarios(
      [
        makeScenario({
          id: 'weak',
          investments: [{ category: 'training', amountClp: 200_000_000 }],
          assumptions: {
            expectedIncidentReductionPct: 5,
            expectedComplianceImprovementPct: 5,
            paybackMonthsEstimate: 36,
            confidenceLevel: 'low',
          },
        }),
      ],
      baseline,
    );
    expect(
      result.rationale.some((r) => r.toLowerCase().includes('score recomendado')),
    ).toBe(true);
  });

  it('baseline se devuelve sin modificar', () => {
    const result = compareScenarios([makeScenario({ id: 's' })], baseline);
    expect(result.baseline).toEqual(baseline);
  });

  it('es determinístico (mismo input → mismo output)', () => {
    const scenarios = [
      makeScenario({ id: 'a' }),
      makeScenario({ id: 'b' }),
    ];
    const r1 = compareScenarios(scenarios, baseline);
    const r2 = compareScenarios(scenarios, baseline);
    expect(r1).toEqual(r2);
  });

  it('respeta indirectMultiplier del baseline (Heinrich custom)', () => {
    const customBaseline: BaselineState = { ...baseline, indirectMultiplier: 2 };
    // 30% × 10 × 5M × (1+2) = 45M.
    const result = compareScenarios(
      [
        makeScenario({
          id: 'custom',
          assumptions: {
            expectedIncidentReductionPct: 30,
            expectedComplianceImprovementPct: 0,
            paybackMonthsEstimate: 12,
            confidenceLevel: 'medium',
          },
        }),
      ],
      customBaseline,
    );
    expect(result.outcomes[0].projectedSavingsClp).toBe(45_000_000);
  });

  it('tie-break por ROI cuando scores empatan', () => {
    // Dos escenarios idénticos excepto en inversión (mismo ROI pero distinta escala).
    // Mismos assumptions → mismo score. Tie-break por ROI.
    const small = makeScenario({
      id: 'small',
      investments: [{ category: 'training', amountClp: 1_000_000 }],
      assumptions: {
        expectedIncidentReductionPct: 20,
        expectedComplianceImprovementPct: 10,
        paybackMonthsEstimate: 12,
        confidenceLevel: 'medium',
      },
    });
    const big = makeScenario({
      id: 'big',
      investments: [{ category: 'training', amountClp: 50_000_000 }],
      assumptions: {
        expectedIncidentReductionPct: 20,
        expectedComplianceImprovementPct: 10,
        paybackMonthsEstimate: 12,
        confidenceLevel: 'medium',
      },
    });
    const result = compareScenarios([big, small], baseline);
    // small tiene ROI mucho mayor (mismo savings, menor inversión).
    expect(result.recommendedScenario.scenarioId).toBe('small');
  });
});
