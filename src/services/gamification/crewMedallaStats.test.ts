import { describe, it, expect } from 'vitest';
import { aggregateCrewMedallaStats } from './crewMedallaStats';
import { evaluateMedallas } from './positiveXp';

describe('aggregateCrewMedallaStats — real project-level crew stats', () => {
  it('returns all-zero (no fabrication) when there are no crews/processes', () => {
    const stats = aggregateCrewMedallaStats([], []);
    expect(stats).toEqual({
      totalProcessesCompleted: 0,
      daysWithoutIncident: 0,
      alertsResponded: 0,
      wisdomCapsulesCompleted: 0,
      nearMissesReported: 0,
    });
    // With zero stats, NO medalla unlocks (the old permanent-locked behavior is
    // honest when there genuinely is no achievement yet).
    expect(evaluateMedallas(stats)).toEqual([]);
  });

  it('sums processes completed across crews and takes the best incident-free streak', () => {
    const stats = aggregateCrewMedallaStats(
      [
        { totalProcessesCompleted: 7, daysWithoutIncident: 40 },
        { totalProcessesCompleted: 5, daysWithoutIncident: 120 },
      ],
      [{ alertsResponded: 3 }, { alertsResponded: 4 }],
    );
    expect(stats.totalProcessesCompleted).toBe(12); // 7 + 5
    expect(stats.daysWithoutIncident).toBe(120); // max(40,120)
    expect(stats.alertsResponded).toBe(7); // 3 + 4
    expect(stats.wisdomCapsulesCompleted).toBe(0);
    expect(stats.nearMissesReported).toBe(0);
  });

  it('unlocks the data-backed medallas (procesos-10, dias-100, alertas-5) for real', () => {
    const stats = aggregateCrewMedallaStats(
      [{ totalProcessesCompleted: 10, daysWithoutIncident: 100 }],
      [{ alertsResponded: 5 }],
    );
    const unlocked = evaluateMedallas(stats); // returns medalla id strings
    expect(unlocked).toContain('procesos-10');
    expect(unlocked).toContain('sin-accidentes-100');
    expect(unlocked).toContain('alertas-5');
    // The untracked-stat medallas must NOT be unlocked (no fabricated count).
    expect(unlocked).not.toContain('capsulas-30');
    expect(unlocked).not.toContain('nearmiss-10');
  });

  it('tolerates missing/garbage numeric fields (treats them as 0)', () => {
    const stats = aggregateCrewMedallaStats(
      [{ totalProcessesCompleted: undefined }, { daysWithoutIncident: Number.NaN } as never],
      [{}, { alertsResponded: undefined }],
    );
    expect(stats.totalProcessesCompleted).toBe(0);
    expect(stats.daysWithoutIncident).toBe(0);
    expect(stats.alertsResponded).toBe(0);
  });
});
