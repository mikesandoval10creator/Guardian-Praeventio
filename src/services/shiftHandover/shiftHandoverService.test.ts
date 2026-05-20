import { describe, it, expect } from 'vitest';
import {
  startShift,
  logEntry,
  addHandoverNote,
  endShift,
  acknowledgeHandover,
  summarizeShift,
  HandoverValidationError,
} from './shiftHandoverService.js';

const NOW = new Date('2026-05-11T08:00:00Z');

describe('startShift', () => {
  it('crea shift con startedAt + sin entries', () => {
    const s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup-out',
      now: NOW,
    });
    expect(s.startedAt).toBe(NOW.toISOString());
    expect(s.logEntries).toEqual([]);
    expect(s.handoverNotes).toEqual([]);
  });
});

describe('logEntry', () => {
  it('agrega entry cronológica', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    s = logEntry(s, {
      authorUid: 'sup',
      authorRole: 'supervisor',
      text: 'Iniciado turno con sin observaciones',
      requiresFollowUp: false,
    });
    expect(s.logEntries).toHaveLength(1);
  });

  it('rechaza entry corta', () => {
    const s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    expect(() =>
      logEntry(s, {
        authorUid: 'sup',
        authorRole: 'supervisor',
        text: 'X',
        requiresFollowUp: false,
      }),
    ).toThrow(/ENTRY_TOO_SHORT/);
  });

  it('rechaza log después de end', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    s = endShift(s, new Date(NOW.getTime() + 3600 * 1000));
    expect(() =>
      logEntry(s, {
        authorUid: 'sup',
        authorRole: 'supervisor',
        text: 'tarde para esto',
        requiresFollowUp: false,
      }),
    ).toThrow(/SHIFT_ENDED/);
  });
});

describe('addHandoverNote', () => {
  it('agrega nota con severity', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    s = addHandoverNote(s, {
      category: 'equipment_down',
      text: 'Grúa H02 fuera de servicio',
      severity: 'urgent',
    });
    expect(s.handoverNotes).toHaveLength(1);
    expect(s.handoverNotes[0].severity).toBe('urgent');
  });

  it('rechaza nota después de end', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    s = endShift(s, NOW);
    expect(() =>
      addHandoverNote(s, {
        category: 'observation',
        text: 'tarde para esto',
        severity: 'info',
      }),
    ).toThrow(/SHIFT_ENDED/);
  });
});

describe('endShift', () => {
  it('marca endedAt', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    const end = new Date(NOW.getTime() + 8 * 3600_000);
    s = endShift(s, end);
    expect(s.endedAt).toBe(end.toISOString());
  });

  it('idempotente: segunda llamada no cambia endedAt', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    const end1 = new Date(NOW.getTime() + 8 * 3600_000);
    const end2 = new Date(NOW.getTime() + 10 * 3600_000);
    s = endShift(s, end1);
    s = endShift(s, end2);
    expect(s.endedAt).toBe(end1.toISOString());
  });
});

describe('acknowledgeHandover', () => {
  it('marca ack con incoming supervisor', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup-out',
      now: NOW,
    });
    s = endShift(s, new Date(NOW.getTime() + 8 * 3600_000));
    s = acknowledgeHandover(s, 'sup-in', 'Recibido sin novedad', new Date(NOW.getTime() + 8 * 3600_000 + 60_000));
    expect(s.acknowledgedByUid).toBe('sup-in');
    expect(s.acknowledgmentNotes).toContain('Recibido');
  });

  it('rechaza ack antes de end', () => {
    const s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    expect(() => acknowledgeHandover(s, 'sup-in', undefined, NOW)).toThrow(
      /SHIFT_NOT_ENDED/,
    );
  });

  it('rechaza ack con el MISMO supervisor saliente', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup-out',
      now: NOW,
    });
    s = endShift(s, NOW);
    expect(() => acknowledgeHandover(s, 'sup-out', undefined, NOW)).toThrow(
      /SAME_SUPERVISOR/,
    );
  });

  it('rechaza doble ack', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup-out',
      now: NOW,
    });
    s = endShift(s, NOW);
    s = acknowledgeHandover(s, 'sup-in', undefined, NOW);
    expect(() => acknowledgeHandover(s, 'sup-otro', undefined, NOW)).toThrow(
      /ALREADY_ACKNOWLEDGED/,
    );
  });
});

describe('summarizeShift', () => {
  it('cuenta entries + notes + duration', () => {
    let s = startShift({
      id: 's1',
      projectId: 'p1',
      kind: 'morning',
      supervisorUid: 'sup',
      now: NOW,
    });
    s = logEntry(s, {
      authorUid: 'sup',
      authorRole: 'supervisor',
      text: 'Iniciado turno operativo',
      requiresFollowUp: true,
    });
    s = addHandoverNote(s, {
      category: 'open_incidents',
      text: 'Incidente IN-42 abierto',
      severity: 'urgent',
    });
    const end = new Date(NOW.getTime() + 8 * 3600_000);
    s = endShift(s, end);
    const summary = summarizeShift(s, end);
    expect(summary.entriesCount).toBe(1);
    expect(summary.notesCount).toBe(1);
    expect(summary.urgentNotesCount).toBe(1);
    expect(summary.pendingFollowUps).toBe(1);
    expect(summary.durationMinutes).toBe(480); // 8h
    expect(summary.hasUnacknowledgedHandover).toBe(true);
  });
});
