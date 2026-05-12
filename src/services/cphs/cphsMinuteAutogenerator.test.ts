import { describe, it, expect } from 'vitest';
import {
  buildMonthlyMinuteDraft,
  type MonthlyInputs,
} from './cphsMinuteAutogenerator.js';

function inputs(over: Partial<MonthlyInputs> = {}): MonthlyInputs {
  return {
    projectId: 'p1',
    period: '2026-05',
    companyName: 'Constructora Andes',
    incidents: [],
    correctiveActions: [],
    trainingsCompleted: [],
    inspectionsCompleted: 0,
    complianceTrafficLightScore: 75,
    legalRecommendations: [],
    expectedAttendees: ['rep-empresa-1', 'rep-trabajador-1'],
    ...over,
  };
}

describe('buildMonthlyMinuteDraft', () => {
  it('header incluye empresa, período y semáforo', () => {
    const draft = buildMonthlyMinuteDraft(inputs());
    expect(draft.markdown).toMatch(/Constructora Andes/);
    expect(draft.markdown).toMatch(/2026-05/);
    expect(draft.markdown).toMatch(/🟡 amarillo/);
  });

  it('semáforo verde con score >= 80', () => {
    const draft = buildMonthlyMinuteDraft(inputs({ complianceTrafficLightScore: 90 }));
    expect(draft.markdown).toMatch(/🟢 verde/);
  });

  it('semáforo rojo con score < 60', () => {
    const draft = buildMonthlyMinuteDraft(inputs({ complianceTrafficLightScore: 50 }));
    expect(draft.markdown).toMatch(/🔴 rojo/);
  });

  it('lista incidentes y marca causa pendiente', () => {
    const draft = buildMonthlyMinuteDraft(
      inputs({
        incidents: [
          { id: 'i1', severity: 'high', description: 'caída desde altura 2m', rootCauseKnown: false },
          { id: 'i2', severity: 'low', description: 'corte menor', rootCauseKnown: true },
        ],
      }),
    );
    expect(draft.markdown).toMatch(/caída desde altura 2m/);
    expect(draft.markdown).toMatch(/causa raíz pendiente/);
    expect(draft.metrics.incidentsCount).toBe(2);
    expect(draft.metrics.criticalIncidentsCount).toBe(1);
  });

  it('cuenta acciones abiertas vs cerradas correctamente', () => {
    const draft = buildMonthlyMinuteDraft(
      inputs({
        correctiveActions: [
          { id: 'a1', status: 'open', label: 'reparar baranda' },
          { id: 'a2', status: 'in_progress', label: 'capacitar' },
          { id: 'a3', status: 'closed', label: 'cambiar EPP' },
          { id: 'a4', status: 'verified_effective', label: 'inspeccion semanal' },
        ],
      }),
    );
    expect(draft.metrics.openActionsCount).toBe(2);
    expect(draft.metrics.closedActionsCount).toBe(2);
    expect(draft.markdown).toMatch(/Abiertas: \*\*2\*\*/);
  });

  it('acepta status "verified" (legacy F.4) como cerrada — Codex P2 PR #95', () => {
    const draft = buildMonthlyMinuteDraft(
      inputs({
        correctiveActions: [
          { id: 'a1', status: 'verified', label: 'legacy verified' },
          { id: 'a2', status: 'verified_effective', label: 'nuevo verified' },
          { id: 'a3', status: 'open', label: 'abierta' },
        ],
      }),
    );
    expect(draft.metrics.openActionsCount).toBe(1);
    expect(draft.metrics.closedActionsCount).toBe(2);
  });

  it('totaliza participantes de capacitaciones', () => {
    const draft = buildMonthlyMinuteDraft(
      inputs({
        trainingsCompleted: [
          { title: 'Trabajo en altura', participantsCount: 12 },
          { title: 'Manejo manual', participantsCount: 8 },
        ],
      }),
    );
    expect(draft.metrics.trainingParticipantsTotal).toBe(20);
    expect(draft.markdown).toMatch(/Trabajo en altura — 12 participantes/);
  });

  it('sugiere investigación para incidentes high/critical', () => {
    const draft = buildMonthlyMinuteDraft(
      inputs({
        incidents: [{ id: 'i1', severity: 'critical', description: 'electrocución', rootCauseKnown: true }],
      }),
    );
    const investigationResolution = draft.suggestedResolutions.find((r) =>
      /Investigación raíz formal/.test(r.text),
    );
    expect(investigationResolution).toBeDefined();
  });

  it('sugiere plan mejora cuando semáforo rojo', () => {
    const draft = buildMonthlyMinuteDraft(inputs({ complianceTrafficLightScore: 40 }));
    const rec = draft.suggestedResolutions.find((r) =>
      /Plan de mejora cumplimiento/.test(r.text),
    );
    expect(rec).toBeDefined();
  });

  it('agrega cada legalRecommendation como resolución', () => {
    const draft = buildMonthlyMinuteDraft(
      inputs({
        legalRecommendations: ['Crear CPHS porque empresa ≥25 trabajadores'],
      }),
    );
    const rec = draft.suggestedResolutions.find((r) => /Crear CPHS/.test(r.text));
    expect(rec).toBeDefined();
  });

  it('completenessScore alto con todos los datos', () => {
    const draft = buildMonthlyMinuteDraft(
      inputs({
        incidents: [{ id: 'i', severity: 'low', description: 'x', rootCauseKnown: true }],
        correctiveActions: [{ id: 'a', status: 'closed', label: 'x' }],
        trainingsCompleted: [{ title: 't', participantsCount: 10 }],
        inspectionsCompleted: 5,
        legalRecommendations: ['x'],
      }),
    );
    expect(draft.completenessScore).toBeGreaterThanOrEqual(80);
  });

  it('completenessScore bajo con input mínimo', () => {
    const draft = buildMonthlyMinuteDraft(
      inputs({
        complianceTrafficLightScore: 0,
        expectedAttendees: [],
        companyName: '',
      }),
    );
    expect(draft.completenessScore).toBeLessThan(50);
  });

  it('sections list incluye encabezado + asistentes + incidentes + acciones + capacitaciones + inspecciones + acuerdos', () => {
    const draft = buildMonthlyMinuteDraft(inputs());
    expect(draft.sections).toContain('Encabezado');
    expect(draft.sections).toContain('Asistentes');
    expect(draft.sections).toContain('Incidentes');
    expect(draft.sections).toContain('Acciones correctivas');
    expect(draft.sections).toContain('Capacitaciones');
    expect(draft.sections).toContain('Inspecciones');
    expect(draft.sections).toContain('Acuerdos sugeridos');
  });

  it('footer presente con disclaimer borrador', () => {
    const draft = buildMonthlyMinuteDraft(inputs());
    expect(draft.markdown).toMatch(/Borrador generado por Praeventio/);
  });

  it('sin incidentes muestra mensaje explícito', () => {
    const draft = buildMonthlyMinuteDraft(inputs());
    expect(draft.markdown).toMatch(/Sin incidentes registrados/);
  });
});
