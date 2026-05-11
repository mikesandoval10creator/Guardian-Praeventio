import { describe, it, expect } from 'vitest';
import {
  estimateTierCost,
  compareTiers,
  computeROI,
  suggestPurchaseOrders,
  type TierPlan,
} from './pricingCalculator.js';

const basic: TierPlan = {
  id: 'basic',
  monthlyPriceClp: 50_000,
  workerLimit: 20,
  projectLimit: 2,
  overagePerWorkerClp: 1_000,
  overagePerProjectClp: 5_000,
  features: [],
};

const pro: TierPlan = {
  id: 'pro',
  monthlyPriceClp: 150_000,
  workerLimit: 100,
  projectLimit: 10,
  overagePerWorkerClp: 800,
  overagePerProjectClp: 4_000,
  features: [],
};

describe('estimateTierCost', () => {
  it('uso dentro del plan → no overage', () => {
    const r = estimateTierCost(basic, { activeWorkers: 15, activeProjects: 1 });
    expect(r.fitsInPlan).toBe(true);
    expect(r.totalMonthlyClp).toBe(50_000);
  });

  it('overage workers se suma', () => {
    const r = estimateTierCost(basic, { activeWorkers: 25, activeProjects: 1 });
    expect(r.workersOver).toBe(5);
    expect(r.workerOverageClp).toBe(5_000);
    expect(r.totalMonthlyClp).toBe(55_000);
  });
});

describe('compareTiers', () => {
  it('recomienda el más barato que cubre', () => {
    const r = compareTiers([basic, pro], { activeWorkers: 50, activeProjects: 3 });
    expect(r.cheapestFitting?.tierId).toBe('pro');
  });

  it('si ningún tier cubre → recommend el más barato igual', () => {
    const r = compareTiers([basic], { activeWorkers: 200, activeProjects: 50 });
    expect(r.cheapestFitting).toBeUndefined();
    expect(r.recommended?.tierId).toBe('basic');
  });
});

describe('computeROI', () => {
  it('underwater si beneficios < costos', () => {
    const r = computeROI({
      costPerPreventedIncident: 1_000_000,
      preventedIncidents: 0,
      costPerAvoidedFine: 500_000,
      finesAvoided: 0,
      adminHoursSaved: 5,
      adminHourlyRateClp: 10_000,
      monthlyPlanClp: 150_000,
      additionalSafetyInvestmentClp: 0,
    });
    expect(r.level).toBe('underwater');
    expect(r.benefitsClp).toBeLessThan(r.costsClp);
  });

  it('excellent si ratio >= 3', () => {
    const r = computeROI({
      costPerPreventedIncident: 5_000_000,
      preventedIncidents: 2,
      costPerAvoidedFine: 1_000_000,
      finesAvoided: 1,
      adminHoursSaved: 100,
      adminHourlyRateClp: 10_000,
      monthlyPlanClp: 200_000,
      additionalSafetyInvestmentClp: 500_000,
    });
    expect(r.level).toBe('excellent');
  });

  it('payback Infinity si beneficios=0', () => {
    const r = computeROI({
      costPerPreventedIncident: 0,
      preventedIncidents: 0,
      costPerAvoidedFine: 0,
      finesAvoided: 0,
      adminHoursSaved: 0,
      adminHourlyRateClp: 0,
      monthlyPlanClp: 100_000,
      additionalSafetyInvestmentClp: 0,
    });
    expect(r.paybackMonths).toBe(Infinity);
  });
});

describe('suggestPurchaseOrders', () => {
  it('marca urgent si stock <= safety', () => {
    const r = suggestPurchaseOrders([
      {
        itemId: 'epp1',
        itemName: 'Casco',
        currentStock: 5,
        monthlyConsumption: 10,
        safetyStock: 5,
        leadTimeDays: 7,
        unitPriceClp: 5_000,
      },
    ]);
    expect(r[0].isUrgent).toBe(true);
    expect(r[0].suggestedOrderQty).toBe(20); // 2 meses × 10
  });

  it('marca urgent si daysUntilSafety <= leadTime', () => {
    const r = suggestPurchaseOrders([
      {
        itemId: 'epp1',
        itemName: 'Casco',
        currentStock: 10,
        monthlyConsumption: 30, // dailyConsumption = 1
        safetyStock: 5,
        leadTimeDays: 10, // 10d lead pero solo 5d hasta safety
        unitPriceClp: 5_000,
      },
    ]);
    expect(r[0].isUrgent).toBe(true);
  });

  it('ordena urgentes primero', () => {
    const r = suggestPurchaseOrders([
      {
        itemId: 'ok',
        itemName: 'Botas',
        currentStock: 50,
        monthlyConsumption: 5,
        safetyStock: 5,
        leadTimeDays: 5,
        unitPriceClp: 10_000,
      },
      {
        itemId: 'urgent',
        itemName: 'Guantes',
        currentStock: 0,
        monthlyConsumption: 30,
        safetyStock: 10,
        leadTimeDays: 7,
        unitPriceClp: 2_000,
      },
    ]);
    expect(r[0].itemId).toBe('urgent');
  });
});
