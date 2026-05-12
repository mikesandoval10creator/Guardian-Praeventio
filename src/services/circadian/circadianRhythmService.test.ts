import { describe, it, expect } from 'vitest';
import {
  classifyCircadianWindow,
  assessAlertness,
  recommendShiftRotation,
} from './circadianRhythmService.js';

describe('classifyCircadianWindow', () => {
  it('2-6am → low_alert', () => {
    expect(classifyCircadianWindow(3)).toBe('low_alert');
    expect(classifyCircadianWindow(5)).toBe('low_alert');
  });

  it('9-12pm → peak', () => {
    expect(classifyCircadianWindow(10)).toBe('peak');
    expect(classifyCircadianWindow(11)).toBe('peak');
  });

  it('15-18h → optimal', () => {
    expect(classifyCircadianWindow(16)).toBe('optimal');
  });

  it('post-lunch dip 12-15h → declining', () => {
    expect(classifyCircadianWindow(13)).toBe('declining');
  });
});

describe('assessAlertness', () => {
  it('peak window + buen descanso → high alertness', () => {
    const r = assessAlertness({
      localHour: 10,
      sleepHoursLast24h: 8,
      consecutiveNightShifts: 0,
    });
    expect(r.level).toBe('high');
    expect(r.blockCriticalOps).toBe(false);
  });

  it('low_alert + sueño pobre → critical → block', () => {
    const r = assessAlertness({
      localHour: 4,
      sleepHoursLast24h: 3,
      consecutiveNightShifts: 6,
    });
    expect(r.level).toBe('critical');
    expect(r.blockCriticalOps).toBe(true);
  });

  it('sleep <6h → penalty visible', () => {
    const r1 = assessAlertness({
      localHour: 10,
      sleepHoursLast24h: 8,
      consecutiveNightShifts: 0,
    });
    const r2 = assessAlertness({
      localHour: 10,
      sleepHoursLast24h: 5,
      consecutiveNightShifts: 0,
    });
    expect(r2.alertnessScore).toBeLessThan(r1.alertnessScore);
  });

  it('mentalLoadRating alto → penalty', () => {
    const r = assessAlertness({
      localHour: 10,
      sleepHoursLast24h: 8,
      consecutiveNightShifts: 0,
      mentalLoadRating: 9,
    });
    expect(r.alertnessScore).toBeLessThan(90);
  });

  it('recommendations incluyen rotación si >=5 noches', () => {
    const r = assessAlertness({
      localHour: 10,
      sleepHoursLast24h: 8,
      consecutiveNightShifts: 6,
    });
    expect(r.recommendations.some((rec) => /rotación/i.test(rec))).toBe(true);
  });
});

describe('recommendShiftRotation', () => {
  it('7+ días en turno nocturno → needsRotation', () => {
    const r = recommendShiftRotation({
      workerUid: 'w1',
      currentShiftDays: 8,
      currentShiftKind: 'night',
      hoursWorkedWeek: 40,
    });
    expect(r.needsRotation).toBe(true);
  });

  it('horas semana > 45 → needsRotation', () => {
    const r = recommendShiftRotation({
      workerUid: 'w1',
      currentShiftDays: 3,
      currentShiftKind: 'day',
      hoursWorkedWeek: 50,
    });
    expect(r.needsRotation).toBe(true);
  });

  it('turno día normal → no rotación', () => {
    const r = recommendShiftRotation({
      workerUid: 'w1',
      currentShiftDays: 3,
      currentShiftKind: 'day',
      hoursWorkedWeek: 40,
    });
    expect(r.needsRotation).toBe(false);
  });
});
