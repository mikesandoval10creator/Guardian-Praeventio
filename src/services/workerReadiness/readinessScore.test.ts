import { describe, it, expect } from 'vitest';
import {
  computeReadiness,
  type TaskRequirements,
  type WorkerProfile,
} from './readinessScore.js';

function profile(over: Partial<WorkerProfile> = {}): WorkerProfile {
  return {
    workerUid: 'w1',
    activeTrainings: ['altura_R1', 'arc_flash'],
    activeEpp: ['casco', 'arnes', 'guantes'],
    medicalAptitudeStatus: 'vigente',
    signedDocuments: ['ODI', 'DDR'],
    taskCategoryExperienceCount: 25,
    fatigueLevel: 'low',
    daysSinceLastIncident: 90,
    ...over,
  };
}

function task(over: Partial<TaskRequirements> = {}): TaskRequirements {
  return {
    requiredTrainings: ['altura_R1'],
    requiredEpp: ['casco', 'arnes'],
    taskCategory: 'altura',
    requiresMedicalAptitude: true,
    requiredAcknowledgements: ['ODI'],
    ...over,
  };
}

describe('computeReadiness', () => {
  it('trabajador perfecto → score ≥ 85, level ready, sin gaps', () => {
    const r = computeReadiness(profile({ taskCategoryExperienceCount: 100 }), task());
    expect(r.score).toBe(100);
    expect(r.level).toBe('ready');
    expect(r.gaps).toHaveLength(0);
  });

  it('falta 1 training → gap missing_training + score baja', () => {
    const r = computeReadiness(
      profile({ activeTrainings: [] }),
      task({ requiredTrainings: ['altura_R1', 'rescue'] }),
    );
    expect(r.gaps.some((g) => g.kind === 'missing_training')).toBe(true);
    expect(r.score).toBeLessThan(100);
  });

  it('aptitud médica expirada → gap medical_aptitude + sub-score muy bajo', () => {
    const r = computeReadiness(
      profile({ medicalAptitudeStatus: 'expirada' }),
      task(),
    );
    expect(r.gaps.some((g) => g.kind === 'medical_aptitude')).toBe(true);
    expect(r.subScores.medical).toBeLessThanOrEqual(5);
  });

  it('fatiga crítica → sub-score 0 fatigue + recomendación suspender turno', () => {
    const r = computeReadiness(
      profile({ fatigueLevel: 'critical' }),
      task(),
    );
    expect(r.subScores.fatigue).toBe(0);
    expect(r.recommendations.some((x) => /Suspender turno/.test(x))).toBe(true);
  });

  it('sin experiencia previa → gap experience', () => {
    const r = computeReadiness(
      profile({ taskCategoryExperienceCount: 0 }),
      task(),
    );
    expect(r.gaps.some((g) => g.kind === 'experience')).toBe(true);
    expect(r.recommendations.some((x) => /mentor/.test(x))).toBe(true);
  });

  it('nivel critical_gaps cuando score muy bajo', () => {
    const r = computeReadiness(
      profile({
        activeTrainings: [],
        activeEpp: [],
        medicalAptitudeStatus: 'sin_aptitud',
        signedDocuments: [],
        taskCategoryExperienceCount: 0,
        fatigueLevel: 'critical',
      }),
      task(),
    );
    expect(r.level).toBe('critical_gaps');
    expect(r.score).toBeLessThan(40);
  });

  it('recomendaciones priorizadas por weight desc', () => {
    const r = computeReadiness(
      profile({
        activeTrainings: [],
        medicalAptitudeStatus: 'sin_aptitud',
      }),
      task({ requiredTrainings: ['altura_R1', 'altura_R2'] }),
    );
    // El gap medical (weight 15) debe aparecer antes del training (weight ~12).
    expect(r.recommendations[0]).toMatch(/examen pre-ocupacional/);
  });

  it('cap N=5 recomendaciones', () => {
    const r = computeReadiness(
      profile({
        activeTrainings: [],
        activeEpp: [],
        medicalAptitudeStatus: 'sin_aptitud',
        signedDocuments: [],
        taskCategoryExperienceCount: 0,
        fatigueLevel: 'critical',
      }),
      task({
        requiredTrainings: ['t1', 't2', 't3'],
        requiredEpp: ['e1', 'e2', 'e3'],
        requiredAcknowledgements: ['d1', 'd2'],
      }),
    );
    expect(r.recommendations.length).toBeLessThanOrEqual(5);
  });

  it('task sin requisitos → sub-scores full', () => {
    const r = computeReadiness(
      profile(),
      {
        requiredTrainings: [],
        requiredEpp: [],
        taskCategory: 'simple',
        requiresMedicalAptitude: false,
        requiredAcknowledgements: [],
      },
    );
    expect(r.subScores.trainings).toBe(25);
    expect(r.subScores.epp).toBe(20);
    expect(r.subScores.documents).toBe(10);
  });

  it('experiencia escalonada (1/5/10/20/50)', () => {
    const taskReq = task();
    expect(computeReadiness(profile({ taskCategoryExperienceCount: 0 }), taskReq).subScores.experience).toBe(0);
    expect(computeReadiness(profile({ taskCategoryExperienceCount: 1 }), taskReq).subScores.experience).toBe(3);
    expect(computeReadiness(profile({ taskCategoryExperienceCount: 5 }), taskReq).subScores.experience).toBe(6);
    expect(computeReadiness(profile({ taskCategoryExperienceCount: 10 }), taskReq).subScores.experience).toBe(9);
    expect(computeReadiness(profile({ taskCategoryExperienceCount: 25 }), taskReq).subScores.experience).toBe(12);
    expect(computeReadiness(profile({ taskCategoryExperienceCount: 100 }), taskReq).subScores.experience).toBe(15);
  });

  // Codex PR #315 round-2 P2: incident-recency penalty.
  describe('incident_recency (Codex PR #315 round-2)', () => {
    it('días ≥ 60 → sin penalización, sin gap', () => {
      const r = computeReadiness(
        profile({ taskCategoryExperienceCount: 100, daysSinceLastIncident: 90 }),
        task(),
      );
      expect(r.score).toBe(100);
      expect(r.gaps.some((g) => g.kind === 'incident_recency')).toBe(false);
    });

    it('días en rango 30-59 → penalización -2 + gap leve', () => {
      const r = computeReadiness(
        profile({ taskCategoryExperienceCount: 100, daysSinceLastIncident: 45 }),
        task(),
      );
      expect(r.score).toBe(98);
      const g = r.gaps.find((x) => x.kind === 'incident_recency');
      expect(g).toBeDefined();
      expect(g?.weight).toBe(2);
    });

    it('días en rango 7-29 → penalización -5 + gap notable', () => {
      const r = computeReadiness(
        profile({ taskCategoryExperienceCount: 100, daysSinceLastIncident: 14 }),
        task(),
      );
      expect(r.score).toBe(95);
      const g = r.gaps.find((x) => x.kind === 'incident_recency');
      expect(g?.weight).toBe(5);
    });

    it('días 1-6 → penalización -10 + gap muy reciente', () => {
      const r = computeReadiness(
        profile({ taskCategoryExperienceCount: 100, daysSinceLastIncident: 3 }),
        task(),
      );
      expect(r.score).toBe(90);
      const g = r.gaps.find((x) => x.kind === 'incident_recency');
      expect(g?.weight).toBe(10);
      expect(g?.description).toMatch(/3 días/);
    });

    it('días 0 → penalización -15 + gap crítico hoy', () => {
      const r = computeReadiness(
        profile({ taskCategoryExperienceCount: 100, daysSinceLastIncident: 0 }),
        task(),
      );
      expect(r.score).toBe(85);
      const g = r.gaps.find((x) => x.kind === 'incident_recency');
      expect(g?.weight).toBe(15);
      expect(g?.description).toMatch(/hoy/i);
    });

    it('singular vs plural en descripción (1 día vs N días)', () => {
      const rSingular = computeReadiness(
        profile({ taskCategoryExperienceCount: 100, daysSinceLastIncident: 1 }),
        task(),
      );
      const gSingular = rSingular.gaps.find((g) => g.kind === 'incident_recency');
      expect(gSingular?.description).toMatch(/hace 1 día/);
      expect(gSingular?.description).not.toMatch(/días/);

      const rPlural = computeReadiness(
        profile({ taskCategoryExperienceCount: 100, daysSinceLastIncident: 5 }),
        task(),
      );
      const gPlural = rPlural.gaps.find((g) => g.kind === 'incident_recency');
      expect(gPlural?.description).toMatch(/hace 5 días/);
    });
  });
});
