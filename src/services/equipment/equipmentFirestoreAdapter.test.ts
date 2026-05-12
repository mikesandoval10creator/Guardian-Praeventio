import { describe, it, expect } from 'vitest';
import { EquipmentAdapter } from './equipmentFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { Equipment, PreUseValidation } from './equipmentQrService.js';

function makeEquipment(over: Partial<Equipment> = {}): Equipment {
  return {
    id: over.id ?? 'eq-1',
    code: over.code ?? 'GRH-001',
    type: over.type ?? 'gruahorquilla',
    status: over.status ?? 'operativo',
    criticality: over.criticality ?? 'high',
    riskCategories: over.riskCategories ?? ['atropello', 'volcamiento'],
    requiresPreUseChecklist: over.requiresPreUseChecklist ?? true,
  };
}

function makePreUse(over: Partial<PreUseValidation> & { id: string }): PreUseValidation {
  return {
    id: over.id,
    equipmentId: over.equipmentId ?? 'eq-1',
    workerUid: over.workerUid ?? 'w1',
    startedAt: over.startedAt ?? '2026-05-11T08:00:00Z',
    responses: over.responses ?? [],
    passed: over.passed ?? true,
    failedItems: over.failedItems ?? [],
  };
}

describe('EquipmentAdapter', () => {
  it('save + getById persiste y recupera equipment', async () => {
    const db = createFakeFirestore();
    const a = new EquipmentAdapter(db, 't1', 'p1');
    await a.save(makeEquipment());
    const got = await a.getById('eq-1');
    expect(got?.id).toBe('eq-1');
    expect(got?.type).toBe('gruahorquilla');
  });

  it('updateStatus cambia status', async () => {
    const db = createFakeFirestore();
    const a = new EquipmentAdapter(db, 't1', 'p1');
    await a.save(makeEquipment());
    await a.updateStatus('eq-1', 'fuera_servicio');
    const got = await a.getById('eq-1');
    expect(got?.status).toBe('fuera_servicio');
  });

  it('listByStatus filtra correctamente', async () => {
    const db = createFakeFirestore();
    const a = new EquipmentAdapter(db, 't1', 'p1');
    await a.save(makeEquipment({ id: 'eq-1', status: 'operativo' }));
    await a.save(makeEquipment({ id: 'eq-2', status: 'fuera_servicio' }));
    await a.save(makeEquipment({ id: 'eq-3', status: 'operativo' }));
    const list = await a.listByStatus('operativo');
    expect(list.map((e) => e.id).sort()).toEqual(['eq-1', 'eq-3']);
  });

  it('appendPreUse persiste pre-use en subcollection', async () => {
    const db = createFakeFirestore();
    const a = new EquipmentAdapter(db, 't1', 'p1');
    await a.save(makeEquipment());
    await a.appendPreUse(makePreUse({ id: 'pv-1' }));
    const list = await a.listPreUsesForEquipment('eq-1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('pv-1');
  });

  it('listPreUsesForEquipment ordena por startedAt desc', async () => {
    const db = createFakeFirestore();
    const a = new EquipmentAdapter(db, 't1', 'p1');
    await a.save(makeEquipment());
    await a.appendPreUse(makePreUse({ id: 'older', startedAt: '2026-05-10T08:00:00Z' }));
    await a.appendPreUse(makePreUse({ id: 'newer', startedAt: '2026-05-11T08:00:00Z' }));
    const list = await a.listPreUsesForEquipment('eq-1');
    expect(list[0].id).toBe('newer');
    expect(list[1].id).toBe('older');
  });

  it('listPreUsesForEquipment aísla por equipmentId (subcollection)', async () => {
    const db = createFakeFirestore();
    const a = new EquipmentAdapter(db, 't1', 'p1');
    await a.save(makeEquipment({ id: 'eq-1' }));
    await a.save(makeEquipment({ id: 'eq-2' }));
    await a.appendPreUse(makePreUse({ id: 'pv-1', equipmentId: 'eq-1' }));
    await a.appendPreUse(makePreUse({ id: 'pv-2', equipmentId: 'eq-2' }));
    const list1 = await a.listPreUsesForEquipment('eq-1');
    const list2 = await a.listPreUsesForEquipment('eq-2');
    expect(list1).toHaveLength(1);
    expect(list1[0].id).toBe('pv-1');
    expect(list2).toHaveLength(1);
    expect(list2[0].id).toBe('pv-2');
  });
});
