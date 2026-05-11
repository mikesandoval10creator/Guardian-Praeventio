import { describe, it, expect } from 'vitest';
import {
  estimateNonComplianceCost,
  estimatePreventionROI,
  type NonComplianceInput,
  type PreventionROIInput,
} from './preventionCostCalculator.js';

describe('estimateNonComplianceCost', () => {
  it('document_missing sin historial → rango bajo', () => {
    const e = estimateNonComplianceCost({
      kind: 'document_missing',
      affectedWorkerCount: 5,
      estimatedStoppageDays: 0,
      dailyStoppageCostClp: 1_000_000,
      adminHoursToFix: 8,
      hasHistoryOfFines: false,
    });
    expect(e.historyMultiplier).toBe(1.0);
    expect(e.estimatedFineClpMin).toBeGreaterThan(0);
    expect(e.totalEstimatedClpMax).toBeGreaterThan(e.totalEstimatedClpMin);
  });

  it('hasHistoryOfFines aplica multiplier 1.8', () => {
    const sin = estimateNonComplianceCost({
      kind: 'safety_breach',
      affectedWorkerCount: 1,
      estimatedStoppageDays: 0,
      dailyStoppageCostClp: 0,
      adminHoursToFix: 0,
      hasHistoryOfFines: false,
    });
    const con = estimateNonComplianceCost({
      kind: 'safety_breach',
      affectedWorkerCount: 1,
      estimatedStoppageDays: 0,
      dailyStoppageCostClp: 0,
      adminHoursToFix: 0,
      hasHistoryOfFines: true,
    });
    expect(con.estimatedFineClpMin / sin.estimatedFineClpMin).toBeCloseTo(1.8, 1);
  });

  it('fatal_accident_risk genera nota especial sobre demanda civil', () => {
    const e = estimateNonComplianceCost({
      kind: 'fatal_accident_risk',
      affectedWorkerCount: 1,
      estimatedStoppageDays: 0,
      dailyStoppageCostClp: 0,
      adminHoursToFix: 0,
      hasHistoryOfFines: false,
    });
    expect(e.notes.some((n) => n.includes('demanda civil') || n.includes('SUSESO'))).toBe(true);
  });

  it('paralización 5+ días genera nota sobre mandante', () => {
    const e = estimateNonComplianceCost({
      kind: 'safety_breach',
      affectedWorkerCount: 10,
      estimatedStoppageDays: 7,
      dailyStoppageCostClp: 500_000,
      adminHoursToFix: 4,
      hasHistoryOfFines: false,
    });
    expect(e.notes.some((n) => n.includes('mandante'))).toBe(true);
    expect(e.stoppageCostClp).toBe(7 * 500_000);
  });

  it('affectedWorkerCount muy alto se trunca', () => {
    const a = estimateNonComplianceCost({
      kind: 'document_missing',
      affectedWorkerCount: 50,
      estimatedStoppageDays: 0,
      dailyStoppageCostClp: 0,
      adminHoursToFix: 0,
      hasHistoryOfFines: false,
    });
    const b = estimateNonComplianceCost({
      kind: 'document_missing',
      affectedWorkerCount: 500,
      estimatedStoppageDays: 0,
      dailyStoppageCostClp: 0,
      adminHoursToFix: 0,
      hasHistoryOfFines: false,
    });
    expect(a.estimatedFineClpMax).toBe(b.estimatedFineClpMax);
  });
});

describe('estimatePreventionROI', () => {
  it('suma todos los contributors', () => {
    const r = estimatePreventionROI({
      expirationsCaughtEarly: 5,
      adminHoursSaved: 40,
      documentsGeneratedInternally: 8,
      potentialStoppagesAvoided: 2,
      nearMissesNotEscalated: 3,
    });
    expect(r.totalSavingsClp).toBeGreaterThan(0);
    expect(r.adminHoursSavingsClp).toBe(40 * 15_000);
    expect(r.documentInsourceSavingsClp).toBe(8 * 80_000);
  });

  it('topContributors ordenado por monto desc', () => {
    const r = estimatePreventionROI({
      expirationsCaughtEarly: 0,
      adminHoursSaved: 5, // 75k
      documentsGeneratedInternally: 50, // 4M
      potentialStoppagesAvoided: 0,
      nearMissesNotEscalated: 0,
    });
    expect(r.topContributors[0].source).toContain('Documentos');
    expect(r.topContributors[0].percent).toBeGreaterThanOrEqual(90);
  });

  it('zeros → totalSavings 0 + topContributors vacío', () => {
    const r = estimatePreventionROI({
      expirationsCaughtEarly: 0,
      adminHoursSaved: 0,
      documentsGeneratedInternally: 0,
      potentialStoppagesAvoided: 0,
      nearMissesNotEscalated: 0,
    });
    expect(r.totalSavingsClp).toBe(0);
    expect(r.topContributors).toEqual([]);
  });
});
