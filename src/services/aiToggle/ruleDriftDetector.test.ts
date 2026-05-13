import { describe, it, expect } from 'vitest';
import {
  detectRuleDrift,
  type RuleApplicationSample,
} from './ruleDriftDetector';

function sample(
  ruleId: string,
  period: string,
  applicationCount: number,
  totalEntitiesEvaluated: number,
): RuleApplicationSample {
  return { ruleId, period, applicationCount, totalEntitiesEvaluated };
}

// 6 períodos estables a ratio 0.5 (50/100)
function stableSeries(ruleId: string, periods = 6): RuleApplicationSample[] {
  const out: RuleApplicationSample[] = [];
  for (let i = 1; i <= periods; i++) {
    out.push(sample(ruleId, `2026-${String(i).padStart(2, '0')}`, 50, 100));
  }
  return out;
}

describe('detectRuleDrift', () => {
  it('serie estable → cero alertas', () => {
    const alerts = detectRuleDrift(stableSeries('r1'));
    expect(alerts).toEqual([]);
  });

  it('omite reglas con baseline insuficiente (<minBaselinePeriods)', () => {
    const samples: RuleApplicationSample[] = [
      sample('r1', '2026-01', 50, 100),
      sample('r1', '2026-02', 90, 100), // huge change pero solo 1 previo
    ];
    const alerts = detectRuleDrift(samples);
    expect(alerts).toEqual([]);
  });

  it('caída 80% → block_and_investigate decreasing', () => {
    const base = stableSeries('r1', 5);
    base.push(sample('r1', '2026-06', 10, 100)); // 0.5 → 0.1 = -80%
    const alerts = detectRuleDrift(base);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe('decreasing');
    expect(alerts[0].severity).toBe('block_and_investigate');
    expect(alerts[0].changePct).toBeCloseTo(-80, 1);
  });

  it('caída 50-79% → critical decreasing', () => {
    const base = stableSeries('r1', 5);
    base.push(sample('r1', '2026-06', 20, 100)); // 0.5 → 0.2 = -60%
    const alerts = detectRuleDrift(base);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].direction).toBe('decreasing');
    expect(alerts[0].recommendation).toMatch(/obsoleta|incompletos/i);
  });

  it('caída 20-49% → warning', () => {
    const base = stableSeries('r1', 5);
    base.push(sample('r1', '2026-06', 35, 100)); // 0.5 → 0.35 = -30%
    const alerts = detectRuleDrift(base);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].direction).toBe('decreasing');
  });

  it('caída <20% → info (no se emite alerta)', () => {
    const base = stableSeries('r1', 5);
    base.push(sample('r1', '2026-06', 45, 100)); // -10%
    const alerts = detectRuleDrift(base);
    expect(alerts).toEqual([]);
  });

  it('subida 80%+ → block_and_investigate increasing', () => {
    const base = stableSeries('r1', 5);
    base.push(sample('r1', '2026-06', 90, 100)); // 0.5 → 0.9 = +80%
    const alerts = detectRuleDrift(base);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe('increasing');
    expect(alerts[0].severity).toBe('block_and_investigate');
    expect(alerts[0].changePct).toBeCloseTo(80, 1);
  });

  it('subida critical → recomienda revisar falso positivo', () => {
    const base = stableSeries('r1', 5);
    base.push(sample('r1', '2026-06', 80, 100)); // +60%
    const alerts = detectRuleDrift(base);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].direction).toBe('increasing');
    expect(alerts[0].recommendation).toMatch(/falso positivo/i);
  });

  it('subida warning level → warning', () => {
    const base = stableSeries('r1', 5);
    base.push(sample('r1', '2026-06', 65, 100)); // +30%
    const alerts = detectRuleDrift(base);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].direction).toBe('increasing');
  });

  it('baseline ratio 0 + current > 0 → critical increasing (regla nueva apareció)', () => {
    const samples: RuleApplicationSample[] = [
      sample('r1', '2026-01', 0, 100),
      sample('r1', '2026-02', 0, 100),
      sample('r1', '2026-03', 0, 100),
      sample('r1', '2026-04', 0, 100),
      sample('r1', '2026-05', 25, 100),
    ];
    const alerts = detectRuleDrift(samples);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].direction).toBe('increasing');
    expect(alerts[0].changePct).toBe(100);
  });

  it('baseline 0 + current 0 → no alerta', () => {
    const samples: RuleApplicationSample[] = [
      sample('r1', '2026-01', 0, 100),
      sample('r1', '2026-02', 0, 100),
      sample('r1', '2026-03', 0, 100),
      sample('r1', '2026-04', 0, 100),
    ];
    const alerts = detectRuleDrift(samples);
    expect(alerts).toEqual([]);
  });

  it('totalEntitiesEvaluated=0 → ratio 0 (no crash)', () => {
    const samples: RuleApplicationSample[] = [
      sample('r1', '2026-01', 50, 100),
      sample('r1', '2026-02', 50, 100),
      sample('r1', '2026-03', 50, 100),
      sample('r1', '2026-04', 50, 100),
      sample('r1', '2026-05', 0, 0), // sin evaluaciones este período
    ];
    const alerts = detectRuleDrift(samples);
    // current ratio = 0, baseline = 0.5 → -100% → block_and_investigate
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe('decreasing');
    expect(alerts[0].severity).toBe('block_and_investigate');
  });

  it('múltiples reglas se reportan independientes, orden por |changePct| desc', () => {
    const samples = [
      ...stableSeries('rA', 5),
      sample('rA', '2026-06', 45, 100), // -10% → info, no alerta
      ...stableSeries('rB', 5),
      sample('rB', '2026-06', 10, 100), // -80% → block
      ...stableSeries('rC', 5),
      sample('rC', '2026-06', 65, 100), // +30% → warning
    ];
    const alerts = detectRuleDrift(samples);
    expect(alerts.map((a) => a.ruleId)).toEqual(['rB', 'rC']);
  });

  it('baselineWindow recorta el histórico considerado', () => {
    // Histórico antiguo a 0.9, reciente a 0.5, current a 0.45 → baseline=0.5, -10% → info.
    // Con baselineWindow=12 captura ambos rangos. Con window=3 solo recientes.
    const samples: RuleApplicationSample[] = [
      sample('r1', '2026-01', 90, 100),
      sample('r1', '2026-02', 90, 100),
      sample('r1', '2026-03', 90, 100),
      sample('r1', '2026-04', 50, 100),
      sample('r1', '2026-05', 50, 100),
      sample('r1', '2026-06', 50, 100),
      sample('r1', '2026-07', 25, 100), // current
    ];
    // window=3 → mediana de [0.5,0.5,0.5]=0.5, current 0.25 → -50% critical
    const alertsNarrow = detectRuleDrift(samples, { baselineWindow: 3 });
    expect(alertsNarrow[0].severity).toBe('critical');
    // window=12 → mediana de [0.9,0.9,0.9,0.5,0.5,0.5]=0.7, current 0.25 → ~-64% critical
    const alertsWide = detectRuleDrift(samples, { baselineWindow: 12 });
    expect(alertsWide[0].severity).toBe('critical');
    expect(Math.abs(alertsWide[0].changePct)).toBeGreaterThan(
      Math.abs(alertsNarrow[0].changePct),
    );
  });

  it('minBaselinePeriods=5 omite reglas con solo 4 períodos previos', () => {
    const samples = [
      ...stableSeries('r1', 4), // 4 períodos
      sample('r1', '2026-05', 10, 100), // sería -80% pero baseline insuficiente
    ];
    const alerts = detectRuleDrift(samples, { minBaselinePeriods: 5 });
    expect(alerts).toEqual([]);
  });

  it('alerta incluye periods y ratios redondeados', () => {
    const base = stableSeries('r1', 5);
    base.push(sample('r1', '2026-06', 10, 100));
    const alerts = detectRuleDrift(base);
    expect(alerts[0].baseline.ratio).toBeCloseTo(0.5, 6);
    expect(alerts[0].current.ratio).toBeCloseTo(0.1, 6);
    expect(alerts[0].current.period).toBe('2026-06');
  });

  it('lex sort funciona con periods semanales YYYY-Wnn', () => {
    const samples: RuleApplicationSample[] = [
      sample('r1', '2026-W01', 50, 100),
      sample('r1', '2026-W02', 50, 100),
      sample('r1', '2026-W03', 50, 100),
      sample('r1', '2026-W04', 50, 100),
      sample('r1', '2026-W05', 10, 100), // -80%
    ];
    const alerts = detectRuleDrift(samples);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].current.period).toBe('2026-W05');
    expect(alerts[0].severity).toBe('block_and_investigate');
  });
});
