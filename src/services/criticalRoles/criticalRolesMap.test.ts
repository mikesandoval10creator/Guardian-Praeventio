import { describe, it, expect } from 'vitest';
import {
  getRolesForIndustry,
  findRoleByCode,
  buildRoleCoverage,
  suggestTrainingPlan,
  type WorkerProfile,
  type CriticalRoleDefinition,
} from './criticalRolesMap.js';

function worker(over: Partial<WorkerProfile> & { uid: string }): WorkerProfile {
  return {
    uid: over.uid,
    fullName: over.fullName ?? `Worker ${over.uid}`,
    isActive: over.isActive ?? true,
    activeTrainings: over.activeTrainings ?? [],
    activeDocuments: over.activeDocuments ?? [],
    trainingsInProgress: over.trainingsInProgress ?? [],
  };
}

describe('getRolesForIndustry', () => {
  it('mining incluye grua_operator y blasting_specialist', () => {
    const roles = getRolesForIndustry('mining');
    expect(roles.some((r) => r.code === 'grua_operator')).toBe(true);
    expect(roles.some((r) => r.code === 'blasting_specialist')).toBe(true);
  });

  it('agriculture NO incluye blasting', () => {
    const roles = getRolesForIndustry('agriculture');
    expect(roles.some((r) => r.code === 'blasting_specialist')).toBe(false);
  });
});

describe('findRoleByCode', () => {
  it('encuentra rol existente', () => {
    expect(findRoleByCode('grua_operator')?.label).toContain('grúa');
  });

  it('undefined para código inexistente', () => {
    expect(findRoleByCode('xx')).toBeUndefined();
  });
});

describe('buildRoleCoverage', () => {
  const gruaRole = findRoleByCode('grua_operator')!;

  it('clasifica titular cuando tiene TODOS los trainings + docs', () => {
    const workers = [
      worker({
        uid: 'a',
        activeTrainings: ['grua_operator_curso', 'altura_R1'],
        activeDocuments: ['licencia_grua', 'examen_psicotecnico'],
      }),
    ];
    const c = buildRoleCoverage(gruaRole, workers);
    expect(c.titulars).toHaveLength(1);
    expect(c.substitutes).toHaveLength(0);
  });

  it('clasifica sustituto si trainings ok pero le falta doc', () => {
    const workers = [
      worker({
        uid: 'a',
        activeTrainings: ['grua_operator_curso', 'altura_R1'],
        activeDocuments: ['licencia_grua'], // falta psicotecnico
      }),
    ];
    const c = buildRoleCoverage(gruaRole, workers);
    expect(c.substitutes).toHaveLength(1);
  });

  it('clasifica en_capacitacion si hay training en curso', () => {
    const workers = [
      worker({
        uid: 'a',
        trainingsInProgress: ['grua_operator_curso'],
      }),
    ];
    const c = buildRoleCoverage(gruaRole, workers);
    expect(c.inTraining).toHaveLength(1);
  });

  it('isFragile=true si solo cumple el mínimo', () => {
    const workers = [
      worker({
        uid: 'a',
        activeTrainings: ['grua_operator_curso', 'altura_R1'],
        activeDocuments: ['licencia_grua', 'examen_psicotecnico'],
      }),
      worker({
        uid: 'b',
        activeTrainings: ['grua_operator_curso', 'altura_R1'],
        activeDocuments: ['licencia_grua', 'examen_psicotecnico'],
      }),
    ];
    const c = buildRoleCoverage(gruaRole, workers);
    expect(c.titulars).toHaveLength(2);
    expect(c.isFragile).toBe(true); // mínimo=2, justo en el límite
    expect(c.busFactor).toBe(0);
  });

  it('busFactor positivo si supera mínimo', () => {
    const titulars = Array.from({ length: 5 }, (_, i) =>
      worker({
        uid: `w${i}`,
        activeTrainings: ['grua_operator_curso', 'altura_R1'],
        activeDocuments: ['licencia_grua', 'examen_psicotecnico'],
      }),
    );
    const c = buildRoleCoverage(gruaRole, titulars);
    expect(c.busFactor).toBe(3);
    expect(c.isFragile).toBe(false);
  });
});

describe('suggestTrainingPlan', () => {
  const gruaRole = findRoleByCode('grua_operator')!;

  it('sin candidatos → mensaje urgente', () => {
    const c = buildRoleCoverage(gruaRole, []);
    const plan = suggestTrainingPlan(c, []);
    expect(plan.message).toMatch(/URGENTE/);
  });

  it('candidatos en capacitación → estima días', () => {
    const workers = [
      worker({ uid: 'a', trainingsInProgress: ['grua_operator_curso'] }),
      worker({ uid: 'b', trainingsInProgress: ['altura_R1'] }),
    ];
    const c = buildRoleCoverage(gruaRole, workers);
    const plan = suggestTrainingPlan(c, workers);
    expect(plan.recommendedCandidates.length).toBeGreaterThan(0);
    expect(plan.estimatedDaysToCoverage).toBeGreaterThan(0);
  });
});
