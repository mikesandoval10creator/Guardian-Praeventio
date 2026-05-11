import { describe, it, expect } from 'vitest';
import { StoppageAdapter } from './stoppageFirestoreAdapter.js';
import { declareStoppage } from './stoppageEngine.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function makeStoppage(id = 's1') {
  return declareStoppage({
    id,
    projectId: 'p1',
    category: 'hallazgo_critico',
    scope: 'zone',
    scopeTargetId: 'zone-1',
    reason: 'condición eléctrica peligrosa en panel principal',
    declaredByUid: 'prev-1',
    declaredByRole: 'prevencionista',
    resumptionPreconditions: [{ id: 'pc1', label: 'Eléctrico valida aislación' }],
    now: NOW,
  });
}

describe('StoppageAdapter', () => {
  it('save + getById', async () => {
    const db = createFakeFirestore();
    const a = new StoppageAdapter(db, 't1', 'p1');
    const s = makeStoppage();
    await a.save(s);
    const got = await a.getById(s.id);
    expect(got?.status).toBe('active');
    expect(got?.category).toBe('hallazgo_critico');
  });

  it('null para id inexistente', async () => {
    const db = createFakeFirestore();
    const a = new StoppageAdapter(db, 't1', 'p1');
    expect(await a.getById('nope')).toBeNull();
  });

  it('update patch', async () => {
    const db = createFakeFirestore();
    const a = new StoppageAdapter(db, 't1', 'p1');
    await a.save(makeStoppage());
    await a.update('s1', { status: 'cancelled', cancelledReason: 'duplicada por error' });
    const got = await a.getById('s1');
    expect(got?.status).toBe('cancelled');
  });

  it('listByStatus filtra', async () => {
    const db = createFakeFirestore();
    const a = new StoppageAdapter(db, 't1', 'p1');
    await a.save(makeStoppage('a'));
    await a.save({ ...makeStoppage('b'), status: 'cancelled' });
    const active = await a.listByStatus('active');
    expect(active.map((s) => s.id)).toEqual(['a']);
  });
});
