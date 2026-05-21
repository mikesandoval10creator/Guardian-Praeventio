// Tests §12.6.5 — Body routine generator.

import { describe, it, expect } from 'vitest';
import {
  generateRoutineFromAssessment,
  getExerciseLibrary,
} from './bodyRoutineGenerator';

const baseInput = {
  workerUid: 'w-1',
  generatedAt: '2026-05-21T04:00:00.000Z',
  routineId: 'r-1',
};

describe('generateRoutineFromAssessment — REBA', () => {
  it('REBA score muy alto (11+) → todas las regiones', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 12,
    });
    expect(routine.targetRegions.length).toBeGreaterThanOrEqual(7);
    expect(routine.targetRegions).toContain('lower_back');
  });

  it('REBA score alto (8-10) → 5 regiones principales', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 9,
    });
    expect(routine.targetRegions).toContain('lower_back');
    expect(routine.targetRegions).toContain('hips');
  });

  it('REBA medio (4-7) → 3 regiones', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 5,
    });
    expect(routine.targetRegions).toContain('neck');
    expect(routine.targetRegions).toContain('lower_back');
  });

  it('REBA bajo (<4) → solo neck mantenimiento', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 2,
    });
    expect(routine.targetRegions).toEqual(['neck']);
    expect(routine.recommendedFrequency).toContain('preventivo');
  });
});

describe('generateRoutineFromAssessment — RULA', () => {
  it('RULA alto (7) → cuello/hombros/brazos/muñecas', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'RULA',
      score: 7,
    });
    expect(routine.targetRegions).toContain('wrists');
    expect(routine.targetRegions).toContain('upper_back');
  });

  it('RULA medio (5) → enfoca pantalla', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'RULA',
      score: 5,
    });
    expect(routine.targetRegions).toContain('wrists');
    expect(routine.recommendedFrequency).toContain('pausa');
  });

  it('RULA bajo (1) → solo wrists preventivo', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'RULA',
      score: 1,
    });
    expect(routine.targetRegions).toEqual(['wrists']);
  });
});

describe('generateRoutineFromAssessment — exercises', () => {
  it('exercises no vacío para score moderado', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 9,
    });
    expect(routine.exercises.length).toBeGreaterThan(0);
    expect(routine.exercises.length).toBeLessThanOrEqual(5);
  });

  it('exercises cubren las target regions', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 9,
    });
    const exerciseRegions = new Set(
      routine.exercises.flatMap((e) => e.regions),
    );
    const coveredCount = routine.targetRegions.filter((r) =>
      exerciseRegions.has(r),
    ).length;
    expect(coveredCount).toBeGreaterThan(0);
  });

  it('maxExercises limita correctamente', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 12,
      maxExercises: 3,
    });
    expect(routine.exercises.length).toBeLessThanOrEqual(3);
  });

  it('excludeContraindications filtra ejercicios', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 12,
      excludeContraindications: ['lumbalgia', 'rodilla'],
    });
    // Ningún ejercicio debe tener contraindication que matchee
    for (const ex of routine.exercises) {
      if (ex.contraindications) {
        for (const c of ex.contraindications) {
          expect(c.toLowerCase()).not.toContain('lumbalgia');
          expect(c.toLowerCase()).not.toContain('rodilla');
        }
      }
    }
  });
});

describe('generateRoutineFromAssessment — metadata', () => {
  it('preserva workerUid + triggeredByScore', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 6,
    });
    expect(routine.workerUid).toBe('w-1');
    expect(routine.triggeredByScore).toBe(6);
  });

  it('totalDurationMin coincide con suma', () => {
    const routine = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 6,
    });
    const expectedSec = routine.exercises.reduce((s, e) => s + e.durationSec, 0);
    expect(routine.totalDurationMin).toBe(Math.ceil(expectedSec / 60));
  });

  it('recommendedFrequency adecuado por severidad', () => {
    const high = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 12,
    });
    expect(high.recommendedFrequency).toContain('3× al día');
    expect(high.recommendedFrequency).toContain('evaluación médica');

    const low = generateRoutineFromAssessment({
      ...baseInput,
      assessmentType: 'REBA',
      score: 2,
    });
    expect(low.recommendedFrequency).toContain('preventivo');
  });
});

describe('getExerciseLibrary', () => {
  it('retorna copia con todos los ejercicios', () => {
    const lib = getExerciseLibrary();
    expect(lib.length).toBeGreaterThan(5);
    expect(lib[0]).toHaveProperty('id');
    expect(lib[0]).toHaveProperty('regions');
  });

  it('cada ejercicio tiene instructions', () => {
    const lib = getExerciseLibrary();
    for (const ex of lib) {
      expect(ex.instructions.length).toBeGreaterThan(0);
    }
  });

  it('retorna copia (no muta la fuente)', () => {
    const lib1 = getExerciseLibrary();
    lib1.pop();
    const lib2 = getExerciseLibrary();
    expect(lib2.length).toBeGreaterThan(lib1.length);
  });
});

describe('determinismo', () => {
  it('mismas entradas → misma rutina', () => {
    const input = {
      ...baseInput,
      assessmentType: 'REBA' as const,
      score: 8,
    };
    const a = generateRoutineFromAssessment(input);
    const b = generateRoutineFromAssessment(input);
    expect(a).toEqual(b);
  });
});
