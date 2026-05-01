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

describe('TIERS data integrity', () => {
  it('contains exactly 10 tiers', () => {
    expect(TIERS.length).toBe(10);
  });

  it('exposes the canonical ids in order', () => {
    const ids: TierId[] = [
      'gratis',
      'comite-paritario',
      'departamento-prevencion',
      'plata',
      'oro',
      'titanio',
      'diamante',
      'empresarial',
      'corporativo',
      'ilimitado',
    ];
    expect(TIERS.map((t) => t.id)).toEqual(ids);
  });
});

describe('getTierById', () => {
  it('returns gratis tier with $0 prices', () => {
    const t = getTierById('gratis');
    expect(t.clpRegular).toBe(0);
    expect(t.usdRegular).toBe(0);
    expect(t.trabajadoresMax).toBe(10);
    expect(t.proyectosMax).toBe(1);
  });

  it('returns comite-paritario tier with clpRegular 11990', () => {
    expect(getTierById('comite-paritario').clpRegular).toBe(11990);
    expect(getTierById('comite-paritario').clpIntro3mo).toBe(7990);
    expect(getTierById('comite-paritario').clpAnual).toBe(96990);
    expect(getTierById('comite-paritario').usdRegular).toBe(13);
  });

  it('returns departamento-prevencion tier with clpRegular 30990', () => {
    expect(getTierById('departamento-prevencion').clpRegular).toBe(30990);
    expect(getTierById('departamento-prevencion').usdRegular).toBe(33);
  });

  it('returns plata tier with clpRegular 50990', () => {
    expect(getTierById('plata').clpRegular).toBe(50990);
    expect(getTierById('plata').usdRegular).toBe(54);
  });

  it('returns oro tier with clpRegular 90990', () => {
    expect(getTierById('oro').clpRegular).toBe(90990);
    expect(getTierById('oro').usdRegular).toBe(96);
  });

  it('returns titanio tier with clpRegular 249990 and sso-basic workspace', () => {
    const t = getTierById('titanio');
    expect(t.clpRegular).toBe(249990);
    expect(t.usdRegular).toBe(263);
    expect(t.workspaceTier).toBe('sso-basic');
  });

  it('returns diamante tier with clpRegular 499990', () => {
    const t = getTierById('diamante');
    expect(t.clpRegular).toBe(499990);
    expect(t.usdRegular).toBe(526);
    expect(t.workspaceTier).toBe('sso-casa');
  });

  it('returns empresarial tier with clpRegular 1499990', () => {
    expect(getTierById('empresarial').clpRegular).toBe(1499990);
    expect(getTierById('empresarial').usdRegular).toBe(1578);
    expect(getTierById('empresarial').workspaceTier).toBe('multi-tenant');
  });

  it('returns corporativo tier with clpRegular 2999990', () => {
    expect(getTierById('corporativo').clpRegular).toBe(2999990);
    expect(getTierById('corporativo').usdRegular).toBe(3158);
    expect(getTierById('corporativo').workspaceTier).toBe('multi-tenant-csm');
  });

  it('returns ilimitado tier with Infinity capacities', () => {
    const t = getTierById('ilimitado');
    expect(t.clpRegular).toBe(5999990);
    expect(t.usdRegular).toBe(6315);
    expect(t.trabajadoresMax).toBe(Infinity);
    expect(t.proyectosMax).toBe(Infinity);
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
  it('Comité Paritario, 18 workers, 1 project → no overage', () => {
    const r = calculateMonthlyCost('comite-paritario', 18, 1);
    expect(r.base).toBe(11990);
    expect(r.workerOverage).toBe(0);
    expect(r.projectOverage).toBe(0);
    expect(r.total).toBe(11990);
  });

  it('Comité Paritario, 30 workers, 3 projects → worker overage', () => {
    const r = calculateMonthlyCost('comite-paritario', 30, 3);
    expect(r.base).toBe(11990);
    expect(r.workerOverage).toBe(5 * 990);
    expect(r.projectOverage).toBe(0);
    expect(r.total).toBe(11990 + 5 * 990); // 16940
  });

  it('Comité Paritario, 24 workers, 4 projects → project overage', () => {
    const r = calculateMonthlyCost('comite-paritario', 24, 4);
    expect(r.base).toBe(11990);
    expect(r.workerOverage).toBe(0);
    expect(r.projectOverage).toBe(1 * 5990);
    expect(r.total).toBe(11990 + 5990); // 17980
  });

  it('Oro, 800 workers, 1 project → 300 worker overage at 190', () => {
    const r = calculateMonthlyCost('oro', 800, 1);
    expect(r.base).toBe(90990);
    expect(r.workerOverage).toBe(300 * 190);
    expect(r.projectOverage).toBe(0);
    expect(r.total).toBe(90990 + 300 * 190); // 147990
  });

  it('Titanio premium tier with overflow throws to force upgrade', () => {
    expect(() => calculateMonthlyCost('titanio', 1000, 100)).toThrow(/upgrade/i);
  });

  it('Titanio within limits returns base only', () => {
    const r = calculateMonthlyCost('titanio', 500, 50);
    expect(r.base).toBe(249990);
    expect(r.workerOverage).toBe(0);
    expect(r.projectOverage).toBe(0);
    expect(r.total).toBe(249990);
  });

  it('Gratis within limits returns 0', () => {
    const r = calculateMonthlyCost('gratis', 5, 1);
    expect(r.total).toBe(0);
  });

  it('Ilimitado always returns base', () => {
    const r = calculateMonthlyCost('ilimitado', 50000, 1000);
    expect(r.total).toBe(5999990);
  });
});

describe('suggestUpgrade', () => {
  it('Comité Paritario @ 60 workers suggests upgrade (overage > delta)', () => {
    // overage = 35 * 990 = 34650; delta to departamento = 30990 - 11990 = 19000
    expect(suggestUpgrade('comite-paritario', 60, 1)).toBe('departamento-prevencion');
  });

  it('Comité Paritario @ 26 workers does NOT suggest upgrade (overage < delta)', () => {
    // overage = 1 * 990 = 990; delta = 19000
    expect(suggestUpgrade('comite-paritario', 26, 1)).toBeNull();
  });

  it('within limits returns null', () => {
    expect(suggestUpgrade('comite-paritario', 20, 1)).toBeNull();
  });

  it('Oro at high workers suggests titanio upgrade', () => {
    // overage = 1500 * 190 = 285000; delta to titanio = 249990 - 90990 = 159000
    expect(suggestUpgrade('oro', 2000, 1)).toBe('titanio');
  });

  it('Premium tiers (Titanio+) return null because no overage', () => {
    expect(suggestUpgrade('titanio', 500, 50)).toBeNull();
  });
});
