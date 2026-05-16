import { describe, it, expect } from 'vitest';
import { DeaAdapter } from './deaFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { Dea, DeaInspection } from './deaService.js';

function makeDea(over: Partial<Dea> = {}): Dea {
  return {
    id: over.id ?? 'dea-1',
    location: over.location ?? 'Recepción Principal',
    description: over.description ?? 'Muro este, junto a extintor',
    batteryExpiry: over.batteryExpiry ?? '2027-05-10',
    padsExpiry: over.padsExpiry ?? '2026-12-01',
    lastCheck: over.lastCheck ?? '2026-05-01',
    assignedToUid: over.assignedToUid ?? 'uid-juan',
    assignedToName: over.assignedToName ?? 'Juan Pérez',
    createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
    createdBy: over.createdBy ?? 'uid-admin',
  };
}

function makeInspection(over: Partial<DeaInspection> & { id: string }): DeaInspection {
  return {
    id: over.id,
    deaId: over.deaId ?? 'dea-1',
    performedAt: over.performedAt ?? '2026-05-15',
    performedByUid: over.performedByUid ?? 'uid-juan',
    performedByName: over.performedByName ?? 'Juan Pérez',
    checklist: over.checklist ?? {
      statusLightGreen: true,
      batteryConnectedValid: true,
      padsSealedValid: true,
      responseKitComplete: true,
      cabinetIntactAlarmOperative: true,
    },
    notes: over.notes,
  };
}

describe('DeaAdapter', () => {
  it('save + getById persiste y recupera DEA', async () => {
    const db = createFakeFirestore();
    const a = new DeaAdapter(db, 't1', 'p1');
    await a.save(makeDea());
    const got = await a.getById('dea-1');
    expect(got?.id).toBe('dea-1');
    expect(got?.location).toBe('Recepción Principal');
  });

  it('getById devuelve null si no existe', async () => {
    const db = createFakeFirestore();
    const a = new DeaAdapter(db, 't1', 'p1');
    const got = await a.getById('inexistente');
    expect(got).toBeNull();
  });

  it('listAll devuelve todos los DEAs del proyecto', async () => {
    const db = createFakeFirestore();
    const a = new DeaAdapter(db, 't1', 'p1');
    await a.save(makeDea({ id: 'dea-1' }));
    await a.save(makeDea({ id: 'dea-2', location: 'Casino N2' }));
    const list = await a.listAll();
    expect(list.map((d) => d.id).sort()).toEqual(['dea-1', 'dea-2']);
  });

  it('listAll del tenant T1 NO retorna DEAs del tenant T2', async () => {
    const db = createFakeFirestore();
    const t1 = new DeaAdapter(db, 't1', 'p1');
    const t2 = new DeaAdapter(db, 't2', 'p1');
    await t1.save(makeDea({ id: 'dea-t1' }));
    await t2.save(makeDea({ id: 'dea-t2' }));
    const list1 = await t1.listAll();
    expect(list1.map((d) => d.id)).toEqual(['dea-t1']);
  });

  it('listByAssignedTo filtra por responsable', async () => {
    const db = createFakeFirestore();
    const a = new DeaAdapter(db, 't1', 'p1');
    await a.save(makeDea({ id: 'dea-1', assignedToUid: 'uid-juan' }));
    await a.save(makeDea({ id: 'dea-2', assignedToUid: 'uid-maria' }));
    await a.save(makeDea({ id: 'dea-3', assignedToUid: 'uid-juan' }));
    const list = await a.listByAssignedTo('uid-juan');
    expect(list.map((d) => d.id).sort()).toEqual(['dea-1', 'dea-3']);
  });

  it('appendInspection persiste en subcolección', async () => {
    const db = createFakeFirestore();
    const a = new DeaAdapter(db, 't1', 'p1');
    await a.save(makeDea());
    await a.appendInspection(makeInspection({ id: 'ins-1' }));
    const list = await a.listInspectionsForDea('dea-1');
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe('ins-1');
  });

  it('markInspectionAndUpdateLastCheck actualiza lastCheck del DEA', async () => {
    const db = createFakeFirestore();
    const a = new DeaAdapter(db, 't1', 'p1');
    await a.save(makeDea({ lastCheck: '2026-01-01' }));
    await a.markInspectionAndUpdateLastCheck(
      makeInspection({ id: 'ins-1', performedAt: '2026-05-15' }),
    );
    const dea = await a.getById('dea-1');
    expect(dea?.lastCheck).toBe('2026-05-15');
  });

  it('markInspectionAndUpdateLastCheck con markStatusCritical setea flag', async () => {
    const db = createFakeFirestore();
    const a = new DeaAdapter(db, 't1', 'p1');
    await a.save(makeDea());
    await a.markInspectionAndUpdateLastCheck(
      makeInspection({
        id: 'ins-1',
        checklist: {
          statusLightGreen: false, // ← falló
          batteryConnectedValid: true,
          padsSealedValid: true,
          responseKitComplete: true,
          cabinetIntactAlarmOperative: true,
        },
      }),
      { markStatusCritical: true },
    );
    const dea = (await a.getById('dea-1')) as Dea & { criticalOverride?: boolean };
    expect(dea?.criticalOverride).toBe(true);
  });
});
