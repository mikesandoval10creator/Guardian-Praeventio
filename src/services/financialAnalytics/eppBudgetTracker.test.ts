import { describe, it, expect } from 'vitest';
import { trackEppBudget, type EppItem } from './eppBudgetTracker.js';

const helmet: EppItem = {
  id: 'h1',
  kind: 'helmet',
  unitCostClp: 12_000,
  expectedLifeMonths: 12,
};
const gloves: EppItem = {
  id: 'g1',
  kind: 'gloves',
  unitCostClp: 3_000,
  expectedLifeMonths: 3,
};

describe('trackEppBudget (§176)', () => {
  it('calcula expectedSpend para 10 trabajadores en 12 meses con helmet anual', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 10,
      eppRequiredByRole: { operario: [helmet] },
      workersByRole: { operario: 10 },
      actualSpentClp: 120_000,
    });
    // 10 × 12.000 × (12/12) = 120.000
    expect(report.expectedSpendClp).toBe(120_000);
    expect(report.varianceClp).toBe(0);
    expect(report.verdict).toBe('on_budget');
  });

  it('detecta over_budget al 10% sobre', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 10,
      eppRequiredByRole: { operario: [helmet] },
      workersByRole: { operario: 10 },
      actualSpentClp: 132_000,
    });
    expect(report.variancePct).toBeCloseTo(10, 0);
    expect(report.verdict).toBe('over_budget');
  });

  it('detecta critical_overspend >20%', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 10,
      eppRequiredByRole: { operario: [helmet] },
      workersByRole: { operario: 10 },
      actualSpentClp: 200_000,
    });
    expect(report.verdict).toBe('critical_overspend');
    expect(report.notes.some((n) => n.includes('crítico'))).toBe(true);
  });

  it('detecta under_budget <-5%', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 10,
      eppRequiredByRole: { operario: [helmet] },
      workersByRole: { operario: 10 },
      actualSpentClp: 100_000,
    });
    expect(report.verdict).toBe('under_budget');
    expect(report.varianceClp).toBeLessThan(0);
  });

  it('gloves con vida 3 meses → reemplazo 4× al año', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 5,
      eppRequiredByRole: { operario: [gloves] },
      workersByRole: { operario: 5 },
      actualSpentClp: 60_000,
    });
    // 5 × 3000 × (12/3) = 60.000
    expect(report.expectedSpendClp).toBe(60_000);
  });

  it('múltiples roles agregan por composición', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 10,
      eppRequiredByRole: {
        operario: [helmet, gloves],
        supervisor: [helmet],
      },
      workersByRole: { operario: 7, supervisor: 3 },
      actualSpentClp: 200_000,
    });
    // operario: 7 × (12.000 + 3.000 × 4) = 7 × 24.000 = 168.000
    // supervisor: 3 × 12.000 = 36.000
    // total 204.000
    expect(report.expectedSpendClp).toBe(204_000);
  });

  it('workersCount=0 da expectedSpendClp=0 con nota', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 0,
      eppRequiredByRole: { operario: [helmet] },
      actualSpentClp: 50_000,
    });
    expect(report.expectedSpendClp).toBe(0);
    expect(report.notes.some((n) => n.includes('workersCount'))).toBe(true);
  });

  it('detecta items con reemplazo vencido', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 5,
      eppRequiredByRole: { operario: [gloves] },
      workersByRole: { operario: 5 },
      itemCatalog: [gloves],
      itemsInUse: [
        { itemId: 'g1', issuedAt: '2025-01-01' }, // ~24 meses, vida 3
        { itemId: 'g1', issuedAt: '2026-11-01' }, // 2 meses, vigente
      ],
      actualSpentClp: 60_000,
    });
    expect(report.itemsOverdueReplacement).toBe(1);
    expect(report.notes.some((n) => n.includes('reemplazo vencido'))).toBe(
      true,
    );
  });

  it('período inválido (to<from) → expectedSpend 0', () => {
    const report = trackEppBudget({
      periodFrom: '2027-01-01',
      periodTo: '2026-01-01',
      workersCount: 5,
      eppRequiredByRole: { operario: [helmet] },
      workersByRole: { operario: 5 },
      actualSpentClp: 0,
    });
    expect(report.expectedSpendClp).toBe(0);
  });

  it('fallback sin workersByRole usa primer rol para todos', () => {
    const report = trackEppBudget({
      periodFrom: '2026-01-01',
      periodTo: '2027-01-01',
      workersCount: 8,
      eppRequiredByRole: { default: [helmet] },
      actualSpentClp: 96_000,
    });
    // 8 × 12.000 × 1 = 96.000
    expect(report.expectedSpendClp).toBe(96_000);
    expect(report.verdict).toBe('on_budget');
  });
});
