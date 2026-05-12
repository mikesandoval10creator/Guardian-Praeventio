import { describe, it, expect } from 'vitest';
import { VisitorAdapter } from './visitorFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { VisitorAccess } from './visitorAccessService.js';

function visitor(over: Partial<VisitorAccess> & { id: string }): VisitorAccess {
  return {
    id: over.id,
    fullName: 'María',
    identityDocument: '11111111-1',
    organization: 'X',
    kind: over.kind ?? 'mandante',
    hostUid: over.hostUid ?? 'h1',
    checkedInAt: over.checkedInAt ?? '2026-05-11T08:00:00Z',
    checkedOutAt: over.checkedOutAt,
    authorizedZones: ['z1'],
    inductionItemsAcked: [],
    eppHandedOver: true,
  };
}

describe('VisitorAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new VisitorAdapter(db, 't1', 'p1');
    await a.save(visitor({ id: 'v1' }));
    expect((await a.getById('v1'))?.id).toBe('v1');
  });

  it('listActive excluye los que hicieron checkout', async () => {
    const db = createFakeFirestore();
    const a = new VisitorAdapter(db, 't1', 'p1');
    await a.save(visitor({ id: 'v1' }));
    await a.save(visitor({ id: 'v2', checkedOutAt: '2026-05-11T16:00:00Z' }));
    const list = await a.listActive();
    expect(list.map((v) => v.id)).toEqual(['v1']);
  });

  it('recordCheckout persiste timestamp', async () => {
    const db = createFakeFirestore();
    const a = new VisitorAdapter(db, 't1', 'p1');
    await a.save(visitor({ id: 'v1' }));
    await a.recordCheckout('v1', '2026-05-11T16:00:00Z');
    expect((await a.getById('v1'))?.checkedOutAt).toBe('2026-05-11T16:00:00Z');
  });

  it('listByKind filtra y ordena', async () => {
    const db = createFakeFirestore();
    const a = new VisitorAdapter(db, 't1', 'p1');
    await a.save(visitor({ id: 'm1', kind: 'mandante', checkedInAt: '2026-05-10T08:00:00Z' }));
    await a.save(visitor({ id: 'm2', kind: 'mandante', checkedInAt: '2026-05-11T08:00:00Z' }));
    await a.save(visitor({ id: 'f1', kind: 'fiscalizador' }));
    const list = await a.listByKind('mandante');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('m2');
  });

  it('listForHost filtra por hostUid', async () => {
    const db = createFakeFirestore();
    const a = new VisitorAdapter(db, 't1', 'p1');
    await a.save(visitor({ id: 'v1', hostUid: 'h1' }));
    await a.save(visitor({ id: 'v2', hostUid: 'h2' }));
    const list = await a.listForHost('h1');
    expect(list.map((v) => v.id)).toEqual(['v1']);
  });
});
