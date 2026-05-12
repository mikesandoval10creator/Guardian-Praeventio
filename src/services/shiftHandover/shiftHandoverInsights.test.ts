import { describe, it, expect } from 'vitest';
import {
  computeHandoverQuality,
  detectContinuityIssues,
  extractUrgentForIncoming,
} from './shiftHandoverInsights.js';
import { startShift, logEntry, addHandoverNote, endShift, acknowledgeHandover } from './shiftHandoverService.js';

function makeShift(id = 's1') {
  return startShift({
    id,
    projectId: 'p1',
    kind: 'morning',
    supervisorUid: id === 's1' ? 'sup1' : 'sup2',
    now: new Date('2026-05-11T06:00:00Z'),
  });
}

describe('computeHandoverQuality', () => {
  it('shift sin notas → poor', () => {
    const r = computeHandoverQuality(makeShift());
    expect(r.level).toBe('poor');
  });

  it('shift con todas las críticas → excellent', () => {
    let s = makeShift();
    for (const cat of [
      'open_incidents',
      'equipment_down',
      'pending_controls',
      'active_permits',
    ] as const) {
      s = addHandoverNote(s, {
        category: cat,
        text: 'note relevante para handover',
        severity: 'info',
      });
    }
    const r = computeHandoverQuality(s);
    expect(r.level).toBe('excellent');
    expect(r.missingCriticalCategories).toEqual([]);
  });

  it('cuenta urgentNotes correctamente', () => {
    let s = makeShift();
    s = addHandoverNote(s, {
      category: 'open_incidents',
      text: 'incidente alta severidad',
      severity: 'urgent',
    });
    s = addHandoverNote(s, {
      category: 'equipment_down',
      text: 'equipo bajado',
      severity: 'attention',
    });
    expect(computeHandoverQuality(s).urgentNotes).toBe(1);
  });
});

describe('detectContinuityIssues', () => {
  it('unacknowledged → issue', () => {
    const outgoing = endShift(makeShift('s1'), new Date('2026-05-11T14:00:00Z'));
    const incoming = makeShift('s2');
    const issues = detectContinuityIssues(outgoing, incoming);
    expect(issues.some((i) => i.kind === 'unacknowledged_handover')).toBe(true);
  });

  it('silent_handover si hay followups sin notas', () => {
    let outgoing = makeShift('s1');
    outgoing = logEntry(outgoing, {
      authorUid: 'sup1',
      authorRole: 'supervisor',
      text: 'evento operacional importante',
      requiresFollowUp: true,
    });
    outgoing = endShift(outgoing, new Date('2026-05-11T14:00:00Z'));
    outgoing = acknowledgeHandover(outgoing, 'sup2', undefined, new Date('2026-05-11T14:05:00Z'));
    const incoming = makeShift('s2');
    const issues = detectContinuityIssues(outgoing, incoming);
    expect(issues.some((i) => i.kind === 'silent_handover')).toBe(true);
  });

  it('OK si todo está en orden', () => {
    let outgoing = makeShift('s1');
    outgoing = addHandoverNote(outgoing, {
      category: 'open_incidents',
      text: 'note completa',
      severity: 'info',
    });
    outgoing = endShift(outgoing, new Date('2026-05-11T14:00:00Z'));
    outgoing = acknowledgeHandover(outgoing, 'sup2', undefined, new Date('2026-05-11T14:05:00Z'));
    let incoming = makeShift('s2');
    incoming = logEntry(incoming, {
      authorUid: 'sup2',
      authorRole: 'supervisor',
      text: 'continuación de la operación',
      requiresFollowUp: false,
    });
    const issues = detectContinuityIssues(outgoing, incoming);
    expect(issues).toEqual([]);
  });
});

describe('extractUrgentForIncoming', () => {
  it('filtra solo notas urgent', () => {
    let s = makeShift();
    s = addHandoverNote(s, { category: 'open_incidents', text: 'nota urgente x', severity: 'urgent' });
    s = addHandoverNote(s, { category: 'equipment_down', text: 'nota normal y', severity: 'info' });
    const r = extractUrgentForIncoming(s);
    expect(r.urgentNotes).toHaveLength(1);
  });
});
