import { describe, it, expect } from 'vitest';
import { LotoAdapter, type LotoAuditEvent } from './lotoFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { LotoApplication } from './lotoDigitalLight.js';

function app(over: Partial<LotoApplication> & { id: string }): LotoApplication {
  return {
    id: over.id,
    equipmentId: over.equipmentId ?? 'eq1',
    leaderUid: 'leader',
    authorizedWorkerUids: ['w1'],
    energiesIdentified: ['electric'],
    lockPoints: [],
    appliedAt: over.appliedAt ?? '2026-05-11T08:00:00Z',
    workDescription: 'mantención',
    fullyReleasedAt: over.fullyReleasedAt,
  };
}

function audit(at: string, kind: LotoAuditEvent['kind']): LotoAuditEvent {
  return { at, kind, actorUid: 'a1', detail: 'x' };
}

describe('LotoAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new LotoAdapter(db, 't1', 'p1');
    await a.save(app({ id: 'l1' }));
    expect((await a.getById('l1'))?.equipmentId).toBe('eq1');
  });

  it('audit subcollection persiste eventos en orden cronológico', async () => {
    const db = createFakeFirestore();
    const a = new LotoAdapter(db, 't1', 'p1');
    await a.save(app({ id: 'l1' }));
    await a.appendAudit('l1', audit('2026-05-11T09:00:00Z', 'lock_point_applied'));
    await a.appendAudit('l1', audit('2026-05-11T08:00:00Z', 'created'));
    const log = await a.listAudit('l1');
    expect(log).toHaveLength(2);
    expect(log[0].kind).toBe('created');
    expect(log[1].kind).toBe('lock_point_applied');
  });

  it('listActive excluye fullyReleased', async () => {
    const db = createFakeFirestore();
    const a = new LotoAdapter(db, 't1', 'p1');
    await a.save(app({ id: 'a1' }));
    await a.save(app({ id: 'a2', fullyReleasedAt: '2026-05-11T16:00:00Z' }));
    const list = await a.listActive();
    expect(list.map((x) => x.id)).toEqual(['a1']);
  });

  it('listForEquipment filtra y ordena', async () => {
    const db = createFakeFirestore();
    const a = new LotoAdapter(db, 't1', 'p1');
    await a.save(app({ id: 'a1', equipmentId: 'eq1', appliedAt: '2026-05-10T08:00:00Z' }));
    await a.save(app({ id: 'a2', equipmentId: 'eq1', appliedAt: '2026-05-11T08:00:00Z' }));
    await a.save(app({ id: 'a3', equipmentId: 'eq2' }));
    const list = await a.listForEquipment('eq1');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('a2');
  });

  it('audit aislado por appId', async () => {
    const db = createFakeFirestore();
    const a = new LotoAdapter(db, 't1', 'p1');
    await a.save(app({ id: 'a1' }));
    await a.save(app({ id: 'a2' }));
    await a.appendAudit('a1', audit('2026-05-11T08:00:00Z', 'created'));
    await a.appendAudit('a2', audit('2026-05-11T09:00:00Z', 'created'));
    expect((await a.listAudit('a1'))).toHaveLength(1);
    expect((await a.listAudit('a2'))).toHaveLength(1);
  });
});
