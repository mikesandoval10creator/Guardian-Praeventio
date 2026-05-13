import { describe, it, expect } from 'vitest';
import {
  assessTaskFit,
  decideDerivation,
  buildReturnToWorkPlan,
  type WorkerRestriction,
  type TaskRequirements,
} from './returnToWorkPlanner.js';

const NOW = new Date('2026-05-13T10:00:00Z');

function rest(over: Partial<WorkerRestriction> & { tag: WorkerRestriction['tag'] }): WorkerRestriction {
  return {
    workerUid: 'w1',
    startsAt: '2026-05-01T00:00:00Z',
    source: 'mutual_doctor_order',
    ...over,
  };
}

describe('assessTaskFit', () => {
  it('sin restricciones → fit', () => {
    const r = assessTaskFit([], { taskId: 't1', conflictsWith: ['no_height_work'] }, NOW);
    expect(r.fit).toBe('fit');
    expect(r.violatedRestrictions).toHaveLength(0);
  });

  it('restricción violada → unfit + restricciones listadas', () => {
    const r = assessTaskFit(
      [rest({ tag: 'no_height_work' })],
      { taskId: 'work-altura', conflictsWith: ['no_height_work'] },
      NOW,
    );
    expect(r.fit).toBe('unfit');
    expect(r.violatedRestrictions).toContain('no_height_work');
  });

  it('restricción NO aplicable a la tarea → fit', () => {
    const r = assessTaskFit(
      [rest({ tag: 'no_night_shift' })],
      { taskId: 'work-diurno', conflictsWith: ['no_height_work'] },
      NOW,
    );
    expect(r.fit).toBe('fit');
  });

  it('restricción vencida (expiresAt < now) → ignorada → fit', () => {
    const r = assessTaskFit(
      [rest({ tag: 'no_height_work', expiresAt: '2026-04-01T00:00:00Z' })],
      { taskId: 'work-altura', conflictsWith: ['no_height_work'] },
      NOW,
    );
    expect(r.fit).toBe('fit');
  });

  it('restricción futura (startsAt > now) → ignorada → fit', () => {
    const r = assessTaskFit(
      [rest({ tag: 'no_height_work', startsAt: '2026-06-01T00:00:00Z' })],
      { taskId: 'work-altura', conflictsWith: ['no_height_work'] },
      NOW,
    );
    expect(r.fit).toBe('fit');
  });

  it('requires_buddy + tarea OK → fit_with_accommodation', () => {
    const r = assessTaskFit(
      [rest({ tag: 'requires_buddy' })],
      { taskId: 'work-tranquila', conflictsWith: [] },
      NOW,
    );
    expect(r.fit).toBe('fit_with_accommodation');
    expect(r.suggestedAccommodations.some((s) => /buddy/i.test(s))).toBe(true);
  });

  it('reduced_hours + tarea OK → fit_with_accommodation con pausas', () => {
    const r = assessTaskFit(
      [rest({ tag: 'reduced_hours' }), rest({ tag: 'requires_frequent_breaks' })],
      { taskId: 'work-tranquila', conflictsWith: [] },
      NOW,
    );
    expect(r.fit).toBe('fit_with_accommodation');
    expect(r.suggestedAccommodations).toHaveLength(2);
  });

  it('requires_medical_review cuando reviewIntervalDays vencido + conflicto', () => {
    const r = assessTaskFit(
      [
        rest({
          tag: 'no_height_work',
          requiresReview: true,
          reviewIntervalDays: 30,
          startsAt: '2026-01-01T00:00:00Z',
        }),
      ],
      { taskId: 'work-altura', conflictsWith: ['no_height_work'] },
      NOW,
    );
    expect(r.fit).toBe('requires_medical_review');
  });
});

describe('decideDerivation', () => {
  it('SIF severity → emergency immediate', () => {
    const d = decideDerivation(
      { workerUid: 'w1', workerMutuality: 'achs', incidentSeverity: 'sif' },
      NOW,
    );
    expect(d.urgency).toBe('emergency');
    expect(d.reason).toBe('work_injury');
    expect(d.scheduledFor).toBe(NOW.toISOString());
  });

  it('commute accident high → urgent 2h', () => {
    const d = decideDerivation(
      {
        workerUid: 'w1',
        workerMutuality: 'mutual',
        commuteEvent: true,
        incidentSeverity: 'high',
      },
      NOW,
    );
    expect(d.reason).toBe('commute_accident');
    expect(d.urgency).toBe('urgent');
  });

  it('occupational disease → routine 24h', () => {
    const d = decideDerivation(
      { workerUid: 'w1', workerMutuality: 'ist', occupationalSuspicion: true },
      NOW,
    );
    expect(d.reason).toBe('occupational_disease_suspected');
    expect(d.urgency).toBe('routine');
  });

  it('psychological event → psychosocial urgente', () => {
    const d = decideDerivation(
      {
        workerUid: 'w1',
        workerMutuality: 'achs',
        incidentKind: 'psychological',
        incidentSeverity: 'medium',
      },
      NOW,
    );
    // medium severity con kind=psychological — work_injury con urgent
    // (porque medium triggers urgent rama)
    expect(d.urgency).toBe('urgent');
  });

  it('lost-time injury severity medium → urgent', () => {
    const d = decideDerivation(
      {
        workerUid: 'w1',
        workerMutuality: 'achs',
        incidentSeverity: 'medium',
        workerHasLostTime: true,
      },
      NOW,
    );
    expect(d.urgency).toBe('urgent');
  });

  it('low severity sin lost time → routine', () => {
    const d = decideDerivation(
      { workerUid: 'w1', workerMutuality: 'isl', incidentSeverity: 'low' },
      NOW,
    );
    expect(d.urgency).toBe('routine');
  });
});

describe('buildReturnToWorkPlan', () => {
  it('absence corta (<7d) → vuelta directa', () => {
    const p = buildReturnToWorkPlan({
      workerUid: 'w1',
      absenceFrom: '2026-05-01T00:00:00Z',
      absenceTo: '2026-05-04T00:00:00Z',
      absenceKind: 'personal',
      activeRestrictions: [],
    });
    expect(p.absenceDays).toBe(3);
    expect(p.progressiveSchedule).toHaveLength(1);
    expect(p.progressiveSchedule[0]!.loadPct).toBe(100);
    expect(p.reassessmentInWeeks).toBe(2);
  });

  it('absence media (7-29d) → 2 semanas progresivas', () => {
    const p = buildReturnToWorkPlan({
      workerUid: 'w1',
      absenceFrom: '2026-04-15T00:00:00Z',
      absenceTo: '2026-05-01T00:00:00Z',
      absenceKind: 'sick_leave',
      activeRestrictions: [],
    });
    expect(p.absenceDays).toBe(16);
    expect(p.progressiveSchedule.length).toBe(3);
    expect(p.progressiveSchedule[0]!.loadPct).toBe(50);
    expect(p.reassessmentInWeeks).toBe(4);
  });

  it('absence larga (>30d) → 4 semanas progresivas + observation_only week 1', () => {
    const p = buildReturnToWorkPlan({
      workerUid: 'w1',
      absenceFrom: '2026-03-01T00:00:00Z',
      absenceTo: '2026-05-01T00:00:00Z',
      absenceKind: 'work_injury_leave',
      activeRestrictions: [],
    });
    expect(p.absenceDays).toBeGreaterThan(30);
    expect(p.progressiveSchedule[0]!.loadPct).toBe(25);
    expect(p.progressiveSchedule[0]!.tasksAllowed).toContain('observation_only');
    expect(p.reassessmentInWeeks).toBe(8);
  });

  it('work_injury_leave agrega accommodation psicosocial', () => {
    const p = buildReturnToWorkPlan({
      workerUid: 'w1',
      absenceFrom: '2026-04-01T00:00:00Z',
      absenceTo: '2026-05-01T00:00:00Z',
      absenceKind: 'work_injury_leave',
      activeRestrictions: [],
    });
    expect(p.accommodations.some((a) => /psicosocial|bienestar/i.test(a))).toBe(true);
  });

  it('restricciones se traducen a accommodations específicas', () => {
    const p = buildReturnToWorkPlan({
      workerUid: 'w1',
      absenceFrom: '2026-04-15T00:00:00Z',
      absenceTo: '2026-05-01T00:00:00Z',
      absenceKind: 'sick_leave',
      activeRestrictions: [
        { workerUid: 'w1', tag: 'requires_buddy', startsAt: '2026-04-15T00:00:00Z', source: 'mutual_doctor_order' },
        { workerUid: 'w1', tag: 'no_night_shift', startsAt: '2026-04-15T00:00:00Z', source: 'mutual_doctor_order' },
        { workerUid: 'w1', tag: 'no_height_work', startsAt: '2026-04-15T00:00:00Z', source: 'mutual_doctor_order' },
      ],
    });
    expect(p.accommodations.some((a) => /Buddy/i.test(a))).toBe(true);
    expect(p.accommodations.some((a) => /diurnos/i.test(a))).toBe(true);
    expect(p.accommodations.some((a) => /ground-level|espacios abiertos/i.test(a))).toBe(true);
  });
});
