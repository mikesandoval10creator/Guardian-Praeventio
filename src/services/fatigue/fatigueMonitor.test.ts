import { describe, it, expect } from 'vitest';
import { assessFatigue, type WorkSession } from './fatigueMonitor.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function session(over: Partial<WorkSession> = {}): WorkSession {
  return {
    workerUid: 'w1',
    startedAt: '2026-05-11T08:00:00Z',
    endedAt: '2026-05-11T11:00:00Z',
    isNight: false,
    hadCriticalTasks: false,
    ...over,
  };
}

describe('assessFatigue', () => {
  it('worker sin sesiones → low risk', () => {
    const r = assessFatigue('w1', [], NOW);
    expect(r.risk).toBe('low');
    expect(r.totalHoursLast24h).toBe(0);
  });

  it('3h en última jornada con descanso suficiente → low risk', () => {
    // Sesión termina 12h+ antes de NOW para que rest sea ≥ 11h
    const r = assessFatigue(
      'w1',
      [
        session({
          startedAt: '2026-05-10T20:00:00Z',
          endedAt: '2026-05-10T23:00:00Z',
        }),
      ],
      NOW,
    );
    expect(r.risk).toBe('low');
    expect(r.totalHoursLast24h).toBe(3);
  });

  it('14h en 24h → critical (excede 12h DS 594)', () => {
    const r = assessFatigue('w1', [
      session({
        startedAt: '2026-05-10T22:00:00Z',
        endedAt: '2026-05-11T12:00:00Z',
      }),
    ], NOW);
    expect(r.risk).toBe('critical');
    expect(r.recommendations.some((rec) => rec.includes('12h'))).toBe(true);
  });

  it('11h en 24h → high (cerca del límite)', () => {
    const r = assessFatigue('w1', [
      session({
        startedAt: '2026-05-11T00:00:00Z',
        endedAt: '2026-05-11T11:00:00Z',
      }),
    ], NOW);
    expect(r.risk).toBe('high');
  });

  it('6 turnos nocturnos en 7d → high', () => {
    const sessions: WorkSession[] = [];
    for (let i = 0; i < 6; i++) {
      const startDate = new Date(NOW.getTime() - i * 86_400_000);
      sessions.push(
        session({
          startedAt: startDate.toISOString(),
          endedAt: new Date(startDate.getTime() + 3 * 3_600_000).toISOString(),
          isNight: true,
        }),
      );
    }
    const r = assessFatigue('w1', sessions, NOW);
    expect(r.nightShiftsLast7d).toBe(6);
    expect(r.risk === 'high' || r.risk === 'critical').toBe(true);
  });

  it('descanso < 11h entre turnos → moderate', () => {
    const r = assessFatigue(
      'w1',
      [
        session({
          startedAt: '2026-05-11T00:00:00Z',
          endedAt: '2026-05-11T06:00:00Z',
        }),
        session({
          startedAt: '2026-05-11T10:00:00Z',
          endedAt: '2026-05-11T11:30:00Z',
        }),
      ],
      NOW,
    );
    expect(r.consecutiveShifts).toBeGreaterThanOrEqual(2);
    expect(r.recommendations.some((rec) => rec.includes('11h'))).toBe(true);
  });

  it('shouldRestrictCritical=true para high/critical', () => {
    const r = assessFatigue('w1', [
      session({
        startedAt: '2026-05-10T22:00:00Z',
        endedAt: '2026-05-11T11:00:00Z',
      }),
    ], NOW);
    expect(r.shouldRestrictCritical).toBe(true);
  });

  it('shouldRestrictCritical=false para low', () => {
    const r = assessFatigue('w1', [session()], NOW);
    expect(r.shouldRestrictCritical).toBe(false);
  });
});
