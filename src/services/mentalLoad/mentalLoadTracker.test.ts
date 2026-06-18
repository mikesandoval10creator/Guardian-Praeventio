import { describe, it, expect } from 'vitest';
import {
  scoreMentalLoad,
  buildAdminBurdenReport,
  type MentalLoadSurvey,
  type AdminTaskTime,
} from './mentalLoadTracker.js';

function survey(over: Partial<MentalLoadSurvey> & { workerUid: string }): MentalLoadSurvey {
  return {
    workerUid: over.workerUid,
    mentalDemand: over.mentalDemand ?? 40,
    physicalDemand: over.physicalDemand ?? 40,
    temporalDemand: over.temporalDemand ?? 40,
    effort: over.effort ?? 40,
    frustration: over.frustration ?? 40,
    performance: over.performance ?? 40,
    surveyedAt: over.surveyedAt ?? '2026-05-11T10:00:00Z',
  };
}

describe('scoreMentalLoad', () => {
  it('promedio 40 → moderate', () => {
    const r = scoreMentalLoad(survey({ workerUid: 'w1' }));
    expect(r.level).toBe('moderate');
    expect(r.overallLoad).toBe(40);
  });

  it('promedio >75 → critical', () => {
    const r = scoreMentalLoad(
      survey({
        workerUid: 'w1',
        mentalDemand: 80,
        physicalDemand: 80,
        temporalDemand: 80,
        effort: 80,
        frustration: 80,
        performance: 80,
      }),
    );
    expect(r.level).toBe('critical');
    expect(r.recommendations.some((rec) => /1:1/i.test(rec))).toBe(true);
  });

  it('detecta dominantFactor', () => {
    const r = scoreMentalLoad(
      survey({
        workerUid: 'w1',
        frustration: 80, // dominante
        mentalDemand: 40,
      }),
    );
    expect(r.dominantFactor).toBe('frustration');
  });

  it('temporalDemand >70 → recomendar planificación', () => {
    const r = scoreMentalLoad(
      survey({
        workerUid: 'w1',
        temporalDemand: 80,
      }),
    );
    expect(r.recommendations.some((rec) => /tiempo|planificación/i.test(rec))).toBe(true);
  });

  it('warns on a HIGH NON-DOMINANT factor (frustration 85 while mentalDemand 90 is dominant)', () => {
    const r = scoreMentalLoad(
      survey({
        workerUid: 'w1',
        mentalDemand: 90, // dominant
        frustration: 85, // non-dominant but critically high
      }),
    );
    expect(r.dominantFactor).toBe('mentalDemand');
    // the frustration warning must still fire — not silently dropped for being non-dominant
    expect(r.recommendations.some((rec) => /frustración/i.test(rec))).toBe(true);
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
});

describe('buildAdminBurdenReport', () => {
  function task(over: Partial<AdminTaskTime> & { workerUid: string }): AdminTaskTime {
    return {
      workerUid: over.workerUid,
      kind: over.kind ?? 'form_filling',
      minutesPerWeek: over.minutesPerWeek ?? 60,
    };
  }

  it('<25% jornada → healthy', () => {
    const r = buildAdminBurdenReport(
      [task({ workerUid: 'w1', minutesPerWeek: 100 })],
      'w1',
    );
    expect(r.level).toBe('healthy');
  });

  it('>40% jornada → excessive', () => {
    const r = buildAdminBurdenReport(
      [
        task({ workerUid: 'w1', kind: 'form_filling', minutesPerWeek: 600 }),
        task({ workerUid: 'w1', kind: 'data_entry', minutesPerWeek: 700 }),
      ],
      'w1',
    );
    expect(r.level).toBe('excessive');
  });

  it('automationCandidates filtra > 30min saving y ordena', () => {
    const r = buildAdminBurdenReport(
      [
        task({ workerUid: 'w1', kind: 'data_entry', minutesPerWeek: 200 }), // 85% = 170 saving
        task({ workerUid: 'w1', kind: 'meeting', minutesPerWeek: 100 }), // 20% = 20 saving (filtered)
        task({ workerUid: 'w1', kind: 'form_filling', minutesPerWeek: 100 }), // 70% = 70 saving
      ],
      'w1',
    );
    expect(r.automationCandidates).toHaveLength(2);
    expect(r.automationCandidates[0].kind).toBe('data_entry'); // mayor saving
  });

  it('filtra por workerUid', () => {
    const r = buildAdminBurdenReport(
      [
        task({ workerUid: 'w1', minutesPerWeek: 60 }),
        task({ workerUid: 'w2', minutesPerWeek: 1000 }),
      ],
      'w1',
    );
    expect(r.totalAdminMinutesPerWeek).toBe(60);
  });
});
