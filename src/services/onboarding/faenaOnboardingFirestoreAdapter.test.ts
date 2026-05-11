import { describe, it, expect } from 'vitest';
import { FaenaOnboardingAdapter } from './faenaOnboardingFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import {
  buildStandardOnboardingTemplate,
  type OnboardingBundle,
  type OnboardingStatus,
} from './faenaOnboardingBundle.js';

function makeBundle(over: {
  id?: string;
  workerUid?: string;
  projectId?: string;
  status?: OnboardingStatus;
  updatedAt?: string;
} = {}): OnboardingBundle {
  return {
    id: over.id ?? 'ob-1',
    workerUid: over.workerUid ?? 'w1',
    workerFullName: 'Juan Trabajador',
    projectId: over.projectId ?? 'p1',
    requirements: buildStandardOnboardingTemplate(),
    status: over.status ?? 'pending',
    createdAt: '2026-05-11T08:00:00Z',
    updatedAt: over.updatedAt ?? '2026-05-11T08:00:00Z',
  };
}

describe('FaenaOnboardingAdapter', () => {
  it('save + getById persiste y recupera bundle', async () => {
    const db = createFakeFirestore();
    const a = new FaenaOnboardingAdapter(db, 't1');
    await a.save(makeBundle());
    const got = await a.getById('ob-1');
    expect(got?.id).toBe('ob-1');
    expect(got?.requirements.length).toBeGreaterThan(0);
  });

  it('updateStatus actualiza status y updatedAt', async () => {
    const db = createFakeFirestore();
    const a = new FaenaOnboardingAdapter(db, 't1');
    await a.save(makeBundle());
    await a.updateStatus('ob-1', 'partial', '2026-05-11T10:00:00Z');
    const got = await a.getById('ob-1');
    expect(got?.status).toBe('partial');
    expect(got?.updatedAt).toBe('2026-05-11T10:00:00Z');
  });

  it('recordReview persiste reviewer + decisión', async () => {
    const db = createFakeFirestore();
    const a = new FaenaOnboardingAdapter(db, 't1');
    await a.save(makeBundle());
    await a.recordReview('ob-1', 'mandante-1', '2026-05-11T12:00:00Z', 'OK', 'approved');
    const got = await a.getById('ob-1');
    expect(got?.reviewerUid).toBe('mandante-1');
    expect(got?.status).toBe('approved');
    expect(got?.reviewerNotes).toBe('OK');
  });

  it('listForWorker filtra por workerUid ordenado desc', async () => {
    const db = createFakeFirestore();
    const a = new FaenaOnboardingAdapter(db, 't1');
    await a.save(makeBundle({ id: 'old', workerUid: 'w1', updatedAt: '2026-05-10T08:00:00Z' }));
    await a.save(makeBundle({ id: 'new', workerUid: 'w1', updatedAt: '2026-05-11T08:00:00Z' }));
    await a.save(makeBundle({ id: 'other', workerUid: 'w2', updatedAt: '2026-05-11T08:00:00Z' }));
    const list = await a.listForWorker('w1');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('new');
  });

  it('listByStatus filtra por status', async () => {
    const db = createFakeFirestore();
    const a = new FaenaOnboardingAdapter(db, 't1');
    await a.save(makeBundle({ id: 'a', status: 'approved' }));
    await a.save(makeBundle({ id: 'b', status: 'pending' }));
    await a.save(makeBundle({ id: 'c', status: 'approved' }));
    const list = await a.listByStatus('approved');
    expect(list.map((b) => b.id).sort()).toEqual(['a', 'c']);
  });

  it('listForProject filtra por projectId', async () => {
    const db = createFakeFirestore();
    const a = new FaenaOnboardingAdapter(db, 't1');
    await a.save(makeBundle({ id: 'a', projectId: 'p1' }));
    await a.save(makeBundle({ id: 'b', projectId: 'p2' }));
    const list = await a.listForProject('p1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });
});
