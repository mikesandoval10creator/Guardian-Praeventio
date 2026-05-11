import { describe, it, expect } from 'vitest';
import {
  analyzePunitiveLanguage,
  getInvestigationQuestions,
  getStarterQuestionnaire,
  appendTestimonyVersion,
  diffTestimonyVersions,
  appendTimelineMoment,
  findTimelineGaps,
  getPriorDecisions,
  type WitnessTestimony,
  type IncidentTimeline,
} from './noBlameInvestigation.js';

describe('analyzePunitiveLanguage', () => {
  it('detecta "culpa del trabajador"', () => {
    const r = analyzePunitiveLanguage('Fue culpa del trabajador por no revisar.');
    expect(r.needsRewrite).toBe(true);
    expect(r.flaggedPhrases.length).toBeGreaterThan(0);
    expect(r.suggestions[0]).toMatch(/sistémica|factores/i);
  });

  it('detecta "negligencia"', () => {
    const r = analyzePunitiveLanguage('Hubo negligencia evidente.');
    expect(r.needsRewrite).toBe(true);
  });

  it('detecta "error humano" como síntoma', () => {
    const r = analyzePunitiveLanguage('Se trató de un error humano simple.');
    expect(r.suggestions.some((s) => /diseño|presión|training/i.test(s))).toBe(true);
  });

  it('texto neutro pasa sin flags', () => {
    const r = analyzePunitiveLanguage(
      'El procedimiento no contemplaba esta condición climática específica.',
    );
    expect(r.needsRewrite).toBe(false);
    expect(r.flaggedPhrases).toEqual([]);
  });

  it('múltiples flags agrupan sugerencias sin duplicar', () => {
    const r = analyzePunitiveLanguage('Negligencia y error humano por no respetar las normas.');
    expect(r.flaggedPhrases.length).toBeGreaterThanOrEqual(2);
    // sugerencias únicas (sin duplicados)
    expect(new Set(r.suggestions).size).toBe(r.suggestions.length);
  });
});

describe('getInvestigationQuestions', () => {
  it('sin dimensión devuelve todo el banco', () => {
    expect(getInvestigationQuestions().length).toBeGreaterThanOrEqual(10);
  });

  it('filtra por dimensión específica', () => {
    const procQs = getInvestigationQuestions('procedure');
    expect(procQs.length).toBeGreaterThan(0);
    expect(procQs.every((q) => q.dimension === 'procedure')).toBe(true);
  });
});

describe('getStarterQuestionnaire', () => {
  it('una pregunta por dimensión, sin repetidos', () => {
    const starter = getStarterQuestionnaire();
    const dims = starter.map((q) => q.dimension);
    expect(new Set(dims).size).toBe(dims.length);
    expect(starter.length).toBeGreaterThanOrEqual(8);
  });
});

describe('Witness testimony versioning', () => {
  function makeTestimony(): WitnessTestimony {
    return {
      witnessUid: 'w1',
      relationToIncident: 'crewmate',
      versions: [
        {
          versionNumber: 1,
          capturedAt: '2026-05-11T10:00:00Z',
          text: 'El trabajador estaba operando la máquina cuando se escuchó un ruido fuerte.',
          consentGiven: true,
        },
      ],
    };
  }

  it('appendTestimonyVersion incrementa versionNumber', () => {
    const t = makeTestimony();
    const updated = appendTestimonyVersion(t, {
      capturedAt: '2026-05-12T10:00:00Z',
      text: 'En realidad no estaba operando, estaba inspeccionando.',
      consentGiven: true,
      revisionReason: 'Aclara después de revisar video',
    });
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[1].versionNumber).toBe(2);
  });

  it('diff detecta cambio significativo cuando similitud baja', () => {
    const v1 = {
      versionNumber: 1,
      capturedAt: 't1',
      text: 'El trabajador operaba la máquina con normalidad cuando ocurrió el evento.',
      consentGiven: true,
    };
    const v2 = {
      versionNumber: 2,
      capturedAt: 't2',
      text: 'Estaba inspeccionando previo al inicio sin operar todavía nada eléctrico.',
      consentGiven: true,
    };
    const diff = diffTestimonyVersions(v1, v2);
    expect(diff.hasSignificantChange).toBe(true);
    expect(diff.similarityPercent).toBeLessThan(60);
  });

  it('diff detecta versiones casi idénticas', () => {
    const v1 = {
      versionNumber: 1,
      capturedAt: 't1',
      text: 'estaba inspeccionando equipo electrico antes operar maniobra',
      consentGiven: true,
    };
    const v2 = {
      versionNumber: 2,
      capturedAt: 't2',
      text: 'estaba inspeccionando equipo electrico antes operar maniobra completa',
      consentGiven: true,
    };
    const diff = diffTestimonyVersions(v1, v2);
    expect(diff.hasSignificantChange).toBe(false);
  });
});

describe('IncidentTimeline', () => {
  function makeTimeline(): IncidentTimeline {
    return {
      incidentId: 'inc-1',
      moments: [
        {
          at: '2026-05-11T08:00:00Z',
          kind: 'pre_incident_decision',
          description: 'Se postergó mantención programada',
          priorDecision: { decisionMakerUid: 'sup1', rationale: 'Plazo cliente' },
        },
      ],
    };
  }

  it('appendTimelineMoment ordena por timestamp', () => {
    const t = makeTimeline();
    const updated = appendTimelineMoment(t, {
      at: '2026-05-11T07:00:00Z', // ANTES del existente
      kind: 'precondition_change',
      description: 'Cambio cuadrilla mañana',
    });
    expect(updated.moments[0].at).toBe('2026-05-11T07:00:00Z');
    expect(updated.moments[1].at).toBe('2026-05-11T08:00:00Z');
  });

  it('findTimelineGaps detecta gap inusual incident_trigger → response > 5min', () => {
    const t: IncidentTimeline = {
      incidentId: 'inc-1',
      moments: [
        { at: '2026-05-11T10:00:00Z', kind: 'incident_trigger', description: 'fallo' },
        { at: '2026-05-11T10:10:00Z', kind: 'response', description: 'evacuación' },
      ],
    };
    const gaps = findTimelineGaps(t);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapMinutes).toBe(10);
    expect(gaps[0].isUnusual).toBe(true);
  });

  it('gap razonable trigger → response no es inusual', () => {
    const t: IncidentTimeline = {
      incidentId: 'inc-1',
      moments: [
        { at: '2026-05-11T10:00:00Z', kind: 'incident_trigger', description: 'fallo' },
        { at: '2026-05-11T10:03:00Z', kind: 'response', description: 'evacuación' },
      ],
    };
    expect(findTimelineGaps(t)[0].isUnusual).toBe(false);
  });

  it('getPriorDecisions filtra solo decisiones previas', () => {
    const t: IncidentTimeline = {
      incidentId: 'inc-1',
      moments: [
        {
          at: '2026-05-10T08:00:00Z',
          kind: 'pre_incident_decision',
          description: 'Postergó mantención',
        },
        {
          at: '2026-05-11T07:00:00Z',
          kind: 'precondition_change',
          description: 'Cambio cuadrilla',
        },
        { at: '2026-05-11T10:00:00Z', kind: 'incident_trigger', description: 'fallo' },
      ],
    };
    const priors = getPriorDecisions(t);
    expect(priors).toHaveLength(2);
    expect(priors[0].at).toBe('2026-05-10T08:00:00Z'); // ordenado
  });
});
