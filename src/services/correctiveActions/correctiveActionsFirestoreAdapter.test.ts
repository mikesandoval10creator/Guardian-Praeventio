import { describe, it, expect } from 'vitest';
import { CorrectiveActionsAdapter } from './correctiveActionsFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import type { CorrectiveAction } from './weakActionDetector.js';

function action(over: Partial<CorrectiveAction> & { id: string }): CorrectiveAction {
  return {
    id: over.id,
    description: 'd',
    status: over.status ?? 'open',
    isSystemic: over.isSystemic ?? false,
    level: over.level,
  };
}

describe('CorrectiveActionsAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new CorrectiveActionsAdapter(db, 't1', 'p1');
    await a.save(action({ id: 'ca1' }));
    expect((await a.getById('ca1'))?.id).toBe('ca1');
  });

  it('updateStatus persiste cambio', async () => {
    const db = createFakeFirestore();
    const a = new CorrectiveActionsAdapter(db, 't1', 'p1');
    await a.save(action({ id: 'ca1' }));
    await a.updateStatus('ca1', 'closed');
    expect((await a.getById('ca1'))?.status).toBe('closed');
  });

  it('listByStatus filtra', async () => {
    const db = createFakeFirestore();
    const a = new CorrectiveActionsAdapter(db, 't1', 'p1');
    await a.save(action({ id: 'a', status: 'open' }));
    await a.save(action({ id: 'b', status: 'closed' }));
    expect((await a.listByStatus('open'))[0].id).toBe('a');
  });

  it('listByLevel filtra', async () => {
    const db = createFakeFirestore();
    const a = new CorrectiveActionsAdapter(db, 't1', 'p1');
    await a.save(action({ id: 'a', level: 'training' }));
    await a.save(action({ id: 'b', level: 'engineering' }));
    expect((await a.listByLevel('engineering'))[0].id).toBe('b');
  });

  it('listSystemic filtra', async () => {
    const db = createFakeFirestore();
    const a = new CorrectiveActionsAdapter(db, 't1', 'p1');
    await a.save(action({ id: 'a', isSystemic: true }));
    await a.save(action({ id: 'b', isSystemic: false }));
    expect((await a.listSystemic())[0].id).toBe('a');
  });
});
