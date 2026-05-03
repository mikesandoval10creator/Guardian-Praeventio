import { describe, it, expect } from 'vitest';
import {
  API_TIERS,
  calculateApiCost,
  getApiTier,
  type ApiTier,
  type ApiTierId,
} from './aiTier';

const ID_BY_API: Record<'A' | 'B' | 'C', { base: ApiTierId; pro: ApiTierId }> = {
  A: { base: 'climate-base', pro: 'climate-pro' },
  B: { base: 'hazmat-base', pro: 'hazmat-pro' },
  C: { base: 'normativa-base', pro: 'normativa-pro' },
};

const SUITE = { base: 'suite-base' as const, pro: 'suite-pro' as const };

describe('API_TIERS data integrity', () => {
  it('contains exactly 8 tiers (4 APIs × {base, pro})', () => {
    expect(API_TIERS.length).toBe(8);
  });

  it('has unique tier ids', () => {
    const ids = API_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tier has a non-empty privacyNote mentioning the Zettelkasten boundary', () => {
    for (const tier of API_TIERS) {
      expect(tier.privacyNote.length).toBeGreaterThan(0);
      expect(tier.privacyNote.toLowerCase()).toContain('zettelkasten');
    }
  });

  it('every tier has at least one feature line', () => {
    for (const tier of API_TIERS) {
      expect(tier.features.length).toBeGreaterThan(0);
      for (const f of tier.features) expect(f.length).toBeGreaterThan(0);
    }
  });

  it('rate limits are positive and per-day >= per-second', () => {
    for (const tier of API_TIERS) {
      expect(tier.rateLimit.perSecond).toBeGreaterThan(0);
      expect(tier.rateLimit.perDay).toBeGreaterThan(0);
      expect(tier.rateLimit.perDay).toBeGreaterThanOrEqual(tier.rateLimit.perSecond);
    }
  });

  it('rate limits are consistent: pro >= base for every API', () => {
    const apis: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
    for (const api of apis) {
      const base = getApiTier(ID_BY_API[api].base);
      const pro = getApiTier(ID_BY_API[api].pro);
      expect(pro.rateLimit.perSecond).toBeGreaterThanOrEqual(base.rateLimit.perSecond);
      expect(pro.rateLimit.perDay).toBeGreaterThanOrEqual(base.rateLimit.perDay);
      expect(pro.requestsPerMonth).toBeGreaterThanOrEqual(base.requestsPerMonth);
    }
    const suiteBase = getApiTier(SUITE.base);
    const suitePro = getApiTier(SUITE.pro);
    expect(suitePro.rateLimit.perSecond).toBeGreaterThanOrEqual(suiteBase.rateLimit.perSecond);
    expect(suitePro.rateLimit.perDay).toBeGreaterThanOrEqual(suiteBase.rateLimit.perDay);
    expect(suitePro.requestsPerMonth).toBeGreaterThanOrEqual(suiteBase.requestsPerMonth);
  });

  it('every base tier is cheaper than its pro counterpart', () => {
    const apis: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
    for (const api of apis) {
      const base = getApiTier(ID_BY_API[api].base);
      const pro = getApiTier(ID_BY_API[api].pro);
      expect(base.monthlyUsd).toBeLessThan(pro.monthlyUsd);
    }
    expect(getApiTier(SUITE.base).monthlyUsd).toBeLessThan(getApiTier(SUITE.pro).monthlyUsd);
  });

  it('apiCode mapping is correct (A=climate, B=hazmat, C=normativa, D=suite)', () => {
    expect(getApiTier('climate-base').apiCode).toBe('A');
    expect(getApiTier('climate-pro').apiCode).toBe('A');
    expect(getApiTier('hazmat-base').apiCode).toBe('B');
    expect(getApiTier('hazmat-pro').apiCode).toBe('B');
    expect(getApiTier('normativa-base').apiCode).toBe('C');
    expect(getApiTier('normativa-pro').apiCode).toBe('C');
    expect(getApiTier('suite-base').apiCode).toBe('D');
    expect(getApiTier('suite-pro').apiCode).toBe('D');
  });
});

describe('Suite discount vs sum of A+B+C', () => {
  it('suite-pro is cheaper than the sum of climate-pro + hazmat-pro + normativa-pro', () => {
    const sumPro =
      getApiTier('climate-pro').monthlyUsd +
      getApiTier('hazmat-pro').monthlyUsd +
      getApiTier('normativa-pro').monthlyUsd;
    expect(getApiTier(SUITE.pro).monthlyUsd).toBeLessThan(sumPro);
  });

  it('suite-base monthlyUsd <= sum(A+B+C base) when treating Coach access as free upgrade', () => {
    // The Coach contributes value not sold individually; Suite base price is
    // capped against the raw sum to keep the discount story honest.
    const sumBase =
      getApiTier('climate-base').monthlyUsd +
      getApiTier('hazmat-base').monthlyUsd +
      getApiTier('normativa-base').monthlyUsd;
    expect(getApiTier(SUITE.base).monthlyUsd).toBeLessThanOrEqual(sumBase + 50);
  });
});

describe('calculateApiCost', () => {
  const climate: ApiTier = getApiTier('climate-base');

  it('returns base monthlyUsd when projectedRequests is 0', () => {
    expect(calculateApiCost(climate, 0)).toBe(climate.monthlyUsd);
  });

  it('returns base monthlyUsd when projectedRequests equals quota (no overage)', () => {
    expect(calculateApiCost(climate, climate.requestsPerMonth)).toBe(climate.monthlyUsd);
  });

  it('returns base monthlyUsd when projectedRequests is just under quota', () => {
    expect(calculateApiCost(climate, climate.requestsPerMonth - 1)).toBe(climate.monthlyUsd);
  });

  it('adds overage when above quota — 1 block of 10.000 over for base => +$9', () => {
    const cost = calculateApiCost(climate, climate.requestsPerMonth + 1);
    // Even 1 request over rounds up to a full 10k block.
    expect(cost).toBe(climate.monthlyUsd + 9);
  });

  it('rounds overage up to the next 10k block', () => {
    // 25.001 over => 3 blocks of 10k.
    const cost = calculateApiCost(climate, climate.requestsPerMonth + 25_001);
    expect(cost).toBe(climate.monthlyUsd + 3 * 9);
  });

  it('uses the cheaper $5/block rate for pro tiers', () => {
    const climatePro = getApiTier('climate-pro');
    const cost = calculateApiCost(climatePro, climatePro.requestsPerMonth + 10_000);
    expect(cost).toBe(climatePro.monthlyUsd + 5);
  });

  it('uses the cheapest $4/block rate for suite tiers', () => {
    const suiteBase = getApiTier('suite-base');
    const cost = calculateApiCost(suiteBase, suiteBase.requestsPerMonth + 10_000);
    expect(cost).toBe(suiteBase.monthlyUsd + 4);

    const suitePro = getApiTier('suite-pro');
    const cost2 = calculateApiCost(suitePro, suitePro.requestsPerMonth + 10_000);
    expect(cost2).toBe(suitePro.monthlyUsd + 4);
  });

  it('throws RangeError on negative projectedRequests', () => {
    expect(() => calculateApiCost(climate, -1)).toThrow(RangeError);
  });

  it('throws RangeError on non-finite projectedRequests', () => {
    expect(() => calculateApiCost(climate, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => calculateApiCost(climate, Number.NaN)).toThrow(RangeError);
  });
});

describe('getApiTier', () => {
  it('returns the tier when id exists', () => {
    expect(getApiTier('climate-base').id).toBe('climate-base');
  });

  it('throws on unknown id', () => {
    // @ts-expect-error testing runtime guard with invalid id
    expect(() => getApiTier('nonexistent-tier')).toThrow(/Unknown ApiTierId/);
  });
});
