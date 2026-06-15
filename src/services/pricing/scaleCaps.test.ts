// Behavioral tests for the server-side scale-cap core (real code, no mocks).
// Pins: plan→caps mapping in the 7-metal scheme, fail-closed-to-free for
// unknown plans, legacy-alias normalization (pre-collapse ids), and the
// projected-vs-cap decision used by the report-only / enforce callers.

import { describe, it, expect } from 'vitest';
import { scaleCapsForPlan, evaluateScaleCap } from './scaleCaps.js';
import { SUBSCRIPTION_PLANS } from './subscriptionPlan.js';

describe('scaleCapsForPlan', () => {
  it('maps each plan to its tier caps (7-metal scheme)', () => {
    expect(scaleCapsForPlan('free')).toEqual({ trabajadoresMax: 3, proyectosMax: 1 });
    expect(scaleCapsForPlan('cobre')).toEqual({ trabajadoresMax: 72, proyectosMax: 3 });
    expect(scaleCapsForPlan('plata')).toEqual({ trabajadoresMax: 99, proyectosMax: 10 });
    expect(scaleCapsForPlan('oro')).toEqual({ trabajadoresMax: 499, proyectosMax: 50 });
    expect(scaleCapsForPlan('titanio')).toEqual({ trabajadoresMax: 1999, proyectosMax: 100 });
    expect(scaleCapsForPlan('platino')).toEqual({ trabajadoresMax: 9999, proyectosMax: 500 });
    expect(scaleCapsForPlan('diamante')).toEqual({
      trabajadoresMax: Infinity,
      proyectosMax: Infinity,
    });
  });

  it('resolves pre-collapse legacy plan ids to the closest-up 7-metal cap', () => {
    // comité → Plata band; departamento → Oro band; ilimitado → Diamante.
    expect(scaleCapsForPlan('comite')).toEqual({ trabajadoresMax: 99, proyectosMax: 10 });
    expect(scaleCapsForPlan('departamento')).toEqual({ trabajadoresMax: 499, proyectosMax: 50 });
    expect(scaleCapsForPlan('ilimitado')).toEqual({
      trabajadoresMax: Infinity,
      proyectosMax: Infinity,
    });
  });

  it('fails CLOSED to the free plan for unknown / missing values', () => {
    const free = { trabajadoresMax: 3, proyectosMax: 1 };
    expect(scaleCapsForPlan(undefined)).toEqual(free);
    expect(scaleCapsForPlan(null)).toEqual(free);
    expect(scaleCapsForPlan('not-a-plan')).toEqual(free);
    expect(scaleCapsForPlan(42)).toEqual(free);
  });

  it('normalizes legacy aliases (premium→oro, basic→cobre)', () => {
    expect(scaleCapsForPlan('premium')).toEqual({ trabajadoresMax: 499, proyectosMax: 50 });
    expect(scaleCapsForPlan('basic')).toEqual({ trabajadoresMax: 72, proyectosMax: 3 });
  });

  it('every declared plan resolves to caps > 0 (guards an orphaned plan with no tier row)', () => {
    // If a future plan is added to SUBSCRIPTION_PLANS without a TIERS entry,
    // scaleCapsForPlan would return {0,0} → block everything in enforce mode.
    // This test fails CI before that ships. (The runtime also fails closed to
    // free caps as a belt-and-suspenders.)
    for (const plan of SUBSCRIPTION_PLANS) {
      const caps = scaleCapsForPlan(plan);
      expect(caps.trabajadoresMax, `${plan}.trabajadoresMax`).toBeGreaterThan(0);
      expect(caps.proyectosMax, `${plan}.proyectosMax`).toBeGreaterThan(0);
    }
  });
});

describe('evaluateScaleCap', () => {
  it('is within cap when projected count does not exceed the plan cap', () => {
    const d = evaluateScaleCap({ plan: 'free', kind: 'workers', current: 2, delta: 1 });
    expect(d).toMatchObject({ cap: 3, current: 2, projected: 3, withinCap: true });
  });

  it('is over cap when adding one more would exceed the plan cap', () => {
    const d = evaluateScaleCap({ plan: 'free', kind: 'workers', current: 3, delta: 1 });
    expect(d).toMatchObject({ plan: 'free', cap: 3, projected: 4, withinCap: false });
  });

  it('gates projects independently from workers', () => {
    expect(evaluateScaleCap({ plan: 'free', kind: 'projects', current: 1, delta: 1 }))
      .toMatchObject({ cap: 1, projected: 2, withinCap: false });
    expect(evaluateScaleCap({ plan: 'cobre', kind: 'projects', current: 2, delta: 1 }))
      .toMatchObject({ cap: 3, projected: 3, withinCap: true });
  });

  it('defaults delta to 1 and clamps a negative current to 0', () => {
    expect(evaluateScaleCap({ plan: 'plata', kind: 'workers', current: 98 }))
      .toMatchObject({ projected: 99, withinCap: true });
    expect(evaluateScaleCap({ plan: 'plata', kind: 'workers', current: -5 }))
      .toMatchObject({ current: 0, projected: 1, withinCap: true });
  });

  it('clamps a negative delta to 0 so it cannot "subtract past" the cap', () => {
    // current already over cap; a hostile negative delta must NOT flip withinCap true.
    const d = evaluateScaleCap({ plan: 'free', kind: 'workers', current: 20, delta: -50 });
    expect(d).toMatchObject({ current: 20, projected: 20, withinCap: false });
  });

  it('never blocks an unlimited plan (diamante)', () => {
    const d = evaluateScaleCap({ plan: 'diamante', kind: 'workers', current: 1_000_000, delta: 1 });
    expect(d.cap).toBe(Infinity);
    expect(d.withinCap).toBe(true);
  });

  it('fails closed to free caps for an unknown plan', () => {
    const d = evaluateScaleCap({ plan: 'mystery', kind: 'workers', current: 10, delta: 1 });
    expect(d).toMatchObject({ plan: 'free', cap: 3, withinCap: false });
  });
});
