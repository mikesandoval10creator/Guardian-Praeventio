import { describe, it, expect } from 'vitest';
import { ExceptionAdapter } from './exceptionFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import { createException, type ExceptionDomain } from './exceptionEngine.js';

function makeException(over: {
  id?: string;
  domain?: ExceptionDomain;
  subjectKind?: 'WORKER' | 'EPP';
  subjectId?: string;
  durationHours?: number;
  now?: string;
} = {}) {
  return createException({
    id: over.id ?? 'ex-1',
    domain: over.domain ?? 'training_gap',
    subjectRef: { kind: over.subjectKind ?? 'WORKER', id: over.subjectId ?? 'w1' },
    reason: 'Trabajador con capacitación vencida hace 2 días, en proceso de renovación.',
    alternativeMitigation:
      'Supervisor directo acompaña al trabajador en faena hasta que renueve capacitación.',
    approvedByUid: 'sup-1',
    approvedByRole: 'supervisor',
    durationHours: over.durationHours ?? 24,
    now: new Date(over.now ?? '2026-05-11T08:00:00Z'),
  });
}

describe('ExceptionAdapter', () => {
  it('save + getById persiste y recupera exception', async () => {
    const db = createFakeFirestore();
    const a = new ExceptionAdapter(db, 't1', 'p1');
    await a.save(makeException());
    const got = await a.getById('ex-1');
    expect(got?.id).toBe('ex-1');
    expect(got?.domain).toBe('training_gap');
    expect(got?.status).toBe('active');
  });

  it('updateStatus aplica patch parcial', async () => {
    const db = createFakeFirestore();
    const a = new ExceptionAdapter(db, 't1', 'p1');
    await a.save(makeException());
    await a.updateStatus('ex-1', {
      status: 'revoked',
      revokedAt: '2026-05-11T09:00:00Z',
      revokedByUid: 'sup-2',
      revokedReason: 'condición climática',
    });
    const got = await a.getById('ex-1');
    expect(got?.status).toBe('revoked');
    expect(got?.revokedByUid).toBe('sup-2');
  });

  it('listActive devuelve solo status=active', async () => {
    const db = createFakeFirestore();
    const a = new ExceptionAdapter(db, 't1', 'p1');
    const e1 = makeException({ id: 'a' });
    const e2 = makeException({ id: 'b' });
    await a.save(e1);
    await a.save({ ...e2, status: 'expired' });
    const list = await a.listActive();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  it('listByDomain filtra y permite combinar status', async () => {
    const db = createFakeFirestore();
    const a = new ExceptionAdapter(db, 't1', 'p1');
    await a.save(makeException({ id: 'a', domain: 'training_gap' }));
    await a.save(makeException({ id: 'b', domain: 'epp_expired' }));
    const list = await a.listByDomain('epp_expired');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('b');
  });

  it('listForSubject filtra por (kind, id) anidado', async () => {
    const db = createFakeFirestore();
    const a = new ExceptionAdapter(db, 't1', 'p1');
    await a.save(makeException({ id: 'a', subjectKind: 'WORKER', subjectId: 'w1' }));
    await a.save(makeException({ id: 'b', subjectKind: 'WORKER', subjectId: 'w2' }));
    await a.save(makeException({ id: 'c', subjectKind: 'EPP', subjectId: 'w1' }));
    const list = await a.listForSubject('WORKER', 'w1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  it('expireOverdue mueve active+validUntil<now a expired', async () => {
    const db = createFakeFirestore();
    const a = new ExceptionAdapter(db, 't1', 'p1');
    // Excepción que vence 12h después del start (08:00 + 12h = 20:00 mismo día)
    await a.save(makeException({ id: 'shortlived', durationHours: 12, now: '2026-05-11T08:00:00Z' }));
    // Excepción que vence 5 días después
    await a.save(makeException({ id: 'longlived', durationHours: 120, now: '2026-05-11T08:00:00Z' }));
    // Cron run el 2026-05-12 → solo shortlived debería expirar
    const count = await a.expireOverdue('2026-05-12T08:00:00Z');
    expect(count).toBe(1);
    const short = await a.getById('shortlived');
    const long = await a.getById('longlived');
    expect(short?.status).toBe('expired');
    expect(long?.status).toBe('active');
  });
});
