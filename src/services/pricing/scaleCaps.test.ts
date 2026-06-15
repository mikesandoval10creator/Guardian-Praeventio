// Behavioral tests for the server-side scale-cap core (real code, no mocks).
// Pins: plan→caps mapping (incl. the multi-tier `ilimitado` MAX merge),
// fail-closed-to-free for unknown plans, legacy-alias normalization, and the
// projected-vs-cap decision used by the report-only / enforce callers.

import { describe, it, expect } from 'vitest';
import { scaleCapsForPlan, evaluateScaleCap } from './scaleCaps.js';

describe('scaleCapsForPlan', () => {
  it('maps each paid plan to its tier caps', () => {
    expect(scaleCapsForPlan('free')).toEqual({ trabajadoresMax: 10, proyectosMax: 1 });
    expect(scaleCapsForPlan('comite')).toEqual({ trabajadoresMax: 25, proyectosMax: 3 });
    expect(scaleCapsForPlan('departamento')).toEqual({ trabajadoresMax: 100, proyectosMax: 10 });
    expect(scaleCapsForPlan('plata')).toEqual({ trabajadoresMax: 250, proyectosMax: 25 });
    expect(scaleCapsForPlan('oro')).toEqual({ trabajadoresMax: 500, proyectosMax: 50 });
    // `platino` plan is the home of the `diamante` tier (1000 / 100).
    expect(scaleCapsForPlan('platino')).toEqual({ trabajadoresMax: 1000, proyectosMax: 100 });
  });

  it('takes the MAX cap when several tiers map to one plan (ilimitado ← ilimitado + global-titanio)', () => {
    // Both `ilimitado` and `global-titanio` tiers resolve to the `ilimitado`
    // plan; both have Infinity caps, so the merged cap is Infinity (never
    // under-reports a paid plan).
    expect(scaleCapsForPlan('ilimitado')).toEqual({
      trabajadoresMax: Infinity,
      proyectosMax: Infinity,
    });
  });

  it('fails CLOSED to the free plan for unknown / missing values', () => {
    const free = { trabajadoresMax: 10, proyectosMax: 1 };
    expect(scaleCapsForPlan(undefined)).toEqual(free);
    expect(scaleCapsForPlan(null)).toEqual(free);
    expect(scaleCapsForPlan('not-a-plan')).toEqual(free);
    expect(scaleCapsForPlan(42)).toEqual(free);
  });

  it('normalizes legacy aliases (premium→departamento, basic→comite)', () => {
    expect(scaleCapsForPlan('premium')).toEqual({ trabajadoresMax: 100, proyectosMax: 10 });
    expect(scaleCapsForPlan('basic')).toEqual({ trabajadoresMax: 25, proyectosMax: 3 });
  });
});

describe('evaluateScaleCap', () => {
  it('is within cap when projected count does not exceed the plan cap', () => {
    const d = evaluateScaleCap({ plan: 'free', kind: 'workers', current: 9, delta: 1 });
    expect(d).toMatchObject({ cap: 10, current: 9, projected: 10, withinCap: true });
  });

  it('is over cap when adding one more would exceed the plan cap', () => {
    const d = evaluateScaleCap({ plan: 'free', kind: 'workers', current: 10, delta: 1 });
    expect(d).toMatchObject({ plan: 'free', cap: 10, projected: 11, withinCap: false });
  });

  it('gates projects independently from workers', () => {
    expect(evaluateScaleCap({ plan: 'free', kind: 'projects', current: 1, delta: 1 }))
      .toMatchObject({ cap: 1, projected: 2, withinCap: false });
    expect(evaluateScaleCap({ plan: 'comite', kind: 'projects', current: 2, delta: 1 }))
      .toMatchObject({ cap: 3, projected: 3, withinCap: true });
  });

  it('defaults delta to 1 and clamps a negative current to 0', () => {
    expect(evaluateScaleCap({ plan: 'comite', kind: 'workers', current: 24 }))
      .toMatchObject({ projected: 25, withinCap: true });
    expect(evaluateScaleCap({ plan: 'comite', kind: 'workers', current: -5 }))
      .toMatchObject({ current: 0, projected: 1, withinCap: true });
  });

  it('never blocks an unlimited plan', () => {
    const d = evaluateScaleCap({ plan: 'ilimitado', kind: 'workers', current: 1_000_000, delta: 1 });
    expect(d.cap).toBe(Infinity);
    expect(d.withinCap).toBe(true);
  });

  it('fails closed to free caps for an unknown plan', () => {
    const d = evaluateScaleCap({ plan: 'mystery', kind: 'workers', current: 10, delta: 1 });
    expect(d).toMatchObject({ plan: 'free', cap: 10, withinCap: false });
  });
});
