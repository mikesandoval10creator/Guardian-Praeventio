import { describe, it, expect } from 'vitest';
import {
  PRE_USE_CHECKLISTS_BY_TYPE,
  getChecklistForType,
  runPreUseValidation,
  deriveEquipmentStatusAfterPreUse,
  EquipmentValidationError,
  type Equipment,
  type PreUseResponse,
} from './equipmentQrService.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function equipment(over: Partial<Equipment> = {}): Equipment {
  return {
    id: 'eq-1',
    code: 'GH-001',
    type: 'gruahorquilla',
    status: 'operativo',
    criticality: 'high',
    riskCategories: ['maquinaria_pesada'],
    requiresPreUseChecklist: true,
    ...over,
  };
}

function makeOkResponses(type: string): PreUseResponse[] {
  return getChecklistForType(type).map((i) => ({ itemId: i.id, result: 'passed' as const }));
}

describe('PRE_USE_CHECKLISTS_BY_TYPE', () => {
  it('incluye gruahorquilla, maquina_soldar, andamio, compresor', () => {
    expect(getChecklistForType('gruahorquilla').length).toBeGreaterThan(0);
    expect(getChecklistForType('maquina_soldar').length).toBeGreaterThan(0);
    expect(getChecklistForType('andamio').length).toBeGreaterThan(0);
    expect(getChecklistForType('compresor').length).toBeGreaterThan(0);
  });

  it('tipo desconocido → []', () => {
    expect(getChecklistForType('unknown_type')).toEqual([]);
  });
});

describe('runPreUseValidation', () => {
  it('todos passed → validation.passed=true', () => {
    const v = runPreUseValidation({
      id: 'v1',
      equipment: equipment(),
      workerUid: 'w1',
      responses: makeOkResponses('gruahorquilla'),
      now: NOW,
    });
    expect(v.passed).toBe(true);
    expect(v.failedItems).toEqual([]);
  });

  it('1 failed → passed=false + failedItems lista el id', () => {
    const resp = makeOkResponses('gruahorquilla');
    resp[0].result = 'failed';
    const v = runPreUseValidation({
      id: 'v1',
      equipment: equipment(),
      workerUid: 'w1',
      responses: resp,
      now: NOW,
    });
    expect(v.passed).toBe(false);
    expect(v.failedItems).toContain(resp[0].itemId);
  });

  it('rechaza equipo fuera_servicio', () => {
    expect(() =>
      runPreUseValidation({
        id: 'v1',
        equipment: equipment({ status: 'fuera_servicio' }),
        workerUid: 'w1',
        responses: makeOkResponses('gruahorquilla'),
        now: NOW,
      }),
    ).toThrow(/EQUIPMENT_NOT_AVAILABLE/);
  });

  it('rechaza checklist incompleto cuando requiresPreUseChecklist=true', () => {
    const partial = makeOkResponses('gruahorquilla').slice(0, 2);
    expect(() =>
      runPreUseValidation({
        id: 'v1',
        equipment: equipment(),
        workerUid: 'w1',
        responses: partial,
        now: NOW,
      }),
    ).toThrow(/CHECKLIST_INCOMPLETE/);
  });

  it('no exige checklist si requiresPreUseChecklist=false', () => {
    const v = runPreUseValidation({
      id: 'v1',
      equipment: equipment({ requiresPreUseChecklist: false }),
      workerUid: 'w1',
      responses: [],
      now: NOW,
    });
    expect(v.passed).toBe(true);
  });

  it('tipo sin checklist definido + requiresPreUseChecklist=true → error', () => {
    expect(() =>
      runPreUseValidation({
        id: 'v1',
        equipment: equipment({ type: 'unknown_type' }),
        workerUid: 'w1',
        responses: [],
        now: NOW,
      }),
    ).toThrow(/NO_CHECKLIST_DEFINED/);
  });
});

describe('deriveEquipmentStatusAfterPreUse', () => {
  it('passed → mantiene status', () => {
    const v = runPreUseValidation({
      id: 'v1',
      equipment: equipment(),
      workerUid: 'w1',
      responses: makeOkResponses('gruahorquilla'),
      now: NOW,
    });
    expect(deriveEquipmentStatusAfterPreUse('operativo', v, 'high')).toBe('operativo');
  });

  it('failed + criticality=critical → fuera_servicio', () => {
    const resp = makeOkResponses('gruahorquilla');
    resp[0].result = 'failed';
    const v = runPreUseValidation({
      id: 'v1',
      equipment: equipment(),
      workerUid: 'w1',
      responses: resp,
      now: NOW,
    });
    expect(deriveEquipmentStatusAfterPreUse('operativo', v, 'critical')).toBe(
      'fuera_servicio',
    );
  });

  it('failed + criticality=low → restringido', () => {
    const resp = makeOkResponses('gruahorquilla');
    resp[0].result = 'failed';
    const v = runPreUseValidation({
      id: 'v1',
      equipment: equipment({ criticality: 'low' }),
      workerUid: 'w1',
      responses: resp,
      now: NOW,
    });
    expect(deriveEquipmentStatusAfterPreUse('operativo', v, 'low')).toBe('restringido');
  });
});
