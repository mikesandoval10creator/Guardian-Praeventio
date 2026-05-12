import { describe, it, expect } from 'vitest';
import {
  CRITICAL_CONTROLS_LIBRARY,
  getControlsForRisk,
  validatePreTask,
  type ControlValidation,
} from './criticalControlsLibrary.js';

const NOW = new Date('2026-05-11T12:00:00Z');

describe('CRITICAL_CONTROLS_LIBRARY', () => {
  it('cubre al menos 5 categorías de riesgo', () => {
    const cats = new Set(CRITICAL_CONTROLS_LIBRARY.map((c) => c.riskCategory));
    expect(cats.size).toBeGreaterThanOrEqual(5);
    expect(cats.has('altura')).toBe(true);
    expect(cats.has('electric')).toBe(true);
    expect(cats.has('confinado')).toBe(true);
    expect(cats.has('caliente')).toBe(true);
    expect(cats.has('quimico')).toBe(true);
  });

  it('cada control cita norma', () => {
    for (const c of CRITICAL_CONTROLS_LIBRARY) {
      expect(c.normReference.length).toBeGreaterThan(3);
    }
  });

  it('cada categoría incluye al menos 1 control != EPP (jerarquía)', () => {
    const cats = new Set(CRITICAL_CONTROLS_LIBRARY.map((c) => c.riskCategory));
    for (const cat of cats) {
      const controls = getControlsForRisk(cat);
      const nonEpp = controls.filter((c) => c.level !== 'epp');
      expect(nonEpp.length).toBeGreaterThan(0);
    }
  });
});

describe('getControlsForRisk', () => {
  it('altura tiene 5 controles', () => {
    expect(getControlsForRisk('altura')).toHaveLength(5);
  });

  it('categoría desconocida → []', () => {
    expect(getControlsForRisk('not_a_category')).toEqual([]);
  });
});

describe('validatePreTask', () => {
  function makeValidation(controlId: string, present: boolean): ControlValidation {
    return {
      controlId,
      present,
      validatedByUid: 'sup-1',
      validatedAt: NOW.toISOString(),
    };
  }

  it('TODOS los controles presentes → authorized + balanced', () => {
    const validations = getControlsForRisk('altura').map((c) =>
      makeValidation(c.id, true),
    );
    const r = validatePreTask('altura', validations, 'sup-1', NOW);
    expect(r.authorizedToStart).toBe(true);
    expect(r.isHierarchyBalanced).toBe(true);
    expect(r.coveragePercent).toBe(100);
    expect(r.missing).toHaveLength(0);
  });

  it('falta 1 control → NOT authorized', () => {
    const controls = getControlsForRisk('altura');
    const validations = controls.slice(0, -1).map((c) => makeValidation(c.id, true));
    const r = validatePreTask('altura', validations, 'sup-1', NOW);
    expect(r.authorizedToStart).toBe(false);
    expect(r.missing).toHaveLength(1);
  });

  it('solo EPP presente → NOT balanced (abuso EPP)', () => {
    const controls = getControlsForRisk('altura');
    const onlyEpp = controls.filter((c) => c.level === 'epp');
    const validations = controls.map((c) =>
      makeValidation(c.id, onlyEpp.some((e) => e.id === c.id)),
    );
    const r = validatePreTask('altura', validations, 'sup-1', NOW);
    // No balanced porque todos los presentes son level 'epp'
    expect(r.isHierarchyBalanced).toBe(false);
    expect(r.authorizedToStart).toBe(false);
  });

  it('mezcla engineering + epp → balanced', () => {
    const r = validatePreTask(
      'altura',
      [
        makeValidation('alt-eng-baranda', true), // engineering
        makeValidation('alt-epp-arnes', true), // epp
        makeValidation('alt-eng-linea', true),
        makeValidation('alt-adm-permit', true),
        makeValidation('alt-adm-supervisor', true),
      ],
      'sup',
      NOW,
    );
    expect(r.isHierarchyBalanced).toBe(true);
  });

  it('coveragePercent computa correctamente', () => {
    const controls = getControlsForRisk('altura'); // 5 controls
    const r = validatePreTask(
      'altura',
      [
        makeValidation(controls[0].id, true),
        makeValidation(controls[1].id, true),
      ],
      'sup',
      NOW,
    );
    expect(r.coveragePercent).toBe(40); // 2 / 5
  });
});
