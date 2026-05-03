// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { awardXp, evaluateMedallas } from './positiveXp';

describe('awardXp', () => {
  it('awards default amount for known reason', () => {
    const r = awardXp('reportar_nearmiss');
    expect(r.skipped).toBe(false);
    expect(r.amount).toBe(20);
  });

  it('awards explicit positive amount', () => {
    const r = awardXp('process_completed', 75);
    expect(r.amount).toBe(75);
  });

  it('skips on negative or zero amounts (no-op)', () => {
    const r = awardXp('task_done', -5);
    expect(r.skipped).toBe(true);
    expect(r.amount).toBe(0);

    const z = awardXp('task_done', 0);
    expect(z.skipped).toBe(true);
  });

  it('floors non-integer positive amounts', () => {
    const r = awardXp('days_no_incident', 5.7);
    expect(r.amount).toBe(5);
  });
});

describe('evaluateMedallas', () => {
  it('returns medallas eligible from stats', () => {
    const ids = evaluateMedallas({
      totalProcessesCompleted: 12,
      daysWithoutIncident: 50,
      alertsResponded: 5,
      wisdomCapsulesCompleted: 10,
      nearMissesReported: 0,
    });
    expect(ids).toContain('procesos-10');
    expect(ids).toContain('alertas-5');
    expect(ids).not.toContain('sin-accidentes-100');
    expect(ids).not.toContain('capsulas-30');
    expect(ids).not.toContain('nearmiss-10');
  });

  it('returns empty when no thresholds met', () => {
    const ids = evaluateMedallas({
      totalProcessesCompleted: 0,
      daysWithoutIncident: 0,
      alertsResponded: 0,
      wisdomCapsulesCompleted: 0,
      nearMissesReported: 0,
    });
    expect(ids).toEqual([]);
  });
});
