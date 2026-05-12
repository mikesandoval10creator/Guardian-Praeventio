import { describe, it, expect } from 'vitest';
import { ShiftHandoverAdapter } from './shiftHandoverFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import {
  startShift,
  endShift,
  logEntry,
  acknowledgeHandover,
} from './shiftHandoverService.js';

function makeShift(id = 's1', supervisorUid = 'sup-1', startedAt = '2026-05-11T08:00:00Z') {
  return startShift({
    id,
    projectId: 'p1',
    kind: 'morning',
    supervisorUid,
    now: new Date(startedAt),
  });
}

describe('ShiftHandoverAdapter', () => {
  it('save + getById persiste y recupera shift', async () => {
    const db = createFakeFirestore();
    const a = new ShiftHandoverAdapter(db, 't1', 'p1');
    const s = makeShift();
    await a.save(s);
    const got = await a.getById('s1');
    expect(got?.id).toBe('s1');
    expect(got?.kind).toBe('morning');
  });

  it('save preserva logEntries y handoverNotes', async () => {
    const db = createFakeFirestore();
    const a = new ShiftHandoverAdapter(db, 't1', 'p1');
    let s = makeShift();
    s = logEntry(s, {
      authorUid: 'sup-1',
      authorRole: 'supervisor',
      text: 'Equipo XK-12 detenido por mantención no planificada',
      requiresFollowUp: true,
    });
    await a.save(s);
    const got = await a.getById('s1');
    expect(got?.logEntries).toHaveLength(1);
    expect(got?.logEntries[0].requiresFollowUp).toBe(true);
  });

  it('listForSupervisor filtra y ordena por startedAt desc', async () => {
    const db = createFakeFirestore();
    const a = new ShiftHandoverAdapter(db, 't1', 'p1');
    await a.save(makeShift('old', 'sup-1', '2026-05-10T08:00:00Z'));
    await a.save(makeShift('new', 'sup-1', '2026-05-11T08:00:00Z'));
    await a.save(makeShift('other', 'sup-2', '2026-05-11T08:00:00Z'));
    const list = await a.listForSupervisor('sup-1');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('new');
    expect(list[1].id).toBe('old');
  });

  it('listUnacknowledged solo devuelve turnos cerrados sin ack', async () => {
    const db = createFakeFirestore();
    const a = new ShiftHandoverAdapter(db, 't1', 'p1');
    // Caso 1: turno en curso (no cerrado) — no debe aparecer
    await a.save(makeShift('inflight', 'sup-1'));
    // Caso 2: cerrado pero sin ack — DEBE aparecer
    const closed = endShift(makeShift('closed', 'sup-1'), new Date('2026-05-11T16:00:00Z'));
    await a.save(closed);
    // Caso 3: cerrado + ack — no debe aparecer
    const closedAcked = acknowledgeHandover(
      endShift(makeShift('acked', 'sup-1'), new Date('2026-05-11T16:00:00Z')),
      'sup-2',
      undefined,
      new Date('2026-05-11T16:05:00Z'),
    );
    await a.save(closedAcked);
    const list = await a.listUnacknowledged();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('closed');
  });
});
