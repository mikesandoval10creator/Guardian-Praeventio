import { describe, it, expect } from 'vitest';
import {
  TIERS,
  getTierById,
  formatCurrency,
  withIVA,
  calculateMonthlyCost,
  suggestUpgrade,
  type TierId,
} from './tiers';

describe('TIERS data integrity (7-metal scheme)', () => {
  it('contains exactly 7 tiers (Gratis + 5 metales + Diamante)', () => {
    expect(TIERS.length).toBe(7);
  });

  it('exposes the canonical ids in order', () => {
    const ids: TierId[] = [
      'gratis',
      'cobre',
      'plata',
      'oro',
      'titanio',
      'platino',
      'diamante',
    ];
    expect(TIERS.map((t) => t.id)).toEqual(ids);
  });
});

describe('getTierById', () => {
  it('returns gratis tier with $0 prices and a 3-person cap', () => {
    const t = getTierById('gratis');
    expect(t.clpRegular).toBe(0);
    expect(t.usdRegular).toBe(0);
    expect(t.trabajadoresMax).toBe(3);
    expect(t.proyectosMax).toBe(1);
  });

  it('returns cobre (intermediate multi-faena) tier with overage', () => {
    const t = getTierById('cobre');
    expect(t.clpRegular).toBe(9990);
    expect(t.clpIntro3mo).toBe(6990);
    expect(t.clpAnual).toBe(89910); // 9990 × 9 — save 3 months
    expect(t.usdRegular).toBe(11);
    expect(t.trabajadoresMax).toBe(72);
    expect(t.proyectosMax).toBe(3);
    expect(t.trabajadorExtraClp).toBe(990);
  });

  it('returns plata tier with clpRegular 19990', () => {
    expect(getTierById('plata').clpRegular).toBe(19990);
    expect(getTierById('plata').usdRegular).toBe(22);
    expect(getTierById('plata').trabajadoresMax).toBe(99);
  });

  it('returns oro tier with clpRegular 79990', () => {
    expect(getTierById('oro').clpRegular).toBe(79990);
    expect(getTierById('oro').usdRegular).toBe(88);
    expect(getTierById('oro').trabajadoresMax).toBe(499);
  });

  it('returns titanio tier with clpRegular 249990 and sso-basic workspace', () => {
    const t = getTierById('titanio');
    expect(t.clpRegular).toBe(249990);
    expect(t.usdRegular).toBe(270);
    expect(t.workspaceTier).toBe('sso-basic');
  });

  it('returns platino tier (enterprise band) with clpRegular 899990', () => {
    const t = getTierById('platino');
    expect(t.clpRegular).toBe(899990);
    expect(t.usdRegular).toBe(970);
    expect(t.workspaceTier).toBe('multi-tenant-csm');
  });

  it('returns diamante (the jewel) with Infinity capacities + multi residency', () => {
    const t = getTierById('diamante');
    expect(t.clpRegular).toBe(3900000);
    expect(t.usdRegular).toBe(4200);
    expect(t.trabajadoresMax).toBe(Infinity);
    expect(t.proyectosMax).toBe(Infinity);
    expect(t.jurisdictionsMax).toBe(Infinity);
    expect(t.dataResidency).toBe('multi');
    expect(t.multiJurisdiction).toBe(true);
    expect(t.workspaceTier).toBe('vertex-finetuned');
  });

  it('throws for unknown id', () => {
    // @ts-expect-error - intentionally invalid
    expect(() => getTierById('does-not-exist')).toThrow();
  });
});

describe('formatCurrency', () => {
  it('formats CLP with Chilean punctuation (dots, no decimals)', () => {
    expect(formatCurrency(11990, 'CLP')).toBe('$11.990 CLP');
  });

  it('formats large CLP amounts with multiple separators', () => {
    expect(formatCurrency(2999990, 'CLP')).toBe('$2.999.990 CLP');
  });

  it('formats zero CLP correctly', () => {
    expect(formatCurrency(0, 'CLP')).toBe('$0 CLP');
  });

  it('formats USD with no decimals', () => {
    expect(formatCurrency(13, 'USD')).toBe('$13 USD');
  });

  it('formats large USD amounts with thousands separator', () => {
    expect(formatCurrency(6315, 'USD')).toBe('$6,315 USD');
  });
});

describe('withIVA', () => {
  it('reverse-engineers IVA so display total matches the .990 number', () => {
    expect(withIVA(10075)).toEqual({ subtotal: 10075, iva: 1915, total: 11990 });
  });

  it('returns zeros for zero subtotal', () => {
    expect(withIVA(0)).toEqual({ subtotal: 0, iva: 0, total: 0 });
  });

  it('handles a clean integer where IVA is exact', () => {
    // 100 * 0.19 = 19
    expect(withIVA(100)).toEqual({ subtotal: 100, iva: 19, total: 119 });
  });
});

describe('calculateMonthlyCost', () => {
  it('Cobre, 50 workers, 2 projects → no overage', () => {
    const r = calculateMonthlyCost('cobre', 50, 2);
    expect(r.base).toBe(9990);
    expect(r.workerOverage).toBe(0);
    expect(r.projectOverage).toBe(0);
    expect(r.total).toBe(9990);
  });

  it('Cobre, 80 workers, 3 projects → worker overage at 990', () => {
    const r = calculateMonthlyCost('cobre', 80, 3);
    expect(r.base).toBe(9990);
    expect(r.workerOverage).toBe(8 * 990); // 80 - 72
    expect(r.projectOverage).toBe(0);
    expect(r.total).toBe(9990 + 8 * 990);
  });

  it('Oro, 600 workers, 1 project → 101 worker overage at 290', () => {
    const r = calculateMonthlyCost('oro', 600, 1);
    expect(r.base).toBe(79990);
    expect(r.workerOverage).toBe(101 * 290); // 600 - 499
    expect(r.total).toBe(79990 + 101 * 290);
  });

  it('Titanio premium tier with overflow throws to force upgrade', () => {
    expect(() => calculateMonthlyCost('titanio', 5000, 200)).toThrow(/upgrade/i);
  });

  it('Titanio within limits returns base only', () => {
    const r = calculateMonthlyCost('titanio', 1000, 50);
    expect(r.base).toBe(249990);
    expect(r.workerOverage).toBe(0);
    expect(r.total).toBe(249990);
  });

  it('Gratis within limits returns 0', () => {
    const r = calculateMonthlyCost('gratis', 3, 1);
    expect(r.total).toBe(0);
  });

  it('Diamante always returns base regardless of usage', () => {
    const r = calculateMonthlyCost('diamante', 50000, 1000);
    expect(r.total).toBe(3900000);
    expect(r.workerOverage).toBe(0);
    expect(r.projectOverage).toBe(0);
  });
});

describe('suggestUpgrade', () => {
  it('Cobre @ 90 workers suggests upgrade (overage > delta to Plata)', () => {
    // overage = (90-72)*990 = 17820; delta to plata = 19990 - 9990 = 10000
    expect(suggestUpgrade('cobre', 90, 1)).toBe('plata');
  });

  it('Cobre @ 75 workers does NOT suggest upgrade (overage < delta)', () => {
    // overage = 3*990 = 2970; delta = 10000
    expect(suggestUpgrade('cobre', 75, 1)).toBeNull();
  });

  it('within limits returns null', () => {
    expect(suggestUpgrade('cobre', 50, 1)).toBeNull();
  });

  it('Oro at very high workers suggests titanio upgrade', () => {
    // overage = (1200-499)*290 = 203290; delta to titanio = 249990 - 79990 = 170000
    expect(suggestUpgrade('oro', 1200, 1)).toBe('titanio');
  });

  it('Premium tiers (Titanio+) return null because no overage', () => {
    expect(suggestUpgrade('titanio', 1000, 50)).toBeNull();
  });
});
