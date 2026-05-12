import { describe, it, expect } from 'vitest';
import { LessonsAdapter } from './lessonsFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { Lesson } from './lessonsLibrary.js';

function lesson(over: Partial<Lesson> & { id: string }): Lesson {
  return {
    id: over.id,
    summary: 's',
    preventiveAction: 'a',
    riskCategories: over.riskCategories ?? ['altura'],
    tags: ['tag1'],
    scope: over.scope ?? 'project',
    industry: over.industry,
    derivedFromIncidentId: over.derivedFromIncidentId,
    publishedAt: over.publishedAt ?? '2026-05-11T10:00:00Z',
    adoptionCount: over.adoptionCount ?? 0,
  };
}

describe('LessonsAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new LessonsAdapter(db, 't1');
    await a.save(lesson({ id: 'l1' }));
    expect((await a.getById('l1'))?.id).toBe('l1');
  });

  it('incrementAdoption suma 1', async () => {
    const db = createFakeFirestore();
    const a = new LessonsAdapter(db, 't1');
    await a.save(lesson({ id: 'l1', adoptionCount: 5 }));
    const updated = await a.incrementAdoption('l1');
    expect(updated?.adoptionCount).toBe(6);
  });

  it('listByScope filtra', async () => {
    const db = createFakeFirestore();
    const a = new LessonsAdapter(db, 't1');
    await a.save(lesson({ id: 'g1', scope: 'global' }));
    await a.save(lesson({ id: 'p1', scope: 'project' }));
    expect((await a.listByScope('global')).length).toBe(1);
  });

  it('listByRiskCategory filtra array-contains', async () => {
    const db = createFakeFirestore();
    const a = new LessonsAdapter(db, 't1');
    await a.save(lesson({ id: 'a', riskCategories: ['altura'] }));
    await a.save(lesson({ id: 'b', riskCategories: ['electric'] }));
    expect((await a.listByRiskCategory('altura'))[0].id).toBe('a');
  });

  it('listTopAdopted ordena desc por adoptionCount', async () => {
    const db = createFakeFirestore();
    const a = new LessonsAdapter(db, 't1');
    await a.save(lesson({ id: 'low', adoptionCount: 1 }));
    await a.save(lesson({ id: 'high', adoptionCount: 100 }));
    const top = await a.listTopAdopted(2);
    expect(top[0].id).toBe('high');
  });
});
