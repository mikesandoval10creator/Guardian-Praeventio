import { describe, it, expect } from 'vitest';
import {
  computeMaturityLevel,
  recommendNextSteps,
  LEVEL_NAMES,
  type MaturitySignals,
} from './preventionMaturityIndex.js';

function zeroSignals(): MaturitySignals {
  return {
    trainingCoverage: 0,
    ipersCompleted: 0,
    cphsMeetingFrequency: 0,
    leadingIndicatorsUsed: [],
    rootCauseAnalysisRate: 0,
    behaviorBasedSafety: 0,
    executiveEngagement: 0,
    workerEmpowerment: 0,
    integrationWithOperations: 0,
    continuousImprovement: 0,
  };
}

function maxSignals(): MaturitySignals {
  return {
    trainingCoverage: 1,
    ipersCompleted: 1,
    cphsMeetingFrequency: 1,
    leadingIndicatorsUsed: ['obs', 'near_miss', 'walks', 'audits', 'training_hours', 'ppe_compliance'],
    rootCauseAnalysisRate: 1,
    behaviorBasedSafety: 1,
    executiveEngagement: 1,
    workerEmpowerment: 1,
    integrationWithOperations: 1,
    continuousImprovement: 1,
  };
}

describe('computeMaturityLevel', () => {
  it('todos los signals en cero → level 1 reactivo', () => {
    const r = computeMaturityLevel(zeroSignals());
    expect(r.level).toBe(1);
    expect(r.levelName).toBe('reactivo');
    expect(r.overallScore).toBe(0);
  });

  it('todos los signals al máximo → level 5 autónomo', () => {
    const r = computeMaturityLevel(maxSignals());
    expect(r.level).toBe(5);
    expect(r.levelName).toBe('autónomo');
    expect(r.overallScore).toBeGreaterThanOrEqual(0.88);
  });

  it('overallScore es 0..1', () => {
    const r1 = computeMaturityLevel(zeroSignals());
    const r2 = computeMaturityLevel(maxSignals());
    expect(r1.overallScore).toBeGreaterThanOrEqual(0);
    expect(r1.overallScore).toBeLessThanOrEqual(1);
    expect(r2.overallScore).toBeGreaterThanOrEqual(0);
    expect(r2.overallScore).toBeLessThanOrEqual(1);
  });

  it('signals "mínimo legal" caen en level 2 cumplimiento', () => {
    // Cumplimiento: cumple lo básico en todas las categorías pero sin
    // gestión avanzada (medición, BBS, liderazgo) bien desarrollada.
    const s: MaturitySignals = {
      trainingCoverage: 0.7,
      ipersCompleted: 0.7,
      cphsMeetingFrequency: 0.7,
      leadingIndicatorsUsed: ['obs'],
      rootCauseAnalysisRate: 0.3,
      behaviorBasedSafety: 0.1,
      executiveEngagement: 0.1,
      workerEmpowerment: 0.2,
      integrationWithOperations: 0.2,
      continuousImprovement: 0.2,
    };
    const r = computeMaturityLevel(s);
    expect(r.level).toBe(2);
    expect(r.levelName).toBe('cumplimiento');
  });

  it('señales medianas en todas las categorías → level 3 proactivo', () => {
    const s: MaturitySignals = {
      trainingCoverage: 0.6,
      ipersCompleted: 0.6,
      cphsMeetingFrequency: 0.6,
      leadingIndicatorsUsed: ['obs', 'near_miss', 'walks'],
      rootCauseAnalysisRate: 0.6,
      behaviorBasedSafety: 0.5,
      executiveEngagement: 0.5,
      workerEmpowerment: 0.5,
      integrationWithOperations: 0.5,
      continuousImprovement: 0.5,
    };
    const r = computeMaturityLevel(s);
    expect(r.level).toBe(3);
    expect(r.levelName).toBe('proactivo');
  });

  it('señales altas integradas al negocio → level 4 sistémico', () => {
    const s: MaturitySignals = {
      trainingCoverage: 0.85,
      ipersCompleted: 0.85,
      cphsMeetingFrequency: 0.85,
      leadingIndicatorsUsed: ['a', 'b', 'c', 'd', 'e'],
      rootCauseAnalysisRate: 0.8,
      behaviorBasedSafety: 0.75,
      executiveEngagement: 0.75,
      workerEmpowerment: 0.7,
      integrationWithOperations: 0.7,
      continuousImprovement: 0.7,
    };
    const r = computeMaturityLevel(s);
    expect(r.level).toBe(4);
    expect(r.levelName).toBe('sistémico');
  });

  it('weakestArea es foundation cuando training/IPER/CPHS están bajos', () => {
    const s = maxSignals();
    s.trainingCoverage = 0.1;
    s.ipersCompleted = 0.1;
    s.cphsMeetingFrequency = 0.1;
    const r = computeMaturityLevel(s);
    expect(r.weakestArea).toBe('foundation');
  });

  it('weakestArea es leadership cuando executive engagement está bajo', () => {
    const s = maxSignals();
    s.executiveEngagement = 0;
    const r = computeMaturityLevel(s);
    expect(r.weakestArea).toBe('leadership');
  });

  it('weakestArea es behavior cuando BBS y empowerment están bajos', () => {
    const s = maxSignals();
    s.behaviorBasedSafety = 0;
    s.workerEmpowerment = 0;
    const r = computeMaturityLevel(s);
    expect(r.weakestArea).toBe('behavior');
  });

  it('weakestArea es measurement cuando faltan leading indicators y RCA', () => {
    const s = maxSignals();
    s.leadingIndicatorsUsed = [];
    s.rootCauseAnalysisRate = 0;
    const r = computeMaturityLevel(s);
    expect(r.weakestArea).toBe('measurement');
  });

  it('weakestArea es integration cuando ops/mejora continua están bajos', () => {
    const s = maxSignals();
    s.integrationWithOperations = 0;
    s.continuousImprovement = 0;
    const r = computeMaturityLevel(s);
    expect(r.weakestArea).toBe('integration');
  });

  it('nextLevelGap apunta al siguiente nivel y pointsNeeded >= 0', () => {
    const r = computeMaturityLevel(zeroSignals());
    expect(r.nextLevelGap.targetLevel).toBe(2);
    expect(r.nextLevelGap.pointsNeeded).toBeGreaterThan(0);
  });

  it('nextLevelGap.targetLevel es null cuando ya está en level 5', () => {
    const r = computeMaturityLevel(maxSignals());
    expect(r.nextLevelGap.targetLevel).toBeNull();
    expect(r.nextLevelGap.pointsNeeded).toBe(0);
  });

  it('categoryScores tiene las 5 categorías y están en 0..1', () => {
    const r = computeMaturityLevel(maxSignals());
    const keys = Object.keys(r.categoryScores).sort();
    expect(keys).toEqual([
      'behavior',
      'foundation',
      'integration',
      'leadership',
      'measurement',
    ]);
    for (const v of Object.values(r.categoryScores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('LEVEL_NAMES cubre 1..5 con nombres canónicos', () => {
    expect(LEVEL_NAMES[1]).toBe('reactivo');
    expect(LEVEL_NAMES[2]).toBe('cumplimiento');
    expect(LEVEL_NAMES[3]).toBe('proactivo');
    expect(LEVEL_NAMES[4]).toBe('sistémico');
    expect(LEVEL_NAMES[5]).toBe('autónomo');
  });

  it('signals NaN/negativos no rompen y son tratados como 0', () => {
    const s: MaturitySignals = {
      trainingCoverage: Number.NaN,
      ipersCompleted: -1,
      cphsMeetingFrequency: 2, // será clamped a 1
      leadingIndicatorsUsed: [],
      rootCauseAnalysisRate: 0,
      behaviorBasedSafety: 0,
      executiveEngagement: 0,
      workerEmpowerment: 0,
      integrationWithOperations: 0,
      continuousImprovement: 0,
    };
    const r = computeMaturityLevel(s);
    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(1);
    expect(r.level).toBeGreaterThanOrEqual(1);
  });
});

describe('recommendNextSteps', () => {
  it('devuelve exactamente 3 acciones', () => {
    const r = computeMaturityLevel(zeroSignals());
    const recs = recommendNextSteps(r);
    expect(recs).toHaveLength(3);
  });

  it('cada acción tiene texto accionable y métrica objetivo', () => {
    const r = computeMaturityLevel(zeroSignals());
    const recs = recommendNextSteps(r);
    for (const rec of recs) {
      expect(rec.action.length).toBeGreaterThan(10);
      expect(rec.targetMetric).toBeTruthy();
      expect(rec.expectedImpact).toBeGreaterThan(0);
    }
  });

  it('prioriza la categoría más débil en la primera recomendación', () => {
    const s = maxSignals();
    s.executiveEngagement = 0;
    const r = computeMaturityLevel(s);
    const recs = recommendNextSteps(r);
    expect(recs[0].category).toBe('leadership');
  });

  it('aun en level 5 sigue devolviendo 3 acciones (mejora continua)', () => {
    const r = computeMaturityLevel(maxSignals());
    const recs = recommendNextSteps(r);
    expect(recs.length).toBe(3);
  });
});
