import { describe, it, expect } from 'vitest';
import {
  getRequirementsForProject,
  getCriticalRequirements,
  type ProjectProfile,
} from './legalRuleEngine.js';

describe('legalRuleEngine', () => {
  it('proyecto pequeño (5 trabajadores) sin riesgos especiales → 0 reglas', () => {
    const reqs = getRequirementsForProject({ workersCount: 5 });
    expect(reqs).toHaveLength(0);
  });

  it('≥25 trabajadores → CPHS obligatorio (DS 54)', () => {
    const reqs = getRequirementsForProject({ workersCount: 25 });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].ruleId).toBe('cphs_25_workers');
    expect(reqs[0].category).toBe('committee');
    expect(reqs[0].legalCitation).toContain('DS 54');
    expect(reqs[0].urgency).toBe('critical');
  });

  it('≥100 trabajadores → CPHS + Depto Prevención', () => {
    const reqs = getRequirementsForProject({ workersCount: 150 });
    const ruleIds = reqs.map((r) => r.ruleId);
    expect(ruleIds).toContain('cphs_25_workers');
    expect(ruleIds).toContain('prevention_dept_100_workers');
  });

  it('sílice presente → protocolo MINSAL vigilancia médica', () => {
    const reqs = getRequirementsForProject({
      workersCount: 10,
      presentRisks: ['silice ambiental respirable'],
    });
    expect(reqs.map((r) => r.ruleId)).toContain('silice_minsal_protocol');
    const silice = reqs.find((r) => r.ruleId === 'silice_minsal_protocol')!;
    expect(silice.legalCitation).toContain('MINSAL');
    expect(silice.legalCitation).toContain('DS 594');
  });

  it('minería (GP-MIN) → DS 132 + DS 594', () => {
    const reqs = getRequirementsForProject({
      workersCount: 50,
      industry: 'GP-MIN-MET',
    });
    const mining = reqs.find((r) => r.ruleId === 'mining_ds132');
    expect(mining).toBeDefined();
    expect(mining?.legalCitation).toContain('DS 132');
  });

  it('construcción con subcontratistas → DS 76 + Ley 20.123', () => {
    const reqs = getRequirementsForProject({
      workersCount: 30,
      industry: 'GP-CONS-NRES',
      hasSubcontractors: true,
    });
    const constr = reqs.find((r) => r.ruleId === 'construction_ds76');
    expect(constr).toBeDefined();
    expect(constr?.recommendation).toContain('Ley 20.123');
  });

  it('construcción SIN subcontratistas → DS 76 sin la cláusula 20.123', () => {
    const reqs = getRequirementsForProject({
      workersCount: 30,
      industry: 'GP-CONS-RES',
      hasSubcontractors: false,
    });
    const constr = reqs.find((r) => r.ruleId === 'construction_ds76');
    expect(constr).toBeDefined();
    expect(constr?.recommendation).not.toContain('Ley 20.123');
  });

  it('trabajo en altura → DS 594 art. 53 capacitación', () => {
    const reqs = getRequirementsForProject({
      workersCount: 10,
      presentRisks: ['trabajo en altura sobre 1.8m'],
    });
    expect(reqs.map((r) => r.ruleId)).toContain('altura_ds594');
  });

  it('eléctricos via industry → SEC licencia + LOTO', () => {
    const reqs = getRequirementsForProject({
      workersCount: 5,
      industry: 'GP-ELEC',
    });
    const elec = reqs.find((r) => r.ruleId === 'electric_ds132_sec');
    expect(elec).toBeDefined();
    expect(elec?.legalCitation).toContain('SEC');
  });

  it('eléctricos via risk → mismo rule_id', () => {
    const reqs = getRequirementsForProject({
      workersCount: 5,
      presentRisks: ['LOTO mantenimiento eléctrico'],
    });
    expect(reqs.map((r) => r.ruleId)).toContain('electric_ds132_sec');
  });

  it('hazmat → DS 78 + HDS + plan derrames', () => {
    const reqs = getRequirementsForProject({
      workersCount: 8,
      hasHazmat: true,
    });
    expect(reqs.map((r) => r.ruleId)).toContain('hazmat_ds78');
  });

  it('trabajo nocturno → DS 594 art. 102-104 medical', () => {
    const reqs = getRequirementsForProject({
      workersCount: 15,
      hasNightShift: true,
    });
    expect(reqs.map((r) => r.ruleId)).toContain('night_shift_ds594');
  });

  it('trabajos pesados → Ley 19.404 (recommended, no critical)', () => {
    const reqs = getRequirementsForProject({
      workersCount: 20,
      hasHeavyWork: true,
    });
    const heavy = reqs.find((r) => r.ruleId === 'heavy_work_ley19404');
    expect(heavy).toBeDefined();
    expect(heavy?.urgency).toBe('recommended');
  });

  it('getCriticalRequirements filtra solo críticas', () => {
    const reqs = getCriticalRequirements({
      workersCount: 30,
      hasHeavyWork: true,
    });
    expect(reqs.map((r) => r.ruleId)).toContain('cphs_25_workers');
    expect(reqs.map((r) => r.ruleId)).not.toContain('heavy_work_ley19404'); // recommended
    expect(reqs.every((r) => r.urgency === 'critical')).toBe(true);
  });

  it('proyecto faena minera completa (combo) — 200 trabajadores + sílice + altura + hazmat + nocturno + heavy', () => {
    const reqs = getRequirementsForProject({
      workersCount: 200,
      industry: 'GP-MIN-MET',
      presentRisks: ['silice', 'altura', 'hazmat químico'],
      hasHazmat: true,
      hasSubcontractors: true,
      hasNightShift: true,
      hasHeavyWork: true,
    });
    const ruleIds = reqs.map((r) => r.ruleId);
    // Espera CPHS + Depto Prev + sílice + minería + altura + hazmat + nocturno + heavy
    expect(ruleIds).toContain('cphs_25_workers');
    expect(ruleIds).toContain('prevention_dept_100_workers');
    expect(ruleIds).toContain('silice_minsal_protocol');
    expect(ruleIds).toContain('mining_ds132');
    expect(ruleIds).toContain('altura_ds594');
    expect(ruleIds).toContain('hazmat_ds78');
    expect(ruleIds).toContain('night_shift_ds594');
    expect(ruleIds).toContain('heavy_work_ley19404');
    expect(reqs.length).toBeGreaterThanOrEqual(8);
  });
});
