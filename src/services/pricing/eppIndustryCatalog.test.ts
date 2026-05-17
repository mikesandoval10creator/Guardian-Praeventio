// Praeventio Guard — Sprint K §171-179 — EPP catalog tests.

import { describe, it, expect } from 'vitest';
import {
  estimateMonthlyEppBudgetClp,
  getEppCatalogForIndustry,
  EPP_DEFAULT_CATALOG,
  EPP_INDUSTRY_CATALOG,
  SUPPORTED_INDUSTRY_OPTIONS,
} from './eppIndustryCatalog';

describe('getEppCatalogForIndustry', () => {
  it('returns the mining catalog for GP-MIN', () => {
    const cat = getEppCatalogForIndustry('GP-MIN');
    expect(cat).toBe(EPP_INDUSTRY_CATALOG['GP-MIN']);
    expect(cat.some((x) => x.kind === 'helmet')).toBe(true);
  });

  it('falls back to default when industry unknown', () => {
    expect(getEppCatalogForIndustry('GP-UNKNOWN-XYZ')).toBe(EPP_DEFAULT_CATALOG);
    expect(getEppCatalogForIndustry(null)).toBe(EPP_DEFAULT_CATALOG);
    expect(getEppCatalogForIndustry(undefined)).toBe(EPP_DEFAULT_CATALOG);
  });
});

describe('estimateMonthlyEppBudgetClp', () => {
  it('returns zeros for workerCount<=0', () => {
    const r = estimateMonthlyEppBudgetClp('GP-CONS', 0);
    expect(r).toEqual({ totalClp: 0, perWorkerClp: 0, itemsCount: 0 });
  });

  it('scales linearly with worker count', () => {
    const r10 = estimateMonthlyEppBudgetClp('GP-CONS', 10);
    const r20 = estimateMonthlyEppBudgetClp('GP-CONS', 20);
    expect(r20.totalClp).toBeGreaterThan(r10.totalClp);
    // 20 trabajadores ~2× presupuesto (tolerancia 1 CLP por redondeo).
    expect(Math.abs(r20.totalClp - r10.totalClp * 2)).toBeLessThanOrEqual(20);
  });

  it('uses default catalog when industry unknown', () => {
    const a = estimateMonthlyEppBudgetClp('UNKNOWN', 50);
    const b = estimateMonthlyEppBudgetClp(null, 50);
    expect(a.totalClp).toBe(b.totalClp);
    expect(a.itemsCount).toBe(EPP_DEFAULT_CATALOG.length);
  });

  it('returns a positive budget for every supported industry', () => {
    for (const opt of SUPPORTED_INDUSTRY_OPTIONS) {
      const r = estimateMonthlyEppBudgetClp(opt.prefix, 100);
      expect(r.totalClp).toBeGreaterThan(0);
      expect(r.itemsCount).toBeGreaterThan(0);
    }
  });
});
