import { describe, it, expect } from 'vitest';
import {
  buildMeetingSummary,
  buildSupervisorBriefingPack,
  extractActionItems,
  type MeetingSnapshot,
  type BriefingInputs,
} from './meetingPackBuilder.js';

const NOW = new Date('2026-05-13T10:00:00Z');

function makeSnapshot(over: Partial<MeetingSnapshot> = {}): MeetingSnapshot {
  return {
    meetingId: 'm-1',
    kind: 'cphs_monthly',
    scheduledFor: NOW.toISOString(),
    durationMinutes: 60,
    facilitatorUid: 'prev-1',
    attendees: [
      { uid: 'w1', name: 'Juan', role: 'worker', attended: true },
      { uid: 'w2', name: 'Maria', role: 'supervisor', attended: true },
      { uid: 'w3', name: 'Pedro', role: 'cphs', attended: false, absenceReason: 'vacaciones' },
    ],
    discussionPoints: [
      {
        id: 'd1',
        topic: 'Inspección torre norte',
        summary: 'Encontramos arnés vencido en cuadrilla 3.',
        decision: 'Reemplazar arnés esta semana.',
      },
      { id: 'd2', topic: 'Clima caluroso', summary: 'Discusión sobre WBGT.' },
    ],
    actionItems: [
      {
        description: 'Comprar arneses nuevos',
        assignedToUid: 'prev-1',
        dueDate: '2026-05-20',
        priority: 'high',
      },
    ],
    ...over,
  };
}

describe('buildMeetingSummary', () => {
  it('quorum cphs 67% ≥ 50% requerido → válido', () => {
    const s = buildMeetingSummary(makeSnapshot());
    expect(s.quorum.attended).toBe(2);
    expect(s.quorum.invited).toBe(3);
    expect(s.quorumValid).toBe(true);
  });

  it('decisions extraídas de discussion points', () => {
    const s = buildMeetingSummary(makeSnapshot());
    expect(s.decisions).toHaveLength(1);
    expect(s.decisions[0]?.topic).toContain('torre norte');
  });

  it('absentees listados', () => {
    const s = buildMeetingSummary(makeSnapshot());
    expect(s.absentees).toHaveLength(1);
    expect(s.absentees[0]?.uid).toBe('w3');
  });

  it('quorum insuficiente → requiresFollowUp', () => {
    const s = buildMeetingSummary(
      makeSnapshot({
        kind: 'pre_shift_briefing', // requiere 80%
        attendees: [
          { uid: 'w1', name: 'a', role: 'worker', attended: true },
          { uid: 'w2', name: 'b', role: 'worker', attended: false },
          { uid: 'w3', name: 'c', role: 'worker', attended: false },
        ],
      }),
    );
    expect(s.quorumValid).toBe(false);
    expect(s.requiresFollowUp).toBe(true);
    expect(s.followUpReasons.some((r) => /Quorum/i.test(r))).toBe(true);
  });

  it('action sin asignar → requiresFollowUp', () => {
    const s = buildMeetingSummary(
      makeSnapshot({
        actionItems: [
          { description: 'Tarea pendiente', assignedToUid: '', dueDate: '', priority: 'medium' },
        ],
      }),
    );
    expect(s.requiresFollowUp).toBe(true);
  });

  it('action critical → requiresFollowUp', () => {
    const s = buildMeetingSummary(
      makeSnapshot({
        actionItems: [
          { description: 'Tarea urgente', assignedToUid: 'sup-1', dueDate: '2026-05-15', priority: 'critical' },
        ],
      }),
    );
    expect(s.requiresFollowUp).toBe(true);
    expect(s.followUpReasons.some((r) => /crítica/i.test(r))).toBe(true);
  });
});

describe('buildSupervisorBriefingPack', () => {
  const baseInput: BriefingInputs = {
    supervisorUid: 'sup-1',
    projectId: 'p1',
    shiftStart: '2026-05-13T07:00:00Z',
    workersAssigned: [
      { uid: 'w1', name: 'Juan', role: 'worker' },
      { uid: 'w2', name: 'Maria', role: 'worker', fatigueLevel: 'high' },
      { uid: 'w3', name: 'Pedro', role: 'worker', expiredCerts: ['altura_r1'] },
    ],
    criticalRisksForToday: [],
    pendingActions: [],
  };

  it('headline por defecto si todo OK', () => {
    const p = buildSupervisorBriefingPack({
      ...baseInput,
      workersAssigned: [{ uid: 'w1', name: 'a', role: 'w' }],
    });
    expect(p.headline).toMatch(/Turno/);
  });

  it('SIF risks → headline warning + in-person required', () => {
    const p = buildSupervisorBriefingPack({
      ...baseInput,
      criticalRisksForToday: [{ id: 'r1', description: 'Trabajo altura sin línea vida', severity: 'sif' }],
    });
    expect(p.headline).toMatch(/SIF/);
    expect(p.inPersonHandoverRequired).toBe(true);
  });

  it('flaggedWorkers detecta restricciones + fatigue + expired_cert', () => {
    const p = buildSupervisorBriefingPack({
      ...baseInput,
      workersAssigned: [
        { uid: 'w1', name: 'A', role: 'w', activeRestrictions: ['no_height_work'] },
        { uid: 'w2', name: 'B', role: 'w', fatigueLevel: 'critical' },
        { uid: 'w3', name: 'C', role: 'w', expiredCerts: ['altura_r1'] },
      ],
    });
    expect(p.flaggedWorkers).toHaveLength(3);
    expect(p.flaggedWorkers.map((f) => f.flagKind).sort()).toEqual([
      'expired_cert',
      'fatigue',
      'restriction',
    ]);
  });

  it('weather hot/cold/uv → advisory + recommendation', () => {
    const p = buildSupervisorBriefingPack({
      ...baseInput,
      weather: { temperatureC: 35, uvIndex: 9 },
    });
    expect(p.weatherAdvisory).toMatch(/Calor extremo/);
    expect(p.weatherAdvisory).toMatch(/UV 9/);
    expect(p.recommendations.some((r) => /clima/i.test(r))).toBe(true);
  });

  it('inPersonHandoverRequired con 2+ critical risks', () => {
    const p = buildSupervisorBriefingPack({
      ...baseInput,
      criticalRisksForToday: [
        { id: 'r1', description: 'r1', severity: 'critical' },
        { id: 'r2', description: 'r2', severity: 'critical' },
      ],
    });
    expect(p.inPersonHandoverRequired).toBe(true);
  });

  it('recomendaciones limitadas a 7', () => {
    const p = buildSupervisorBriefingPack({
      ...baseInput,
      workersAssigned: Array.from({ length: 10 }, (_, i) => ({
        uid: `w${i}`,
        name: `n${i}`,
        role: 'w',
        fatigueLevel: 'critical' as const,
        expiredCerts: ['altura_r1'],
      })),
      criticalRisksForToday: [
        { id: 'r1', description: 'r1', severity: 'critical' },
        { id: 'r2', description: 'r2', severity: 'sif' },
      ],
      pendingActions: Array.from({ length: 20 }, (_, i) => ({
        id: `a${i}`,
        description: `action ${i}`,
        dueDate: '2026-05-15',
      })),
      weather: { temperatureC: 38 },
    });
    expect(p.recommendations.length).toBeLessThanOrEqual(7);
  });
});

describe('extractActionItems', () => {
  it('detecta "debemos comprar X"', () => {
    const items = extractActionItems('Debemos comprar arneses nuevos');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.description).toMatch(/comprar/);
  });

  it('detecta "queda pendiente X"', () => {
    const items = extractActionItems('Queda pendiente revisar el panel eléctrico');
    expect(items.length).toBeGreaterThan(0);
  });

  it('detecta "acción: X"', () => {
    const items = extractActionItems('Acción: enviar el reporte el viernes');
    expect(items[0]?.confidence).toBeGreaterThan(0.9);
  });

  it('detecta "acordamos X"', () => {
    const items = extractActionItems('Acordamos cambiar el procedimiento de trabajo en altura');
    expect(items.length).toBeGreaterThan(0);
  });

  it('extrae @uid si presente', () => {
    const items = extractActionItems('Debemos coordinar con @juan la inspección');
    expect(items[0]?.proposedAssigneeUid).toBe('juan');
  });

  it('extrae fecha ISO si presente', () => {
    const items = extractActionItems('Acordamos completar antes del 2026-05-20');
    expect(items[0]?.proposedDueDate).toBe('2026-05-20');
  });

  it('texto sin triggers → vacío', () => {
    const items = extractActionItems('La reunión fue muy productiva. Felicidades.');
    expect(items).toHaveLength(0);
  });

  it('múltiples líneas con triggers → múltiples items', () => {
    const items = extractActionItems(
      'Acción: revisar arnés. Queda pendiente firmar el acta. Acordamos próxima reunión el viernes.',
    );
    expect(items.length).toBeGreaterThanOrEqual(2);
  });
});
