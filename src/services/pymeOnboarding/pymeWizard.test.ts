import { describe, it, expect } from 'vitest';
import { computeMaturity, buildThirtyDayPlan, type PymeWizardInput } from './pymeWizard.js';

function input(over: Partial<PymeWizardInput> = {}): PymeWizardInput {
  return {
    industry: 'construction',
    workerCount: 30,
    hasSupervisor: false,
    hasCphs: false,
    hasRiohs: false,
    hasTrainingProgram: false,
    registersIncidents: false,
    hasMutualidad: false,
    usesNormedEpp: false,
    ...over,
  };
}

describe('computeMaturity', () => {
  it('PYME sin nada → level 1 reactive', () => {
    const r = computeMaturity(input());
    expect(r.level).toBe(1);
    expect(r.label).toBe('reactive');
  });

  it('PYME completa → level 5 autonomous', () => {
    const r = computeMaturity({
      industry: 'construction',
      workerCount: 30,
      hasSupervisor: true,
      hasCphs: true,
      hasRiohs: true,
      hasTrainingProgram: true,
      registersIncidents: true,
      hasMutualidad: true,
      usesNormedEpp: true,
    });
    expect(r.level).toBe(5);
    expect(r.missingCapabilities).toEqual([]);
  });

  it('CPHS obligatorio si >=25 workers — flag si falta', () => {
    const r = computeMaturity(input({ workerCount: 30, hasCphs: false }));
    expect(r.missingCapabilities.some((m) => /CPHS/.test(m))).toBe(true);
  });

  it('CPHS no obligatorio si <25 workers', () => {
    const r = computeMaturity(input({ workerCount: 10, hasCphs: false }));
    expect(r.missingCapabilities.some((m) => /CPHS/.test(m))).toBe(false);
  });

  it('nextSteps lista las 3 capabilities más críticas', () => {
    const r = computeMaturity(input());
    expect(r.nextSteps.length).toBeLessThanOrEqual(3);
  });
});

describe('buildThirtyDayPlan', () => {
  it('día 1 prioriza mutualidad si falta', () => {
    const maturity = computeMaturity(input());
    const plan = buildThirtyDayPlan(maturity, 'construction');
    expect(plan[0].title).toMatch(/mutualidad/i);
  });

  it('plan incluye revisión mensual al día 30', () => {
    const maturity = computeMaturity(input());
    const plan = buildThirtyDayPlan(maturity, 'construction');
    expect(plan[plan.length - 1].day).toBe(30);
  });

  it('construcción incluye arnés en EPP base', () => {
    const maturity = computeMaturity(input({ industry: 'construction' }));
    const plan = buildThirtyDayPlan(maturity, 'construction');
    const eppAction = plan.find((a) => /EPP/.test(a.title));
    expect(eppAction?.rationale).toMatch(/arnés/i);
  });
});
