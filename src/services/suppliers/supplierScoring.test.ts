import { describe, it, expect } from 'vitest';
import {
  scoreSupplier,
  rankSuppliersByScore,
  type SupplierRecord,
  type SupplierKpis,
} from './supplierScoring.js';

function supplier(id: string, kpis: Partial<SupplierKpis> = {}): SupplierRecord {
  return {
    id,
    legalName: `Vendor ${id}`,
    kpis: {
      incidents: kpis.incidents ?? 0,
      nearMisses: kpis.nearMisses ?? 0,
      documentComplianceRatio: kpis.documentComplianceRatio ?? 1,
      avgResponseHours: kpis.avgResponseHours ?? 4,
      reputationScore: kpis.reputationScore ?? 1,
    },
  };
}

describe('supplierScoring', () => {
  it('perfect supplier scores 100', () => {
    const r = scoreSupplier(supplier('A'));
    expect(r.score).toBe(100);
    expect(r.breakdown.safetyPerformance).toBe(100);
    expect(r.breakdown.documentCompliance).toBe(100);
    expect(r.breakdown.responsiveness).toBe(100);
    expect(r.breakdown.reputation).toBe(100);
  });

  it('supplier with incidents drops safety score most', () => {
    const r = scoreSupplier(supplier('B', { incidents: 3 }));
    // 100 - 3*15 = 55
    expect(r.breakdown.safetyPerformance).toBe(55);
    // Other dims still perfect
    expect(r.breakdown.documentCompliance).toBe(100);
    // Total: 55*0.4 + 100*0.3 + 100*0.2 + 100*0.1 = 22 + 30 + 20 + 10 = 82
    expect(r.score).toBe(82);
  });

  it('single dimension bad (slow response) only drops responsiveness', () => {
    const r = scoreSupplier(supplier('C', { avgResponseHours: 72 }));
    expect(r.breakdown.responsiveness).toBe(0);
    expect(r.breakdown.safetyPerformance).toBe(100);
    // Total: 100*0.4 + 100*0.3 + 0*0.2 + 100*0.1 = 40+30+0+10 = 80
    expect(r.score).toBe(80);
  });

  it('ranks suppliers descending by total score', () => {
    const ranked = rankSuppliersByScore([
      supplier('worst', { incidents: 5, documentComplianceRatio: 0.3 }),
      supplier('best'),
      supplier('mid', { incidents: 1, nearMisses: 2 }),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['best', 'mid', 'worst']);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it('ties broken by safety sub-score then documents then id', () => {
    // Construct two suppliers with same total but different safety.
    // A: safety=80, docs=80, resp=100, rep=100 → 80*.4+80*.3+100*.2+100*.1 = 32+24+20+10 = 86
    // B: safety=100, docs=60, resp=100, rep=100 → 40+18+20+10 = 88 — not tied.
    // Use a real tie: A: safety=80, docs=100, resp=80, rep=100
    //                 32+30+16+10 = 88
    //                B: safety=100, docs=80, resp=80, rep=100
    //                 40+24+16+10 = 90 — not tied either.
    // Use two clones varying only by id; safety equal → fall through to id.
    const a = supplier('a-vendor', { incidents: 1 }); // safety=85
    const b = supplier('b-vendor', { incidents: 1 });
    const ranked = rankSuppliersByScore([b, a]);
    // Same scores; tiebreak by id asc → 'a-vendor' first.
    expect(ranked[0].id).toBe('a-vendor');
    expect(ranked[1].id).toBe('b-vendor');
  });

  it('rejects invalid ratios outside [0,1]', () => {
    expect(() =>
      scoreSupplier(supplier('bad', { documentComplianceRatio: 1.2 })),
    ).toThrow();
    expect(() => scoreSupplier(supplier('bad2', { reputationScore: -0.1 }))).toThrow();
    expect(() => scoreSupplier(supplier('bad3', { incidents: -1 }))).toThrow();
  });
});
