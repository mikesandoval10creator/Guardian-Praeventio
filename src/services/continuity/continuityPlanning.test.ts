import { describe, it, expect } from 'vitest';
import {
  detectSPOFs,
  simulateOutage,
  buildPolyvalencePlan,
} from './continuityPlanning.js';

describe('detectSPOFs', () => {
  it('genera SPOFs para los 4 tipos', () => {
    const spofs = detectSPOFs({
      uniqueSkillHolders: [{ uid: 'w1', skill: 'soldadura submarina', dependentTasks: ['t1'] }],
      equipmentWithoutBackup: [{ id: 'e1', label: 'Grúa 200t', dependentTasks: ['t2', 't3'] }],
      soleSuppliers: [{ supplierId: 's1', service: 'calibración' }],
      unbackedCriticalDocs: [{ docId: 'd1', title: 'Permiso ambiental' }],
    });
    expect(spofs).toHaveLength(4);
    expect(spofs.map((s) => s.kind).sort()).toEqual(['document', 'equipment', 'person', 'supplier']);
  });

  it('person SPOFs incluyen impacto safety', () => {
    const spofs = detectSPOFs({
      uniqueSkillHolders: [{ uid: 'w1', skill: 'rescate alturas', dependentTasks: ['rescate'] }],
      equipmentWithoutBackup: [],
      soleSuppliers: [],
      unbackedCriticalDocs: [],
    });
    expect(spofs[0].impactScopes).toContain('safety');
  });
});

describe('simulateOutage', () => {
  it('recurso que NO es SPOF → impacto mínimo', () => {
    const r = simulateOutage({
      resourceId: 'nope',
      resourceKind: 'person',
      outageHours: 10,
      spofs: [],
    });
    expect(r.severity).toBe('minor');
    expect(r.affectedTaskCount).toBe(0);
  });

  it('safety scope + >8h → catastrophic', () => {
    const spofs = detectSPOFs({
      uniqueSkillHolders: [{ uid: 'w1', skill: 'rescate', dependentTasks: ['t1', 't2'] }],
      equipmentWithoutBackup: [],
      soleSuppliers: [],
      unbackedCriticalDocs: [],
    });
    const r = simulateOutage({
      resourceId: 'w1',
      resourceKind: 'person',
      outageHours: 12,
      spofs,
    });
    expect(r.severity).toBe('catastrophic');
    expect(r.mitigationSteps).toContain('Notificar gerencia + cliente mandante.');
  });

  it('safety scope + <=8h → major', () => {
    const spofs = detectSPOFs({
      uniqueSkillHolders: [{ uid: 'w1', skill: 'rescate', dependentTasks: ['t1'] }],
      equipmentWithoutBackup: [],
      soleSuppliers: [],
      unbackedCriticalDocs: [],
    });
    const r = simulateOutage({ resourceId: 'w1', resourceKind: 'person', outageHours: 4, spofs });
    expect(r.severity).toBe('major');
  });

  it('equipment outage moderate', () => {
    const spofs = detectSPOFs({
      uniqueSkillHolders: [],
      equipmentWithoutBackup: [{ id: 'e1', label: 'Grúa', dependentTasks: ['t1'] }],
      soleSuppliers: [],
      unbackedCriticalDocs: [],
    });
    const r = simulateOutage({ resourceId: 'e1', resourceKind: 'equipment', outageHours: 4, spofs });
    expect(r.severity).toBe('moderate');
  });
});

describe('buildPolyvalencePlan', () => {
  it('detecta skills bajo cobertura mínima', () => {
    const matrix = [
      { workerUid: 'a', skills: new Set(['altura', 'electric']) },
      { workerUid: 'b', skills: new Set(['altura']) },
      { workerUid: 'c', skills: new Set(['altura']) },
      { workerUid: 'd', skills: new Set(['altura']) },
    ];
    const plan = buildPolyvalencePlan(matrix, ['altura', 'electric', 'confinado'], 30);
    expect(plan.coverageBySkill.altura).toBe(100);
    expect(plan.coverageBySkill.electric).toBe(25);
    expect(plan.coverageBySkill.confinado).toBe(0);
    expect(plan.underCoveredSkills).toEqual(['electric', 'confinado']);
  });

  it('genera pares trainer/trainee para skills débiles', () => {
    const matrix = [
      { workerUid: 'a', skills: new Set(['electric']) },
      { workerUid: 'b', skills: new Set<string>() },
      { workerUid: 'c', skills: new Set<string>() },
    ];
    const plan = buildPolyvalencePlan(matrix, ['electric'], 50);
    expect(plan.trainingPairs.length).toBeGreaterThan(0);
    expect(plan.trainingPairs[0].trainer).toBe('a');
    expect(plan.trainingPairs[0].skill).toBe('electric');
  });
});
