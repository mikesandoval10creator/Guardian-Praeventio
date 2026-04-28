import { describe, it, expect } from 'vitest';
import { evaluateCapacity, type TierData } from './tierEvaluation';

/**
 * Local tier fixture matching IMP1 (src/services/pricing/tiers.ts).
 * Values mirror PRICING.md / tiers.test.ts so this suite stays stable
 * even before tiers.ts ships. evaluateCapacity accepts injected tierData,
 * so this fixture is the single source of truth for these tests.
 */
const TIER_FIXTURE: TierData[] = [
  {
    id: 'gratis',
    clpRegular: 0,
    trabajadoresMax: 10,
    proyectosMax: 1,
    workerOverageClp: 0,
    projectOverageClp: 0,
    isPremium: false,
  },
  {
    id: 'comite-paritario',
    clpRegular: 11990,
    trabajadoresMax: 25,
    proyectosMax: 3,
    workerOverageClp: 990,
    projectOverageClp: 5990,
    isPremium: false,
  },
  {
    id: 'departamento-prevencion',
    clpRegular: 30990,
    trabajadoresMax: 100,
    proyectosMax: 10,
    workerOverageClp: 690,
    projectOverageClp: 4990,
    isPremium: false,
  },
  {
    id: 'plata',
    clpRegular: 50990,
    trabajadoresMax: 200,
    proyectosMax: 20,
    workerOverageClp: 390,
    projectOverageClp: 3990,
    isPremium: false,
  },
  {
    id: 'oro',
    clpRegular: 90990,
    trabajadoresMax: 500,
    proyectosMax: 50,
    workerOverageClp: 190,
    projectOverageClp: 1990,
    isPremium: false,
  },
  {
    id: 'titanio',
    clpRegular: 249990,
    trabajadoresMax: 750,
    proyectosMax: 75,
    workerOverageClp: 0, // premium → no overage
    projectOverageClp: 0,
    isPremium: true,
  },
  {
    id: 'diamante',
    clpRegular: 499990,
    trabajadoresMax: 2000,
    proyectosMax: 200,
    workerOverageClp: 0,
    projectOverageClp: 0,
    isPremium: true,
  },
  {
    id: 'empresarial',
    clpRegular: 1499990,
    trabajadoresMax: 5000,
    proyectosMax: 500,
    workerOverageClp: 0,
    projectOverageClp: 0,
    isPremium: true,
  },
  {
    id: 'corporativo',
    clpRegular: 2999990,
    trabajadoresMax: 15000,
    proyectosMax: 1500,
    workerOverageClp: 0,
    projectOverageClp: 0,
    isPremium: true,
  },
  {
    id: 'ilimitado',
    clpRegular: 5999990,
    trabajadoresMax: Infinity,
    proyectosMax: Infinity,
    workerOverageClp: 0,
    projectOverageClp: 0,
    isPremium: true,
  },
];

describe('evaluateCapacity', () => {
  it('1. Gratis 5w/1p → within limits', () => {
    const r = evaluateCapacity(
      'gratis',
      {
        totalWorkers: 5,
        totalProjects: 1,
        perProjectWorkers: [{ id: 'p1', workerCount: 5 }],
      },
      TIER_FIXTURE,
    );
    expect(r.withinLimits).toBe(true);
    expect(r.workerOverflow).toBe(0);
    expect(r.projectOverflow).toBe(0);
    expect(r.monthlyOverageClp).toBe(0);
    expect(r.totalMonthlyClp).toBe(0);
    expect(r.reason).toBe('within');
    expect(r.suggestedTierId).toBeNull();
    expect(r.upgradeSavingsClp).toBe(0);
  });

  it('2. Gratis 11w → workers-over with hard-block upgrade suggestion', () => {
    const r = evaluateCapacity(
      'gratis',
      {
        totalWorkers: 11,
        totalProjects: 1,
        perProjectWorkers: [{ id: 'p1', workerCount: 11 }],
      },
      TIER_FIXTURE,
    );
    expect(r.workerOverflow).toBe(1);
    expect(r.reason).toBe('workers-over');
    // Gratis has no overage rate, so total should still be the base (0).
    expect(r.monthlyOverageClp).toBe(0);
    // Hard-block: aggressively suggest the next tier.
    expect(r.suggestedTierId).toBe('comite-paritario');
  });

  it('3. Comité Paritario 18w/1p → within', () => {
    const r = evaluateCapacity(
      'comite-paritario',
      {
        totalWorkers: 18,
        totalProjects: 1,
        perProjectWorkers: [{ id: 'p1', workerCount: 18 }],
      },
      TIER_FIXTURE,
    );
    expect(r.withinLimits).toBe(true);
    expect(r.reason).toBe('within');
    expect(r.totalMonthlyClp).toBe(11990);
  });

  it('4. Comité Paritario 30w/3p → worker overage, no upgrade', () => {
    const r = evaluateCapacity(
      'comite-paritario',
      {
        totalWorkers: 30,
        totalProjects: 3,
        perProjectWorkers: [
          { id: 'p1', workerCount: 10 },
          { id: 'p2', workerCount: 10 },
          { id: 'p3', workerCount: 10 },
        ],
      },
      TIER_FIXTURE,
    );
    expect(r.workerOverflow).toBe(5);
    expect(r.projectOverflow).toBe(0);
    expect(r.monthlyOverageClp).toBe(5 * 990); // 4950
    expect(r.totalMonthlyClp).toBe(11990 + 4950); // 16940
    expect(r.reason).toBe('workers-over');
    // delta to depto-prev = 30990 - 11990 = 19000; overage 4950 < 19000 → no upgrade
    expect(r.suggestedTierId).toBeNull();
    expect(r.upgradeSavingsClp).toBe(0);
  });

  it('5. Comité Paritario 60w/3p → suggest upgrade to depto-prev', () => {
    const r = evaluateCapacity(
      'comite-paritario',
      {
        totalWorkers: 60,
        totalProjects: 3,
        perProjectWorkers: [
          { id: 'p1', workerCount: 20 },
          { id: 'p2', workerCount: 20 },
          { id: 'p3', workerCount: 20 },
        ],
      },
      TIER_FIXTURE,
    );
    expect(r.workerOverflow).toBe(35);
    expect(r.monthlyOverageClp).toBe(35 * 990); // 34650
    expect(r.totalMonthlyClp).toBe(11990 + 34650); // 46640
    expect(r.reason).toBe('workers-over');
    expect(r.suggestedTierId).toBe('departamento-prevencion');
    expect(r.upgradeSavingsClp).toBe(46640 - 30990); // 15650
  });

  it('6. Comité Paritario 24w/4p → project overage, no upgrade', () => {
    const r = evaluateCapacity(
      'comite-paritario',
      {
        totalWorkers: 24,
        totalProjects: 4,
        perProjectWorkers: [
          { id: 'p1', workerCount: 6 },
          { id: 'p2', workerCount: 6 },
          { id: 'p3', workerCount: 6 },
          { id: 'p4', workerCount: 6 },
        ],
      },
      TIER_FIXTURE,
    );
    expect(r.workerOverflow).toBe(0);
    expect(r.projectOverflow).toBe(1);
    expect(r.monthlyOverageClp).toBe(5990);
    expect(r.totalMonthlyClp).toBe(17980);
    expect(r.reason).toBe('projects-over');
    expect(r.suggestedTierId).toBeNull();
  });

  it('7. Oro 800w/1p → worker overage, no upgrade to titanio', () => {
    const r = evaluateCapacity(
      'oro',
      {
        totalWorkers: 800,
        totalProjects: 1,
        perProjectWorkers: [{ id: 'p1', workerCount: 800 }],
      },
      TIER_FIXTURE,
    );
    expect(r.workerOverflow).toBe(300);
    expect(r.monthlyOverageClp).toBe(300 * 190); // 57000
    expect(r.totalMonthlyClp).toBe(90990 + 57000); // 147990
    expect(r.reason).toBe('workers-over');
    // delta = 249990 - 90990 = 159000; overage 57000 < 159000 → no upgrade
    expect(r.suggestedTierId).toBeNull();
  });

  it('8. Titanio 800w/80p → premium-blocked, mandatory upgrade', () => {
    const r = evaluateCapacity(
      'titanio',
      {
        totalWorkers: 800,
        totalProjects: 80,
        perProjectWorkers: Array.from({ length: 80 }, (_, i) => ({
          id: `p${i}`,
          workerCount: 10,
        })),
      },
      TIER_FIXTURE,
    );
    expect(r.workerOverflow).toBe(50);
    expect(r.projectOverflow).toBe(5);
    expect(r.monthlyOverageClp).toBe(0); // premium → no overage rate
    expect(r.reason).toBe('premium-blocked');
    expect(r.suggestedTierId).toBe('diamante');
  });

  it('9. Ilimitado is always within limits', () => {
    const r = evaluateCapacity(
      'ilimitado',
      {
        totalWorkers: 50_000,
        totalProjects: 1000,
        perProjectWorkers: [{ id: 'p1', workerCount: 50_000 }],
      },
      TIER_FIXTURE,
    );
    expect(r.withinLimits).toBe(true);
    expect(r.reason).toBe('within');
    expect(r.workerOverflow).toBe(0);
    expect(r.projectOverflow).toBe(0);
    expect(r.suggestedTierId).toBeNull();
  });
});
