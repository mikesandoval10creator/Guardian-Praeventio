import { describe, it, expect } from 'vitest';
import {
  estimateBill,
  compareTiers,
  workerBreakEven,
  TIER_TABLE,
  PricingError,
  type UsageProfile,
} from './pricingSimulator.js';

function usage(over: Partial<UsageProfile> = {}): UsageProfile {
  return {
    workers: 10,
    projects: 2,
    aiCallsPerMonth: 100,
    storageGb: 5,
    ...over,
  };
}

describe('estimateBill', () => {
  it('starter tier sin overage', () => {
    const r = estimateBill('starter', usage());
    expect(r.fitsWithoutOverage).toBe(true);
    expect(r.totalClp).toBe(TIER_TABLE.starter.monthlyBaseClp);
    expect(r.totalOverageClp).toBe(0);
  });

  it('free tier con 10 workers genera overage workers', () => {
    const r = estimateBill('free', usage({ workers: 10 }));
    expect(r.overage.workers.excess).toBe(5);
    expect(r.overage.workers.clp).toBe(5 * 1500);
    expect(r.fitsWithoutOverage).toBe(false);
  });

  it('starter con 30 workers + 4 proyectos → overage doble', () => {
    const r = estimateBill('starter', usage({ workers: 30, projects: 4 }));
    expect(r.overage.workers.excess).toBe(5);
    expect(r.overage.projects.excess).toBe(1);
    expect(r.totalClp).toBeGreaterThan(TIER_TABLE.starter.monthlyBaseClp);
  });

  it('pro tier 100 workers exacto → no overage', () => {
    const r = estimateBill('pro', usage({ workers: 100, projects: 10, aiCallsPerMonth: 5000, storageGb: 100 }));
    expect(r.fitsWithoutOverage).toBe(true);
  });

  it('enterprise tier nunca tiene overage de workers (limit infinito)', () => {
    const r = estimateBill('enterprise', usage({ workers: 50_000 }));
    expect(r.overage.workers.excess).toBe(0);
  });

  it('rechaza usage no-finito', () => {
    expect(() => estimateBill('starter', usage({ workers: NaN }))).toThrowError(PricingError);
    expect(() => estimateBill('starter', usage({ workers: -1 }))).toThrowError(PricingError);
  });
});

describe('compareTiers', () => {
  it('uso pesado en starter sugiere pro', () => {
    const comps = compareTiers('starter', usage({ workers: 80, projects: 8, aiCallsPerMonth: 3000 }));
    const pro = comps.find((c) => c.tier === 'pro');
    expect(pro).toBeDefined();
    if (pro) {
      // Pro debería ser recomendado (cuesta menos o fit perfecto)
      expect(pro.recommended).toBe(true);
    }
  });

  it('uso mínimo en free → no recomienda upgrade', () => {
    const comps = compareTiers('free', usage({ workers: 3, projects: 1, aiCallsPerMonth: 20, storageGb: 0.5 }));
    const starter = comps.find((c) => c.tier === 'starter');
    expect(starter?.recommended).toBe(false);
  });

  it('compareTiers retorna las 4 tiers', () => {
    const comps = compareTiers('starter', usage());
    expect(comps.map((c) => c.tier).sort()).toEqual(['enterprise', 'free', 'pro', 'starter']);
  });

  it('diffClpVsCurrent es 0 para el mismo tier', () => {
    const comps = compareTiers('pro', usage());
    const pro = comps.find((c) => c.tier === 'pro');
    expect(pro?.diffClpVsCurrent).toBe(0);
  });
});

describe('workerBreakEven', () => {
  it('encuentra punto donde pro es mejor que starter', () => {
    const r = workerBreakEven('starter', 'pro', usage({ workers: 20, aiCallsPerMonth: 300, storageGb: 5 }));
    expect(r.found).toBe(true);
    expect(r.workers).toBeGreaterThan(20);
    expect(r.workers).toBeLessThan(200);
  });

  it('si nextTier ya es más barato desde el inicio, retorna baseUsage', () => {
    const r = workerBreakEven('pro', 'enterprise', usage({ workers: 5_000, projects: 50, aiCallsPerMonth: 50_000, storageGb: 800 }));
    expect(r.found).toBe(true);
  });
});
