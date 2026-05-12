import { describe, it, expect } from 'vitest';
import {
  extractTransferableLessons,
  buildSummary,
  validateClosureReadiness,
  type ProjectClosureSnapshot,
  type CriticalDecision,
} from './projectClosureService.js';

function snapshot(over: Partial<ProjectClosureSnapshot> = {}): ProjectClosureSnapshot {
  return {
    projectId: 'p1',
    closedAt: '2026-05-11T10:00:00Z',
    closedByUid: 'admin1',
    totalIncidents: 5,
    criticalIncidents: 1,
    preventedIncidentsEstimated: 12,
    totalActionsCompleted: 30,
    totalSitebookEntries: 200,
    totalTrainingHours: 450,
    averageComplianceScore: 85,
    criticalDecisions: [],
    transferableLessons: [],
    retentionRecommendations: [],
    improvementOpportunities: [],
    ...over,
  };
}

describe('extractTransferableLessons', () => {
  it('genera lección de decisiones positivas', () => {
    const decisions: CriticalDecision[] = [
      {
        id: 'd1',
        decidedAt: '2026-04-01',
        context: 'Reasignar cuadrilla por fatiga',
        decision: 'Cambio de turno preventivo',
        decidedByUid: 'sup1',
        outcome: 'positive',
      },
      {
        id: 'd2',
        decidedAt: '2026-04-02',
        context: 'Autorizar trabajo bajo lluvia',
        decision: 'Suspender hasta mejorar clima',
        decidedByUid: 'sup1',
        outcome: 'negative',
      },
    ];
    const lessons = extractTransferableLessons({
      criticalDecisions: decisions,
      projectId: 'p1',
      industry: 'mining',
    });
    expect(lessons).toHaveLength(1);
    expect(lessons[0].industry).toBe('mining');
  });
});

describe('buildSummary', () => {
  it('management resumen incluye compliance + incidentes', () => {
    const s = buildSummary('management', snapshot());
    expect(s.audience).toBe('management');
    expect(s.highlights.some((h) => /Compliance/.test(h.label))).toBe(true);
  });

  it('client resumen orientado a obligaciones contractuales', () => {
    const s = buildSummary('client', snapshot());
    expect(s.narrative).toMatch(/contractuales/i);
  });

  it('regulatory resumen apunta a Ley 16.744', () => {
    const s = buildSummary('regulatory', snapshot());
    expect(s.narrative).toMatch(/16\.744/);
  });
});

describe('validateClosureReadiness', () => {
  it('bloquea si hay incidentes abiertos', () => {
    const r = validateClosureReadiness({
      pendingOpenIncidents: 1,
      pendingOpenActions: 0,
      pendingOpenPermits: 0,
      hasFinalReport: true,
      unconfirmedSpofs: 0,
    });
    expect(r.canClose).toBe(false);
    expect(r.blockers.some((b) => /incidente/i.test(b))).toBe(true);
  });

  it('autoriza si todo OK', () => {
    const r = validateClosureReadiness({
      pendingOpenIncidents: 0,
      pendingOpenActions: 0,
      pendingOpenPermits: 0,
      hasFinalReport: true,
      unconfirmedSpofs: 0,
    });
    expect(r.canClose).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('genera warning si falta informe final', () => {
    const r = validateClosureReadiness({
      pendingOpenIncidents: 0,
      pendingOpenActions: 0,
      pendingOpenPermits: 0,
      hasFinalReport: false,
      unconfirmedSpofs: 2,
    });
    expect(r.canClose).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
