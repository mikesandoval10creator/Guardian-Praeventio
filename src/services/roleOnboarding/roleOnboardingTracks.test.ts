import { describe, it, expect } from 'vitest';
import {
  getTrackForRole,
  evaluateProgress,
  markStepCompleted,
  ROLE_ONBOARDING_ROLES,
  type UserOnboardingProgress,
  type UserRole,
} from './roleOnboardingTracks';

const FIXED_NOW = '2026-05-13T10:00:00.000Z';

function emptyProgress(role: UserRole, userUid = 'u1'): UserOnboardingProgress {
  return {
    userUid,
    role,
    completedStepIds: [],
    startedAt: '2026-05-13T08:00:00.000Z',
  };
}

describe('roleOnboardingTracks — catálogo', () => {
  it('expone los 7 roles esperados', () => {
    expect([...ROLE_ONBOARDING_ROLES].sort()).toEqual([
      'admin',
      'contractor',
      'cphs_member',
      'executive',
      'prevencionista',
      'supervisor',
      'worker',
    ]);
  });

  it('todos los roles tienen al menos 6 steps calibrados', () => {
    for (const role of ROLE_ONBOARDING_ROLES) {
      const track = getTrackForRole(role);
      expect(track.steps.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('todos los step IDs del catálogo son únicos por track', () => {
    for (const role of ROLE_ONBOARDING_ROLES) {
      const track = getTrackForRole(role);
      const ids = track.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('cada track tiene al menos un step blockingForOperation', () => {
    for (const role of ROLE_ONBOARDING_ROLES) {
      const track = getTrackForRole(role);
      const blocking = track.steps.filter((s) => s.blockingForOperation);
      expect(blocking.length).toBeGreaterThan(0);
    }
  });

  it('estimatedTotalMinutes es la suma exacta de los pasos', () => {
    for (const role of ROLE_ONBOARDING_ROLES) {
      const track = getTrackForRole(role);
      const sum = track.steps.reduce((a, s) => a + s.estimatedMinutes, 0);
      expect(track.estimatedTotalMinutes).toBe(sum);
    }
  });

  it('todos los kinds usados son del set permitido', () => {
    const allowed = new Set([
      'video',
      'doc_read',
      'quiz',
      'live_demo',
      'sandbox_task',
      'shadow_session',
    ]);
    for (const role of ROLE_ONBOARDING_ROLES) {
      const track = getTrackForRole(role);
      for (const s of track.steps) {
        expect(allowed.has(s.kind)).toBe(true);
      }
    }
  });

  it('getTrackForRole devuelve copia defensiva', () => {
    const t1 = getTrackForRole('worker');
    t1.steps[0].title = 'mutado';
    const t2 = getTrackForRole('worker');
    expect(t2.steps[0].title).not.toBe('mutado');
  });

  it('lanza error con rol desconocido', () => {
    expect(() => getTrackForRole('hacker' as UserRole)).toThrow();
  });

  it('worker incluye quiz, sos y first acceptance ack', () => {
    const track = getTrackForRole('worker');
    const ids = track.steps.map((s) => s.id);
    expect(ids).toContain('worker.quiz_safety');
    expect(ids).toContain('worker.sos_app');
    expect(ids).toContain('worker.first_acceptance_ack');
  });

  it('prevencionista incluye matriz 5x5 y bowtie', () => {
    const track = getTrackForRole('prevencionista');
    const ids = track.steps.map((s) => s.id);
    expect(ids).toContain('prev.matrix_5x5');
    expect(ids).toContain('prev.bowtie');
  });

  it('cphs_member incluye agenda, minuta, acciones correctivas y reporte mensual', () => {
    const track = getTrackForRole('cphs_member');
    const ids = track.steps.map((s) => s.id);
    expect(ids).toContain('cphs.agenda');
    expect(ids).toContain('cphs.minutes');
    expect(ids).toContain('cphs.corrective_actions');
    expect(ids).toContain('cphs.monthly_report');
  });
});

describe('roleOnboardingTracks — evaluateProgress', () => {
  it('progreso vacío: canOperate=false, completedPct=0, nextRecommended=primer blocking', () => {
    const track = getTrackForRole('worker');
    const status = evaluateProgress(emptyProgress('worker'), track);
    expect(status.completedSteps).toBe(0);
    expect(status.completedPct).toBe(0);
    expect(status.canOperate).toBe(false);
    expect(status.trackCompleted).toBe(false);
    expect(status.blockedSteps).toBeGreaterThan(0);
    expect(status.nextRecommendedStepId).toBe(track.steps[0].id);
    expect(status.remainingMinutes).toBe(track.estimatedTotalMinutes);
  });

  it('progreso parcial: cuenta solo IDs válidos del track', () => {
    const track = getTrackForRole('worker');
    const progress: UserOnboardingProgress = {
      ...emptyProgress('worker'),
      completedStepIds: ['worker.welcome', 'ghost.fake_step', 'worker.epp_basics'],
    };
    const status = evaluateProgress(progress, track);
    expect(status.completedSteps).toBe(2);
  });

  it('canOperate=true solo cuando todos los blocking están completos', () => {
    const track = getTrackForRole('supervisor');
    const blockingIds = track.steps.filter((s) => s.blockingForOperation).map((s) => s.id);
    const progress: UserOnboardingProgress = {
      ...emptyProgress('supervisor'),
      completedStepIds: blockingIds,
    };
    const status = evaluateProgress(progress, track);
    expect(status.canOperate).toBe(true);
    expect(status.blockedSteps).toBe(0);
  });

  it('completedPct se redondea correctamente', () => {
    const track = getTrackForRole('worker');
    // 3/6 = 50%
    const progress: UserOnboardingProgress = {
      ...emptyProgress('worker'),
      completedStepIds: track.steps.slice(0, 3).map((s) => s.id),
    };
    const status = evaluateProgress(progress, track);
    expect(status.completedPct).toBe(50);
  });

  it('nextRecommendedStepId prioriza blocking sobre no-blocking', () => {
    const track = getTrackForRole('prevencionista');
    // El step no-blocking es prev.review_roadmap; si lo dejamos al final pendiente
    // pero hay un blocking pendiente antes, debe recomendar el blocking.
    const completedIds = track.steps
      .filter((s) => s.id !== 'prev.bowtie' && s.id !== 'prev.review_roadmap')
      .map((s) => s.id);
    const progress: UserOnboardingProgress = {
      ...emptyProgress('prevencionista'),
      completedStepIds: completedIds,
    };
    const status = evaluateProgress(progress, track);
    expect(status.nextRecommendedStepId).toBe('prev.bowtie');
  });

  it('cuando todos los blocking están listos, recomienda no-blocking pendiente', () => {
    const track = getTrackForRole('prevencionista');
    const blockingIds = track.steps.filter((s) => s.blockingForOperation).map((s) => s.id);
    const progress: UserOnboardingProgress = {
      ...emptyProgress('prevencionista'),
      completedStepIds: blockingIds,
    };
    const status = evaluateProgress(progress, track);
    expect(status.canOperate).toBe(true);
    expect(status.nextRecommendedStepId).toBe('prev.review_roadmap');
  });

  it('100% completo: trackCompleted=true, nextRecommended=undefined, remaining=0', () => {
    const track = getTrackForRole('admin');
    const progress: UserOnboardingProgress = {
      ...emptyProgress('admin'),
      completedStepIds: track.steps.map((s) => s.id),
    };
    const status = evaluateProgress(progress, track);
    expect(status.completedPct).toBe(100);
    expect(status.trackCompleted).toBe(true);
    expect(status.nextRecommendedStepId).toBeUndefined();
    expect(status.remainingMinutes).toBe(0);
  });

  it('remainingMinutes excluye los steps completados', () => {
    const track = getTrackForRole('contractor');
    const firstStep = track.steps[0];
    const progress: UserOnboardingProgress = {
      ...emptyProgress('contractor'),
      completedStepIds: [firstStep.id],
    };
    const status = evaluateProgress(progress, track);
    expect(status.remainingMinutes).toBe(
      track.estimatedTotalMinutes - firstStep.estimatedMinutes,
    );
  });

  it('lanza error si rol del progress no coincide con el track', () => {
    const track = getTrackForRole('worker');
    const progress = emptyProgress('admin');
    expect(() => evaluateProgress(progress, track)).toThrow(/role mismatch/);
  });

  it('trackCompleted respeta el threshold (≥80%)', () => {
    const track = getTrackForRole('cphs_member');
    // 5/6 = 83% → completed
    const progress: UserOnboardingProgress = {
      ...emptyProgress('cphs_member'),
      completedStepIds: track.steps.slice(0, 5).map((s) => s.id),
    };
    const status = evaluateProgress(progress, track);
    expect(status.completedPct).toBe(83);
    expect(status.trackCompleted).toBe(true);
  });
});

describe('roleOnboardingTracks — markStepCompleted', () => {
  it('agrega step y no muta el progreso original', () => {
    const original = emptyProgress('worker');
    const next = markStepCompleted(original, 'worker.welcome', FIXED_NOW);
    expect(original.completedStepIds).toEqual([]);
    expect(next.completedStepIds).toEqual(['worker.welcome']);
  });

  it('es idempotente: marcar dos veces el mismo step no duplica', () => {
    const p1 = markStepCompleted(emptyProgress('worker'), 'worker.welcome', FIXED_NOW);
    const p2 = markStepCompleted(p1, 'worker.welcome', FIXED_NOW);
    expect(p2.completedStepIds.filter((id) => id === 'worker.welcome')).toHaveLength(1);
  });

  it('lanza error si el step no pertenece al track del rol', () => {
    const progress = emptyProgress('worker');
    expect(() => markStepCompleted(progress, 'admin.tenant_setup', FIXED_NOW)).toThrow();
  });

  it('setea completedAt cuando se completa el último step', () => {
    const track = getTrackForRole('worker');
    const ids = track.steps.map((s) => s.id);
    let p: UserOnboardingProgress = emptyProgress('worker');
    for (let i = 0; i < ids.length - 1; i++) {
      p = markStepCompleted(p, ids[i], FIXED_NOW);
    }
    expect(p.completedAt).toBeUndefined();
    p = markStepCompleted(p, ids[ids.length - 1], FIXED_NOW);
    expect(p.completedAt).toBe(FIXED_NOW);
  });

  it('no sobreescribe completedAt si ya estaba seteado', () => {
    const track = getTrackForRole('worker');
    const firstStep = track.steps[0];
    const restStepIds = track.steps.slice(1).map((s) => s.id);
    const p0: UserOnboardingProgress = {
      ...emptyProgress('worker'),
      completedStepIds: restStepIds,
      completedAt: '2026-01-01T00:00:00.000Z',
    };
    const p1 = markStepCompleted(p0, firstStep.id, FIXED_NOW);
    expect(p1.completedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('roleOnboardingTracks — integración multi-rol', () => {
  it('cada rol puede progresar a 100% sin colisiones de step IDs entre tracks', () => {
    for (const role of ROLE_ONBOARDING_ROLES) {
      const track = getTrackForRole(role);
      let p = emptyProgress(role);
      for (const step of track.steps) {
        p = markStepCompleted(p, step.id, FIXED_NOW);
      }
      const status = evaluateProgress(p, track);
      expect(status.completedPct).toBe(100);
      expect(status.canOperate).toBe(true);
      expect(status.trackCompleted).toBe(true);
    }
  });

  it('IDs de step son globalmente únicos a través de TODOS los tracks', () => {
    const all: string[] = [];
    for (const role of ROLE_ONBOARDING_ROLES) {
      all.push(...getTrackForRole(role).steps.map((s) => s.id));
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('trackIds son determinísticos y versionados', () => {
    expect(getTrackForRole('worker').trackId).toBe('track_v1_worker');
    expect(getTrackForRole('cphs_member').trackId).toBe('track_v1_cphs_member');
  });
});
