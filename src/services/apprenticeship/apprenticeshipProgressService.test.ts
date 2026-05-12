import { describe, it, expect } from 'vitest';
import {
  canExecuteTask,
  proposeLevelUp,
  assessRepetitiveExposure,
  buildReintegrationPlan,
  type ApprenticeProfile,
  type TaskExecutionLog,
} from './apprenticeshipProgressService.js';

function profile(over: Partial<ApprenticeProfile> = {}): ApprenticeProfile {
  return {
    workerUid: 'app1',
    mentorUid: 'mentor1',
    startedAt: '2026-03-01T00:00:00Z',
    taskAuthorizations: over.taskAuthorizations ?? { 't1': 'observer' },
    ...over,
  };
}

describe('canExecuteTask', () => {
  it('observer no puede ejecutar', () => {
    const d = canExecuteTask(profile(), 't1', true);
    expect(d.allowed).toBe(false);
  });

  it('supervised puede solo con mentor', () => {
    const d = canExecuteTask(
      profile({ taskAuthorizations: { t1: 'supervised' } }),
      't1',
      true,
    );
    expect(d.allowed).toBe(true);
    expect(d.requiresMentor).toBe(true);
  });

  it('supervised sin mentor → bloqueado', () => {
    const d = canExecuteTask(
      profile({ taskAuthorizations: { t1: 'supervised' } }),
      't1',
      false,
    );
    expect(d.allowed).toBe(false);
  });

  it('autonomous siempre puede', () => {
    const d = canExecuteTask(
      profile({ taskAuthorizations: { t1: 'autonomous' } }),
      't1',
      false,
    );
    expect(d.allowed).toBe(true);
    expect(d.requiresMentor).toBe(false);
  });
});

describe('proposeLevelUp', () => {
  function log(taskId: string, withMentor: boolean): TaskExecutionLog {
    return { workerUid: 'app1', taskId, executedAt: '2026-05-11', withMentor };
  }

  it('observer → supervised tras 5 ejecuciones', () => {
    const p = proposeLevelUp(
      profile(),
      't1',
      Array(5).fill(null).map(() => log('t1', false)),
    );
    expect(p?.toLevel).toBe('supervised');
    expect(p?.ready).toBe(true);
  });

  it('observer con <5 ejecuciones → ready=false', () => {
    const p = proposeLevelUp(
      profile(),
      't1',
      Array(3).fill(null).map(() => log('t1', false)),
    );
    expect(p?.ready).toBe(false);
  });

  it('supervised → autonomous tras 10 con mentor', () => {
    const p = proposeLevelUp(
      profile({ taskAuthorizations: { t1: 'supervised' } }),
      't1',
      Array(10).fill(null).map(() => log('t1', true)),
    );
    expect(p?.toLevel).toBe('autonomous');
    expect(p?.ready).toBe(true);
  });

  it('autonomous → null (ya en tope)', () => {
    const p = proposeLevelUp(
      profile({ taskAuthorizations: { t1: 'autonomous' } }),
      't1',
      [],
    );
    expect(p).toBeNull();
  });
});

describe('assessRepetitiveExposure', () => {
  it('overexposed si una tarea pasa umbral 1200min', () => {
    const r = assessRepetitiveExposure({
      workerUid: 'w1',
      taskMinutesLastWeek: { t1: 1300, t2: 400 },
    });
    expect(r.overexposedTasks).toHaveLength(1);
    expect(r.shouldRotate).toBe(true);
  });

  it('topTaskShare >70% → flag rotación', () => {
    const r = assessRepetitiveExposure({
      workerUid: 'w1',
      taskMinutesLastWeek: { t1: 800, t2: 100 },
    });
    expect(r.topTaskShare).toBeGreaterThan(70);
    expect(r.shouldRotate).toBe(true);
  });

  it('distribución equilibrada → no rotación', () => {
    const r = assessRepetitiveExposure({
      workerUid: 'w1',
      taskMinutesLastWeek: { t1: 400, t2: 400, t3: 400 },
    });
    expect(r.shouldRotate).toBe(false);
  });
});

describe('buildReintegrationPlan', () => {
  it('separa tareas aptas de restringidas', () => {
    const plan = buildReintegrationPlan(
      {
        id: 'r1',
        workerUid: 'w1',
        referredAt: '2026-05-01',
        reason: 'reintegration_assessment',
        mutualidadId: 'm1',
        permanentRestrictions: ['altura', 'carga > 25kg'],
      },
      ['t-administrativa', 't-bodega', 't-altura'],
      {
        't-administrativa': ['oficina'],
        't-bodega': ['carga 30kg'],
        't-altura': ['altura'],
      },
    );
    expect(plan.allowedTasks).toContain('t-administrativa');
    expect(plan.restrictedTasks).toContain('t-altura');
    expect(plan.scheduleAdjustment).toBe(true);
  });
});
