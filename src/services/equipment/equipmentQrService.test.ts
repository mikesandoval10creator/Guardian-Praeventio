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

  // [Hy3-audit] Resolves [Audit-2026-08-31] Equipment pre-use —
  // IDs extra/duplicados y signatureHashHex no se validan. The
  // legacy set-based check accepted responses for items not in
  // the expected checklist (extras) AND silently collapsed
  // duplicate itemIds via Set. A malicious worker could spoof
  // responses for non-existent items. The fix rejects any
  // response whose itemId is not in the expected set, AND any
  // duplicate itemIds (the same item reported twice). Both
  // checks are explicit (no set deduplication) so the failure
  // mode is auditable.
  it('rechaza respuestas con itemIds que NO están en el checklist', () => {
    const extras = [
      ...makeOkResponses('gruahorquilla'),
      { itemId: 'inventado_extra', result: 'passed' as const },
    ];
    expect(() =>
      runPreUseValidation({
        id: 'v1',
        equipment: equipment(),
        workerUid: 'w1',
        responses: extras,
        now: NOW,
      }),
    ).toThrow(/UNEXPECTED_RESPONSE_ITEM|CHECKLIST_EXTRA/);
  });

  it('rechaza respuestas con itemIds duplicados', () => {
    const ok = makeOkResponses('gruahorquilla');
    const dupes = [...ok, ok[0]!];
    expect(() =>
      runPreUseValidation({
        id: 'v1',
        equipment: equipment(),
        workerUid: 'w1',
        responses: dupes,
        now: NOW,
      }),
    ).toThrow(/DUPLICATE_RESPONSE_ITEM|DUPLICATE_ITEM/);
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
