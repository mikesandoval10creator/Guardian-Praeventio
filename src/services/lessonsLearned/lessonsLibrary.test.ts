import { describe, it, expect } from 'vitest';
import {
  searchLessons,
  suggestLessonsForTask,
  recordAdoption,
  buildAdoptionReport,
  type Lesson,
} from './lessonsLibrary.js';

function lesson(over: Partial<Lesson> & { id: string }): Lesson {
  return {
    id: over.id,
    summary: over.summary ?? 'Lección genérica sobre altura',
    preventiveAction: over.preventiveAction ?? 'Verificar arnés antes de subir',
    riskCategories: over.riskCategories ?? ['altura'],
    tags: over.tags ?? ['altura', 'epp'],
    scope: over.scope ?? 'global',
    industry: over.industry,
    derivedFromIncidentId: over.derivedFromIncidentId,
    publishedAt: over.publishedAt ?? '2026-05-01T00:00:00Z',
    adoptionCount: over.adoptionCount ?? 0,
  };
}

describe('searchLessons', () => {
  it('búsqueda por texto matchea tokens', () => {
    const lib = [
      lesson({ id: 'l1', summary: 'Arnés mal ajustado causa caída' }),
      lesson({
        id: 'l2',
        summary: 'Falla eléctrica por LOTO incompleto',
        preventiveAction: 'Verificar cero energía antes de intervenir',
        riskCategories: ['electric'],
        tags: ['electric', 'loto'],
      }),
    ];
    const r = searchLessons(lib, { text: 'arnes' });
    expect(r.map((l) => l.id)).toEqual(['l1']);
  });

  it('filtra por riskCategory', () => {
    const lib = [lesson({ id: 'l1' }), lesson({ id: 'l2', riskCategories: ['electric'] })];
    expect(searchLessons(lib, { riskCategory: 'electric' }).map((l) => l.id)).toEqual(['l2']);
  });

  it('filtra por tag exacto', () => {
    const lib = [lesson({ id: 'l1', tags: ['altura'] }), lesson({ id: 'l2', tags: ['quimico'] })];
    expect(searchLessons(lib, { tag: 'quimico' }).map((l) => l.id)).toEqual(['l2']);
  });
});

describe('suggestLessonsForTask', () => {
  it('lecciones que matchean categoría tienen mayor relevance', () => {
    const lib = [
      lesson({ id: 'l1', riskCategories: ['altura'], scope: 'global' }),
      lesson({ id: 'l2', riskCategories: ['electric'], scope: 'global' }),
    ];
    const r = suggestLessonsForTask(lib, {
      taskId: 't1',
      riskCategories: ['altura'],
    });
    expect(r[0].id).toBe('l1');
    expect(r[0].relevance).toBeGreaterThan(40);
  });

  it('match industria suma +20', () => {
    const lib = [
      lesson({
        id: 'l-industry',
        riskCategories: ['altura'],
        scope: 'industry',
        industry: 'mining',
      }),
      lesson({ id: 'l-global', riskCategories: ['altura'], scope: 'global' }),
    ];
    const r = suggestLessonsForTask(lib, {
      taskId: 't1',
      riskCategories: ['altura'],
      industry: 'mining',
    });
    expect(r[0].id).toBe('l-industry');
  });

  it('topN limita resultados', () => {
    const lib = Array.from({ length: 10 }, (_, i) =>
      lesson({ id: `l${i}`, riskCategories: ['altura'] }),
    );
    expect(suggestLessonsForTask(lib, { taskId: 't', riskCategories: ['altura'] }, 3)).toHaveLength(3);
  });
});

describe('recordAdoption', () => {
  it('incrementa adoptionCount inmutable', () => {
    const l = lesson({ id: 'a', adoptionCount: 2 });
    const updated = recordAdoption(l);
    expect(updated.adoptionCount).toBe(3);
    expect(l.adoptionCount).toBe(2); // inmutable
  });
});

describe('buildAdoptionReport', () => {
  it('cuenta lecciones con y sin adoption + top', () => {
    const lib = [
      lesson({ id: 'a', adoptionCount: 10 }),
      lesson({ id: 'b', adoptionCount: 0 }),
      lesson({ id: 'c', adoptionCount: 5 }),
    ];
    const r = buildAdoptionReport(lib);
    expect(r.withAdoption).toBe(2);
    expect(r.noAdoption).toBe(1);
    expect(r.topAdopted[0].id).toBe('a');
  });
});
