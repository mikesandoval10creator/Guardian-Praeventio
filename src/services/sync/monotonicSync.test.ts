import { describe, it, expect } from 'vitest';
import {
  decidePush,
  buildPullResponse,
  buildPrefetchPlan,
  type VersionedDoc,
} from './monotonicSync.js';

function doc<T>(uuid: string, rev: number, data: T): VersionedDoc<T> {
  return { uuid, rev, data, updatedAt: '2026-05-11T10:00:00Z' };
}

describe('decidePush', () => {
  it('create cuando no existe', () => {
    const r = decidePush({ uuid: 'a', data: { x: 1 } }, null);
    expect(r.kind).toBe('apply');
    if (r.kind === 'apply') expect(r.isCreate).toBe(true);
  });

  it('update sin expectedRev → last-write-wins', () => {
    const r = decidePush({ uuid: 'a', data: { x: 2 } }, doc('a', 5, { x: 1 }));
    expect(r.kind).toBe('apply');
    if (r.kind === 'apply') expect(r.isCreate).toBe(false);
  });

  it('expectedRev coincide → apply', () => {
    const r = decidePush(
      { uuid: 'a', data: { x: 2 }, expectedRev: 5 },
      doc('a', 5, { x: 1 }),
    );
    expect(r.kind).toBe('apply');
  });

  it('expectedRev no coincide → conflict con serverDoc', () => {
    const existing = doc('a', 7, { x: 'server' });
    const r = decidePush(
      { uuid: 'a', data: { x: 'client' }, expectedRev: 5 },
      existing,
    );
    expect(r.kind).toBe('conflict');
    if (r.kind === 'conflict') expect(r.serverDoc).toBe(existing);
  });
});

describe('buildPullResponse', () => {
  it('filtra por watermark y ordena asc', () => {
    const docs = [doc('a', 3, 1), doc('b', 1, 1), doc('c', 5, 1), doc('d', 2, 1)];
    const r = buildPullResponse(docs, { watermark: 1 });
    expect(r.docs.map((d) => d.rev)).toEqual([2, 3, 5]);
    expect(r.nextWatermark).toBe(5);
    expect(r.hasMore).toBe(false);
  });

  it('aplica limit + hasMore=true si quedan más', () => {
    const docs = Array.from({ length: 10 }, (_, i) => doc(`d${i}`, i + 1, 1));
    const r = buildPullResponse(docs, { watermark: 0, limit: 3 });
    expect(r.docs).toHaveLength(3);
    expect(r.hasMore).toBe(true);
    expect(r.nextWatermark).toBe(3);
  });

  it('respuesta vacía si watermark >= max rev', () => {
    const docs = [doc('a', 1, 1), doc('b', 2, 1)];
    const r = buildPullResponse(docs, { watermark: 2 });
    expect(r.docs).toHaveLength(0);
    expect(r.nextWatermark).toBe(2);
    expect(r.hasMore).toBe(false);
  });
});

describe('buildPrefetchPlan', () => {
  it('genera roots por categoria de tarea', () => {
    const plan = buildPrefetchPlan({
      workerUid: 'w1',
      upcomingTaskCategories: ['altura', 'electric'],
      crewmateUids: ['w2', 'w3'],
    });
    expect(plan.zettelkastenRoots).toEqual(['risk:altura', 'risk:electric']);
    expect(plan.documentCategories).toContain('procedure:altura');
    expect(plan.documentCategories).toContain('riskmatrix:electric');
    expect(plan.trainingCategories).toEqual(['altura', 'electric']);
    expect(plan.crewHistoryUids).toEqual(['w2', 'w3']);
  });

  it('vacío si no hay tareas', () => {
    const plan = buildPrefetchPlan({ workerUid: 'w1', upcomingTaskCategories: [] });
    expect(plan.zettelkastenRoots).toEqual([]);
    expect(plan.documentCategories).toEqual([]);
    expect(plan.crewHistoryUids).toEqual([]);
  });
});
