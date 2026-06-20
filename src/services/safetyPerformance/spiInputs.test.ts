import { describe, it, expect } from 'vitest';
import { foldLeadingIndicators } from './spiInputs.js';

const executed = {
  executedInspections: 6,
  executedDailyTalks: 18,
  executedTrainings: 3,
  nearMissReports: 5,
};

describe('foldLeadingIndicators', () => {
  it('computes executed ÷ planned ratios when a plan is captured', () => {
    const out = foldLeadingIndicators(executed, {
      plannedInspections: 8,
      plannedDailyTalks: 22,
      plannedTrainings: 4,
    });
    expect(out.leading.plannedInspectionsRate).toBeCloseTo(6 / 8);
    expect(out.leading.dailyTalksDeliveryRate).toBeCloseTo(18 / 22);
    expect(out.leading.trainingCurrencyRate).toBeCloseTo(3 / 4);
    expect(out.honesty.plannedInspectionsRate).toBe(false);
    expect(out.honesty.dailyTalksDeliveryRate).toBe(false);
    expect(out.honesty.trainingCurrencyRate).toBe(false);
  });

  it('marks ratio indicators honest-empty when NO plan was captured', () => {
    const out = foldLeadingIndicators(executed, null);
    expect(out.honesty.plannedInspectionsRate).toBe(true);
    expect(out.honesty.dailyTalksDeliveryRate).toBe(true);
    expect(out.honesty.trainingCurrencyRate).toBe(true);
    // honest-empty contributes a neutral 0, never a fabricated rate.
    expect(out.leading.plannedInspectionsRate).toBe(0);
    expect(out.leading.dailyTalksDeliveryRate).toBe(0);
    expect(out.leading.trainingCurrencyRate).toBe(0);
  });

  it('marks an indicator honest-empty when its planned denominator is 0', () => {
    const out = foldLeadingIndicators(executed, {
      plannedInspections: 0,
      plannedDailyTalks: 22,
      plannedTrainings: 4,
    });
    expect(out.honesty.plannedInspectionsRate).toBe(true);
    expect(out.honesty.dailyTalksDeliveryRate).toBe(false);
  });

  it('clamps over-delivery to 1 for the score but keeps RAW counts truthful', () => {
    const out = foldLeadingIndicators(
      { ...executed, executedDailyTalks: 30 },
      { plannedInspections: 8, plannedDailyTalks: 22, plannedTrainings: 4 },
    );
    expect(out.leading.dailyTalksDeliveryRate).toBe(1); // clamped for the engine
    expect(out.ratios.dailyTalks).toEqual({ executed: 30, planned: 22 }); // truthful
  });

  it('always flags preTaskChecklist + positiveObservations honest-empty (no real source)', () => {
    const out = foldLeadingIndicators(executed, {
      plannedInspections: 8,
      plannedDailyTalks: 22,
      plannedTrainings: 4,
    });
    expect(out.honesty.preTaskChecklistCompletion).toBe(true);
    expect(out.honesty.positiveObservationsRate).toBe(true);
    expect(out.leading.preTaskChecklistCompletion).toBe(0);
    expect(out.leading.positiveObservationsRate).toBe(0);
  });

  it('near-miss reporting is a real raw count (0 is valid, not honest-empty)', () => {
    const out = foldLeadingIndicators({ ...executed, nearMissReports: 0 }, null);
    expect(out.leading.nearMissReportingRate).toBe(0);
    expect(out.honesty.nearMissReportingRate).toBe(false);
  });

  it('ignores negative / non-numeric counts (honest, no garbage)', () => {
    const out = foldLeadingIndicators(
      {
        executedInspections: -3 as unknown as number,
        executedDailyTalks: NaN as unknown as number,
        executedTrainings: 2.6,
        nearMissReports: 4,
      },
      { plannedInspections: 5, plannedDailyTalks: 10, plannedTrainings: 4 },
    );
    expect(out.ratios.inspections.executed).toBe(0);
    expect(out.ratios.dailyTalks.executed).toBe(0);
    expect(out.ratios.trainings.executed).toBe(3); // rounded
  });
});
