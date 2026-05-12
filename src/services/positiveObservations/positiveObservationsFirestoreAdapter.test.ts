import { describe, it, expect } from 'vitest';
import { PositiveObservationsAdapter } from './positiveObservationsFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { PositiveObservation } from './positiveObservationsService.js';

function po(over: Partial<PositiveObservation> & { id: string }): PositiveObservation {
  return {
    id: over.id,
    observedWorkerUid: over.observedWorkerUid ?? 'w1',
    observerUid: 'sup1',
    observerRole: 'supervisor',
    kind: over.kind ?? 'safe_behavior',
    description: 'd',
    observedAt: over.observedAt ?? '2026-05-11T10:00:00Z',
    location: 'A',
    shared: false,
  };
}

describe('PositiveObservationsAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new PositiveObservationsAdapter(db, 't1', 'p1');
    await a.save(po({ id: 'o1' }));
    expect((await a.getById('o1'))?.id).toBe('o1');
  });

  it('listForWorker filtra y ordena desc', async () => {
    const db = createFakeFirestore();
    const a = new PositiveObservationsAdapter(db, 't1', 'p1');
    await a.save(po({ id: 'old', observedWorkerUid: 'w1', observedAt: '2026-05-09T10:00:00Z' }));
    await a.save(po({ id: 'new', observedWorkerUid: 'w1', observedAt: '2026-05-11T10:00:00Z' }));
    await a.save(po({ id: 'other', observedWorkerUid: 'w2' }));
    const list = await a.listForWorker('w1');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('new');
  });

  it('listByKind filtra', async () => {
    const db = createFakeFirestore();
    const a = new PositiveObservationsAdapter(db, 't1', 'p1');
    await a.save(po({ id: 'a', kind: 'safe_behavior' }));
    await a.save(po({ id: 'b', kind: 'improvement_idea' }));
    expect((await a.listByKind('improvement_idea'))[0].id).toBe('b');
  });

  it('countSince cuenta desde fecha', async () => {
    const db = createFakeFirestore();
    const a = new PositiveObservationsAdapter(db, 't1', 'p1');
    await a.save(po({ id: 'old', observedAt: '2026-05-01T00:00:00Z' }));
    await a.save(po({ id: 'recent', observedAt: '2026-05-10T00:00:00Z' }));
    expect(await a.countSince('2026-05-05T00:00:00Z')).toBe(1);
  });
});
