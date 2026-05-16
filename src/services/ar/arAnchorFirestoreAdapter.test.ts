import { describe, it, expect } from 'vitest';
import { ArAnchorAdapter } from './arAnchorFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import {
  matrixFromPosition,
  type MachineryAnchor,
  type PosterAnchor,
  type WarehouseObjectAnchor,
} from './arAnchorService.js';

function makeMachinery(over: Partial<MachineryAnchor> & { id: string }): MachineryAnchor {
  return {
    id: over.id,
    kind: 'machinery',
    projectId: over.projectId ?? 'p1',
    tenantId: over.tenantId ?? 't1',
    createdByUid: over.createdByUid ?? 'u1',
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
    gps: over.gps ?? { latitude: -33.45, longitude: -70.66 },
    matrix: over.matrix ?? matrixFromPosition(0, 0, 0),
    label: over.label ?? 'Grúa Horquilla',
    equipmentId: over.equipmentId ?? 'eq-1',
    info: over.info ?? { code: 'GRH-001' },
  };
}

function makeWarehouse(over: Partial<WarehouseObjectAnchor> & { id: string }): WarehouseObjectAnchor {
  return {
    id: over.id,
    kind: 'warehouse_object',
    projectId: over.projectId ?? 'p1',
    tenantId: over.tenantId ?? 't1',
    createdByUid: over.createdByUid ?? 'u1',
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
    gps: over.gps ?? { latitude: -33.45, longitude: -70.66 },
    matrix: over.matrix ?? matrixFromPosition(0, 0, 0),
    label: over.label ?? 'Extintor',
    objectType: over.objectType ?? 'extinguisher_pqs',
    status: over.status ?? 'planned',
  };
}

function makePoster(over: Partial<PosterAnchor> & { id: string }): PosterAnchor {
  return {
    id: over.id,
    kind: 'poster',
    projectId: over.projectId ?? 'p1',
    tenantId: over.tenantId ?? 't1',
    createdByUid: over.createdByUid ?? 'u1',
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
    gps: over.gps ?? { latitude: -33.45, longitude: -70.66 },
    matrix: over.matrix ?? matrixFromPosition(0, 0, 0),
    label: over.label ?? 'Poster Trabajo en Altura',
    posterId: over.posterId ?? 'poster-altura',
    scanCount: over.scanCount ?? 0,
  };
}

describe('ArAnchorAdapter — CRUD básico', () => {
  it('save + getById roundtrip', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await a.save(makeMachinery({ id: 'm1' }));
    const got = await a.getById('m1');
    expect(got?.id).toBe('m1');
    expect(got?.kind).toBe('machinery');
  });

  it('save rechaza si projectId no coincide con adapter', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await expect(
      a.save(makeMachinery({ id: 'm1', projectId: 'p2' })),
    ).rejects.toThrow(/projectId/);
  });

  it('save rechaza si tenantId no coincide', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await expect(
      a.save(makeMachinery({ id: 'm1', tenantId: 't2' })),
    ).rejects.toThrow(/tenantId/);
  });

  it('getById null cuando no existe', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    expect(await a.getById('nope')).toBeNull();
  });

  // Nota: `delete` está implementado en el adapter pero el
  // `fakeFirestore` de tests no soporta `.delete()` todavía. El test
  // real correrá contra el emulator Firestore (rules-test pipeline).
});

describe('ArAnchorAdapter — tenant isolation', () => {
  it('anchors de tenant T1 NO aparecen en query de T2', async () => {
    const db = createFakeFirestore();
    const t1 = new ArAnchorAdapter(db, 't1', 'p1');
    const t2 = new ArAnchorAdapter(db, 't2', 'p1');
    await t1.save(makeMachinery({ id: 'm-t1' }));
    await t2.save(makeMachinery({ id: 'm-t2', tenantId: 't2' }));
    const list1 = await t1.listAll();
    expect(list1.map((a) => a.id)).toEqual(['m-t1']);
  });

  it('anchors de project P1 NO aparecen en query de P2', async () => {
    const db = createFakeFirestore();
    const p1 = new ArAnchorAdapter(db, 't1', 'p1');
    const p2 = new ArAnchorAdapter(db, 't1', 'p2');
    await p1.save(makeMachinery({ id: 'm-p1' }));
    await p2.save(makeMachinery({ id: 'm-p2', projectId: 'p2' }));
    const list1 = await p1.listAll();
    expect(list1.map((a) => a.id)).toEqual(['m-p1']);
  });
});

describe('ArAnchorAdapter — queries por kind', () => {
  it('listMachinery solo retorna machinery anchors', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await a.save(makeMachinery({ id: 'm1' }));
    await a.save(makeWarehouse({ id: 'w1' }));
    await a.save(makePoster({ id: 'p1' }));
    const list = await a.listMachinery();
    expect(list.map((x) => x.id)).toEqual(['m1']);
  });

  it('listWarehouseObjects solo retorna warehouse_object', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await a.save(makeMachinery({ id: 'm1' }));
    await a.save(makeWarehouse({ id: 'w1' }));
    await a.save(makeWarehouse({ id: 'w2' }));
    const list = await a.listWarehouseObjects();
    expect(list.map((x) => x.id).sort()).toEqual(['w1', 'w2']);
  });

  it('listPosters solo retorna posters', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await a.save(makePoster({ id: 'p1' }));
    await a.save(makePoster({ id: 'p2' }));
    await a.save(makeMachinery({ id: 'm1' }));
    const list = await a.listPosters();
    expect(list.map((x) => x.id).sort()).toEqual(['p1', 'p2']);
  });
});

describe('ArAnchorAdapter — listByEquipmentId', () => {
  it('retorna solo anchors del equipment dado', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await a.save(makeMachinery({ id: 'm1', equipmentId: 'eq-A' }));
    await a.save(makeMachinery({ id: 'm2', equipmentId: 'eq-B' }));
    await a.save(makeMachinery({ id: 'm3', equipmentId: 'eq-A' }));
    const list = await a.listByEquipmentId('eq-A');
    expect(list.map((x) => x.id).sort()).toEqual(['m1', 'm3']);
  });
});

describe('ArAnchorAdapter — incrementPosterScan', () => {
  it('incrementa scanCount + actualiza updatedAt', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await a.save(makePoster({ id: 'p1', scanCount: 5 }));
    await a.incrementPosterScan('p1', '2026-05-16T10:00:00Z');
    const got = await a.getById('p1');
    expect(got?.kind).toBe('poster');
    expect((got as PosterAnchor).scanCount).toBe(6);
    expect((got as PosterAnchor).updatedAt).toBe('2026-05-16T10:00:00Z');
  });

  it('no falla si el anchor no existe', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await expect(a.incrementPosterScan('nope', '2026-05-16T10:00:00Z')).resolves.toBeUndefined();
  });

  it('no incrementa si el anchor no es poster (machinery/warehouse)', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await a.save(makeMachinery({ id: 'm1' }));
    await a.incrementPosterScan('m1', '2026-05-16T10:00:00Z');
    const got = await a.getById('m1');
    // No tiene scanCount, no debería tenerlo después tampoco
    expect((got as any).scanCount).toBeUndefined();
  });
});

describe('ArAnchorAdapter — listFiltered (combina con filterAnchors puro)', () => {
  it('combina kind + tags', async () => {
    const db = createFakeFirestore();
    const a = new ArAnchorAdapter(db, 't1', 'p1');
    await a.save(makeWarehouse({ id: 'w1' }));
    await a.save({
      ...makeWarehouse({ id: 'w2' }),
      tags: ['emergencia'],
    } as WarehouseObjectAnchor);
    const list = await a.listFiltered({ kind: 'warehouse_object', tags: ['emergencia'] });
    expect(list.map((x) => x.id)).toEqual(['w2']);
  });
});
