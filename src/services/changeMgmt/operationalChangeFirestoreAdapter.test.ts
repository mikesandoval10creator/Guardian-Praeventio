import { describe, it, expect } from 'vitest';
import { OperationalChangeAdapter } from './operationalChangeFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import { declareChange } from './operationalChangeService.js';

function makeChange(over: { id?: string; kind?: 'supervisor' | 'procedure'; effectiveFrom?: string } = {}) {
  return declareChange({
    id: over.id ?? 'c1',
    projectId: 'p1',
    kind: over.kind ?? 'supervisor',
    whatChanged: 'Cambio de supervisor de sector A',
    previousValue: 'Pedro González',
    newValue: 'Ana Pérez',
    rationale: 'Rotación programada por descanso 7x7 conforme planificación.',
    impact: 'medium',
    affectedWorkerUids: ['w1', 'w2'],
    declaredByUid: 'admin-1',
    declaredByRole: 'admin',
    effectiveFrom: over.effectiveFrom ?? '2026-05-11T08:00:00Z',
    now: new Date('2026-05-11T07:30:00Z'),
  });
}

describe('OperationalChangeAdapter', () => {
  it('save + getById persiste y recupera change', async () => {
    const db = createFakeFirestore();
    const a = new OperationalChangeAdapter(db, 't1', 'p1');
    const c = makeChange();
    await a.save(c);
    const got = await a.getById(c.id);
    expect(got?.id).toBe(c.id);
    expect(got?.kind).toBe('supervisor');
  });

  it('addAcknowledgment es idempotente', async () => {
    const db = createFakeFirestore();
    const a = new OperationalChangeAdapter(db, 't1', 'p1');
    await a.save(makeChange());
    await a.addAcknowledgment('c1', 'w1', '2026-05-11T09:00:00Z');
    await a.addAcknowledgment('c1', 'w1', '2026-05-11T10:00:00Z');
    const got = await a.getById('c1');
    expect(got?.acknowledgments).toHaveLength(1);
    expect(got?.acknowledgments[0].workerUid).toBe('w1');
  });

  it('addAcknowledgment devuelve null para change inexistente', async () => {
    const db = createFakeFirestore();
    const a = new OperationalChangeAdapter(db, 't1', 'p1');
    const result = await a.addAcknowledgment('nope', 'w1', '2026-05-11T09:00:00Z');
    expect(result).toBeNull();
  });

  it('markReverted setea revertedAt y revertedReason', async () => {
    const db = createFakeFirestore();
    const a = new OperationalChangeAdapter(db, 't1', 'p1');
    await a.save(makeChange());
    await a.markReverted('c1', '2026-05-11T12:00:00Z', 'Decisión revertida por gerencia operacional');
    const got = await a.getById('c1');
    expect(got?.revertedAt).toBe('2026-05-11T12:00:00Z');
    expect(got?.revertedReason).toContain('gerencia');
  });

  it('listRecent ordena por effectiveFrom desc', async () => {
    const db = createFakeFirestore();
    const a = new OperationalChangeAdapter(db, 't1', 'p1');
    await a.save(makeChange({ id: 'old', effectiveFrom: '2026-05-10T08:00:00Z' }));
    await a.save(makeChange({ id: 'new', effectiveFrom: '2026-05-11T08:00:00Z' }));
    const list = await a.listRecent();
    expect(list[0].id).toBe('new');
  });

  it('listRecent filtra por kind si se pasa', async () => {
    const db = createFakeFirestore();
    const a = new OperationalChangeAdapter(db, 't1', 'p1');
    await a.save(makeChange({ id: 'c1', kind: 'supervisor' }));
    await a.save(makeChange({ id: 'c2', kind: 'procedure' }));
    const list = await a.listRecent('procedure');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c2');
  });
});
