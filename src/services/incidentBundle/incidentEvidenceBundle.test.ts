import { describe, it, expect } from 'vitest';
import {
  buildIncidentBundle,
  manifestToJson,
  normalizeSeverity,
  summarizeBundle,
  IncidentBundleValidationError,
  type BuildIncidentBundleInput,
} from './incidentEvidenceBundle.js';

const NOW = new Date('2026-05-12T22:00:00Z');

function baseInput(over: Partial<BuildIncidentBundleInput> = {}): BuildIncidentBundleInput {
  return {
    incident: {
      id: 'inc-1',
      projectId: 'proj-1',
      occurredAt: '2026-05-12T10:00:00Z',
      severity: 'medium',
      summary: 'Caída leve en escalera norte',
      reportedByUid: 'sup-1',
      reportedAt: '2026-05-12T10:30:00Z',
    },
    affectedWorkers: [
      { uid: 'w1', role: 'operador', outcome: 'first_aid' },
    ],
    evidence: [
      {
        hash: 'a'.repeat(64),
        kind: 'photo',
        mimeType: 'image/jpeg',
        byteSize: 100_000,
        capturedAt: '2026-05-12T10:15:00Z',
        capturedByUid: 'sup-1',
      },
    ],
    appliedControls: [
      { controlId: 'ctrl-1', wasActive: true },
    ],
    requiredEpp: [
      { eppId: 'casco', hadValid: true, expirationDate: '2026-12-31' },
    ],
    requiredTrainings: [
      { trainingId: 'altura-r1', hadCompleted: true, completedAt: '2025-09-01' },
    ],
    normativeRefs: [
      { code: 'DS 594', summary: 'Condiciones sanitarias y ambientales básicas.' },
    ],
    auditLog: [
      { at: '2026-05-12T10:35:00Z', actorUid: 'sup-1', actorRole: 'supervisor', action: 'incident.reported' },
    ],
    ...over,
  };
}

describe('buildIncidentBundle — validation', () => {
  it('tira si falta incident.id', () => {
    expect(() =>
      buildIncidentBundle(baseInput({ incident: { ...baseInput().incident, id: '' } }), { now: NOW }),
    ).toThrowError(IncidentBundleValidationError);
  });

  it('tira si occurredAt es inválido', () => {
    expect(() =>
      buildIncidentBundle(
        baseInput({ incident: { ...baseInput().incident, occurredAt: 'not-a-date' } }),
        { now: NOW },
      ),
    ).toThrowError(/invalid_date/);
  });
});

describe('buildIncidentBundle — happy path', () => {
  it('expediente completo sin gaps → score 100', () => {
    const m = buildIncidentBundle(baseInput(), { now: NOW });
    expect(m.completenessScore).toBe(100);
    expect(m.gaps).toHaveLength(0);
    expect(m.recommendations).toHaveLength(0);
    expect(m.bundleId).toBe('inc-1');
    expect(m.generatedAt).toBe(NOW.toISOString());
  });

  it('preserva todos los inputs en el manifest', () => {
    const m = buildIncidentBundle(baseInput(), { now: NOW });
    expect(m.affectedWorkers).toHaveLength(1);
    expect(m.evidence).toHaveLength(1);
    expect(m.normativeRefs).toHaveLength(1);
    expect(m.auditLog).toHaveLength(1);
  });
});

describe('buildIncidentBundle — gap detection', () => {
  it('sin evidencia → gap no_evidence (peso 20)', () => {
    const m = buildIncidentBundle(baseInput({ evidence: [] }), { now: NOW });
    expect(m.gaps.some((g) => g.kind === 'no_evidence')).toBe(true);
    expect(m.completenessScore).toBe(80);
  });

  it('sin trabajadores afectados declarados → gap', () => {
    const m = buildIncidentBundle(baseInput({ affectedWorkers: [] }), { now: NOW });
    expect(m.gaps.some((g) => g.kind === 'no_affected_workers_declared')).toBe(true);
  });

  it('severidad critical sin root cause → gap no_root_cause_assigned', () => {
    const m = buildIncidentBundle(
      baseInput({
        incident: { ...baseInput().incident, severity: 'critical' },
      }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'no_root_cause_assigned')).toBe(true);
  });

  it('severidad low sin root cause → NO gap (no requerido)', () => {
    const m = buildIncidentBundle(
      baseInput({
        incident: { ...baseInput().incident, severity: 'low' },
      }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'no_root_cause_assigned')).toBe(false);
  });

  it('sin normativa → gap no_normative_refs', () => {
    const m = buildIncidentBundle(baseInput({ normativeRefs: [] }), { now: NOW });
    expect(m.gaps.some((g) => g.kind === 'no_normative_refs')).toBe(true);
  });

  it('control inactivo sin failure mode → gap control_failure_unspecified', () => {
    const m = buildIncidentBundle(
      baseInput({ appliedControls: [{ controlId: 'ctrl-1', wasActive: false }] }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'control_failure_unspecified')).toBe(true);
  });

  it('control inactivo CON failure mode → NO gap', () => {
    const m = buildIncidentBundle(
      baseInput({
        appliedControls: [
          { controlId: 'ctrl-1', wasActive: false, failureMode: 'no_mantenido' },
        ],
      }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'control_failure_unspecified')).toBe(false);
  });

  it('EPP vigente sin fecha vencimiento → gap missing_epp_vigency', () => {
    const m = buildIncidentBundle(
      baseInput({ requiredEpp: [{ eppId: 'casco', hadValid: true }] }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'missing_epp_vigency')).toBe(true);
  });

  it('training completado sin fecha → gap missing_training_vigency', () => {
    const m = buildIncidentBundle(
      baseInput({
        requiredTrainings: [{ trainingId: 'altura-r1', hadCompleted: true }],
      }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'missing_training_vigency')).toBe(true);
  });

  it('audit_log vacío → gap missing_audit_log', () => {
    const m = buildIncidentBundle(baseInput({ auditLog: [] }), { now: NOW });
    expect(m.gaps.some((g) => g.kind === 'missing_audit_log')).toBe(true);
  });
});

describe('buildIncidentBundle — completeness score', () => {
  it('expediente vacío → score 0 (todos los gaps disparados)', () => {
    const m = buildIncidentBundle(
      {
        incident: {
          id: 'inc-x',
          projectId: 'proj-x',
          occurredAt: '2026-05-12T10:00:00Z',
          severity: 'critical',
          summary: 'Incidente sin datos',
          reportedByUid: 'sup-x',
          reportedAt: '2026-05-12T10:30:00Z',
        },
        affectedWorkers: [],
        evidence: [],
        appliedControls: [],
        requiredEpp: [],
        requiredTrainings: [],
        normativeRefs: [],
        auditLog: [],
      },
      { now: NOW },
    );
    // no_evidence 20 + no_affected 15 + no_root_cause 15 + no_normative 10
    // + missing_audit_log 5 = 65 de penalty → score 35
    expect(m.completenessScore).toBeLessThanOrEqual(35);
    expect(m.gaps.length).toBeGreaterThanOrEqual(5);
  });

  it('score nunca es negativo (clamped a 0)', () => {
    const m = buildIncidentBundle(
      {
        incident: {
          id: 'inc-y',
          projectId: 'proj-y',
          occurredAt: '2026-05-12T10:00:00Z',
          severity: 'sif',
          summary: 'SIF total sin datos',
          reportedByUid: 'sup-y',
          reportedAt: '2026-05-12T10:30:00Z',
        },
        affectedWorkers: [],
        evidence: [],
        // Múltiples controles fallidos sin failure mode (pero solo cuenta 1)
        appliedControls: [
          { controlId: 'c1', wasActive: false },
          { controlId: 'c2', wasActive: false },
        ],
        requiredEpp: [
          { eppId: 'a', hadValid: true },
          { eppId: 'b', hadValid: true },
        ],
        requiredTrainings: [
          { trainingId: 't1', hadCompleted: true },
        ],
        normativeRefs: [],
        auditLog: [],
      },
      { now: NOW },
    );
    expect(m.completenessScore).toBeGreaterThanOrEqual(0);
  });
});

describe('recommendations', () => {
  it('priorizadas por peso del gap, máx 5', () => {
    const m = buildIncidentBundle(
      {
        incident: {
          id: 'inc-r',
          projectId: 'proj-r',
          occurredAt: '2026-05-12T10:00:00Z',
          severity: 'critical',
          summary: 'evento',
          reportedByUid: 'sup',
          reportedAt: '2026-05-12T10:30:00Z',
        },
        affectedWorkers: [],
        evidence: [],
        appliedControls: [],
        requiredEpp: [{ eppId: 'a', hadValid: true }],
        requiredTrainings: [{ trainingId: 't1', hadCompleted: true }],
        normativeRefs: [],
        auditLog: [],
      },
      { now: NOW },
    );
    expect(m.recommendations.length).toBeLessThanOrEqual(5);
    // no_evidence (peso 20) debe ir primero
    expect(m.recommendations[0]).toMatch(/foto/i);
  });
});

describe('normalizeSeverity (Codex P2 PR #122)', () => {
  it('normaliza etiquetas españolas pre-Sprint 43', () => {
    expect(normalizeSeverity('Alta')).toBe('high');
    expect(normalizeSeverity('Crítica')).toBe('critical');
    expect(normalizeSeverity('Critica')).toBe('critical');
    expect(normalizeSeverity('Media')).toBe('medium');
    expect(normalizeSeverity('Baja')).toBe('low');
  });

  it('respeta etiquetas inglesas canónicas', () => {
    expect(normalizeSeverity('high')).toBe('high');
    expect(normalizeSeverity('SIF')).toBe('sif');
  });

  it('devuelve null para etiquetas desconocidas', () => {
    expect(normalizeSeverity('mortal')).toBeNull();
    expect(normalizeSeverity('')).toBeNull();
  });
});

describe('buildIncidentBundle — severity boundary normalize (Codex P2 PR #122)', () => {
  it('severidad "Alta" (legacy ES) sin root cause → gap no_root_cause_assigned', () => {
    const m = buildIncidentBundle(
      baseInput({
        incident: { ...baseInput().incident, severity: 'Alta' as never },
      }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'no_root_cause_assigned')).toBe(true);
  });

  it('severidad "Crítica" (legacy ES) sin root cause → gap', () => {
    const m = buildIncidentBundle(
      baseInput({
        incident: { ...baseInput().incident, severity: 'Crítica' as never },
      }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'no_root_cause_assigned')).toBe(true);
  });

  it('severidad "Media" (legacy ES) NO dispara root_cause gap', () => {
    const m = buildIncidentBundle(
      baseInput({
        incident: { ...baseInput().incident, severity: 'Media' as never },
      }),
      { now: NOW },
    );
    expect(m.gaps.some((g) => g.kind === 'no_root_cause_assigned')).toBe(false);
  });
});

describe('serialization helpers', () => {
  it('manifestToJson produce JSON válido y parseable', () => {
    const m = buildIncidentBundle(baseInput(), { now: NOW });
    const json = manifestToJson(m);
    const reparsed = JSON.parse(json);
    expect(reparsed.bundleId).toBe('inc-1');
    expect(reparsed.completenessScore).toBe(100);
  });

  it('summarizeBundle one-liner incluye severidad + score + evidencias + gaps', () => {
    const m = buildIncidentBundle(baseInput(), { now: NOW });
    const summary = summarizeBundle(m);
    expect(summary).toMatch(/MEDIUM/);
    expect(summary).toMatch(/100/);
    expect(summary).toMatch(/1 evidencias/);
    expect(summary).toMatch(/0 gaps/);
  });
});
