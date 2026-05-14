import { describe, it, expect } from 'vitest';
import {
  validateJsa,
  computeResidualRisks,
  classifyResidual,
  overallResidualClass,
  finalize,
  JsaFinalizationError,
  type JsaDraft,
  type JsaHazard,
} from './jobSafetyAnalysis.js';

// ────────────────────────────────────────────────────────────────────────
// Builders
// ────────────────────────────────────────────────────────────────────────

function hazard(over?: Partial<JsaHazard>): JsaHazard {
  return {
    id: 'h-1',
    description: 'Caída desde altura sobre superficie dura',
    probability: 3,
    severity: 4,
    controls: [
      {
        level: 'engineering',
        description: 'Línea de vida horizontal certificada DS 594',
      },
      { level: 'epp', description: 'Arnés cuerpo completo + casco con barbiquejo' },
    ],
    ...over,
  };
}

function step(order: number, over?: Partial<{ description: string; hazards: JsaHazard[] }>) {
  return {
    order,
    description: `Paso ${order}: instalación de soportes en altura del andamio`,
    hazards: [hazard({ id: `h-${order}` })],
    ...over,
  };
}

function draft(over?: Partial<JsaDraft>): JsaDraft {
  return {
    id: 'jsa-1',
    projectId: 'proj-1',
    taskTitle: 'Cambio de tubería en túnel 4 sector NW',
    location: 'Túnel 4 / Cota -120m',
    authorUid: 'prev-1',
    createdAt: '2026-05-14T10:00:00Z',
    steps: [step(1), step(2)],
    ...over,
  };
}

// ────────────────────────────────────────────────────────────────────────
// validateJsa
// ────────────────────────────────────────────────────────────────────────

describe('validateJsa', () => {
  it('caso feliz: valid + completenessPct=100', () => {
    const r = validateJsa(draft());
    expect(r.valid).toBe(true);
    expect(r.completenessPct).toBe(100);
    expect(r.issues.filter((i) => i.severity === 'blocking')).toHaveLength(0);
  });

  it('taskTitle muy corto: blocker', () => {
    const r = validateJsa(draft({ taskTitle: 'X' }));
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'TASK_TITLE_TOO_SHORT')).toBe(true);
  });

  it('sin steps: blocker NO_STEPS', () => {
    const r = validateJsa(draft({ steps: [] }));
    expect(r.issues.some((i) => i.code === 'NO_STEPS')).toBe(true);
  });

  it('step description corta: blocker STEP_DESC_TOO_SHORT', () => {
    const r = validateJsa(
      draft({ steps: [{ order: 1, description: 'corto', hazards: [hazard()] }] }),
    );
    expect(r.issues.some((i) => i.code === 'STEP_DESC_TOO_SHORT')).toBe(true);
  });

  it('step sin hazards: blocker STEP_NO_HAZARDS', () => {
    const r = validateJsa(
      draft({
        steps: [
          { order: 1, description: 'descripción suficientemente larga', hazards: [] },
        ],
      }),
    );
    expect(r.issues.some((i) => i.code === 'STEP_NO_HAZARDS')).toBe(true);
  });

  it('hazard sin controles: blocker HAZARD_NO_CONTROLS', () => {
    const r = validateJsa(
      draft({
        steps: [
          step(1, {
            hazards: [
              {
                id: 'h-1',
                description: 'caída en altura',
                probability: 3,
                severity: 4,
                controls: [],
              },
            ],
          }),
        ],
      }),
    );
    expect(r.issues.some((i) => i.code === 'HAZARD_NO_CONTROLS')).toBe(true);
  });

  it('solo controles admin/EPP: advisory CONTROLS_LOW_HIERARCHY', () => {
    const r = validateJsa(
      draft({
        steps: [
          step(1, {
            hazards: [
              {
                id: 'h-1',
                description: 'caída en altura',
                probability: 3,
                severity: 4,
                controls: [
                  { level: 'administrative', description: 'capacitación previa al inicio' },
                  { level: 'epp', description: 'arnés certificado' },
                ],
              },
            ],
          }),
        ],
      }),
    );
    expect(r.issues.some((i) => i.code === 'CONTROLS_LOW_HIERARCHY')).toBe(true);
    expect(r.issues.some((i) => i.severity === 'blocking')).toBe(false);
  });

  it('orders 1,3,5 (no consecutivos): advisory', () => {
    const r = validateJsa(
      draft({ steps: [step(1), step(3), step(5)] }),
    );
    expect(r.issues.some((i) => i.code === 'NON_CONSECUTIVE_STEPS')).toBe(true);
  });

  it('completenessPct = N hazards completos / total hazards', () => {
    // Step 1: 1 hazard OK
    // Step 2: 1 hazard sin controles (no cuenta como completo)
    const r = validateJsa(
      draft({
        steps: [
          step(1),
          {
            order: 2,
            description: 'paso secundario con descripción suficiente',
            hazards: [
              {
                id: 'h-2',
                description: 'hazard sin control',
                probability: 2,
                severity: 2,
                controls: [],
              },
            ],
          },
        ],
      }),
    );
    expect(r.completenessPct).toBe(50);
  });
});

// ────────────────────────────────────────────────────────────────────────
// classifyResidual
// ────────────────────────────────────────────────────────────────────────

describe('classifyResidual', () => {
  it('1-3: low', () => {
    expect(classifyResidual(1)).toBe('low');
    expect(classifyResidual(3)).toBe('low');
  });
  it('4-8: medium', () => {
    expect(classifyResidual(4)).toBe('medium');
    expect(classifyResidual(8)).toBe('medium');
  });
  it('9-16: high', () => {
    expect(classifyResidual(9)).toBe('high');
    expect(classifyResidual(16)).toBe('high');
  });
  it('17-25: critical', () => {
    expect(classifyResidual(17)).toBe('critical');
    expect(classifyResidual(25)).toBe('critical');
  });
});

// ────────────────────────────────────────────────────────────────────────
// computeResidualRisks
// ────────────────────────────────────────────────────────────────────────

describe('computeResidualRisks', () => {
  it('hazard prob=3 sev=4 + engineering+epp: initial=12, residual=round(12*0.4*0.9)=4', () => {
    const r = computeResidualRisks(draft());
    expect(r[0].initialScore).toBe(12);
    expect(r[0].residualScore).toBe(4); // 12 * 0.36 = 4.32 → 4
    expect(r[0].residualClass).toBe('medium');
  });

  it('elimination: residual = 0 (peligro removido)', () => {
    const r = computeResidualRisks(
      draft({
        steps: [
          step(1, {
            hazards: [
              {
                id: 'h-1',
                description: 'hazard a eliminar mediante diseño',
                probability: 4,
                severity: 5,
                controls: [
                  { level: 'elimination', description: 'rediseño del proceso para eliminar la fuente' },
                ],
              },
            ],
          }),
        ],
      }),
    );
    expect(r[0].residualScore).toBe(0);
    expect(r[0].residualClass).toBe('low');
  });

  it('solo EPP: residual = round(initial * 0.9)', () => {
    const r = computeResidualRisks(
      draft({
        steps: [
          step(1, {
            hazards: [
              {
                id: 'h-1',
                description: 'hazard mitigado solo con EPP',
                probability: 4,
                severity: 4,
                controls: [{ level: 'epp', description: 'casco + guantes' }],
              },
            ],
          }),
        ],
      }),
    );
    // initial=16, residual=round(16*0.9)=14 → high
    expect(r[0].initialScore).toBe(16);
    expect(r[0].residualScore).toBe(14);
    expect(r[0].residualClass).toBe('high');
  });

  it('residual nunca cae a 0 si no hay elimination (clamp [1,25])', () => {
    const r = computeResidualRisks(
      draft({
        steps: [
          step(1, {
            hazards: [
              {
                id: 'h-low',
                description: 'hazard muy bajo con muchos controles',
                probability: 1,
                severity: 1,
                controls: [
                  { level: 'substitution', description: 'sustituir herramienta' },
                  { level: 'engineering', description: 'guardas físicas' },
                  { level: 'administrative', description: 'capacitación' },
                  { level: 'epp', description: 'guantes' },
                ],
              },
            ],
          }),
        ],
      }),
    );
    // 1 × 0.2 × 0.4 × 0.7 × 0.9 = 0.0504 → round=0 → clamp a 1
    expect(r[0].residualScore).toBe(1);
  });

  it('controlsApplied es Set (no duplicados por mismo nivel)', () => {
    const r = computeResidualRisks(
      draft({
        steps: [
          step(1, {
            hazards: [
              {
                id: 'h-1',
                description: 'doble control EPP',
                probability: 3,
                severity: 3,
                controls: [
                  { level: 'epp', description: 'casco' },
                  { level: 'epp', description: 'guantes' },
                  { level: 'epp', description: 'lentes' },
                ],
              },
            ],
          }),
        ],
      }),
    );
    expect(r[0].controlsApplied).toEqual(['epp']);
    // initial=9, multipliers=0.9 → residual=round(8.1)=8
    expect(r[0].residualScore).toBe(8);
  });
});

// ────────────────────────────────────────────────────────────────────────
// overallResidualClass
// ────────────────────────────────────────────────────────────────────────

describe('overallResidualClass', () => {
  it('vacío: low', () => {
    expect(overallResidualClass([])).toBe('low');
  });

  it('el peor define el overall', () => {
    const risks = [
      { stepOrder: 1, hazardId: 'a', initialScore: 4, residualScore: 4, controlsApplied: [], residualClass: 'medium' as const },
      { stepOrder: 2, hazardId: 'b', initialScore: 20, residualScore: 18, controlsApplied: [], residualClass: 'critical' as const },
      { stepOrder: 3, hazardId: 'c', initialScore: 2, residualScore: 2, controlsApplied: [], residualClass: 'low' as const },
    ];
    expect(overallResidualClass(risks)).toBe('critical');
  });
});

// ────────────────────────────────────────────────────────────────────────
// finalize
// ────────────────────────────────────────────────────────────────────────

describe('finalize', () => {
  it('caso feliz: produce FinalizedJsa con status=signed + risks', () => {
    const f = finalize({
      draft: draft(),
      approverUid: 'sup-1',
      signedAtIso: '2026-05-14T11:00:00Z',
      signatureHashHex: 'deadbeef',
    });
    expect(f.status).toBe('signed');
    expect(f.approverUid).toBe('sup-1');
    expect(f.residualRisks.length).toBeGreaterThan(0);
    expect(f.overallResidualClass).toMatch(/low|medium|high|critical/);
  });

  it('approver = author: throw APPROVER_SAME_AS_AUTHOR', () => {
    expect(() =>
      finalize({
        draft: draft({ authorUid: 'sup-1' }),
        approverUid: 'sup-1',
        signedAtIso: '2026-05-14T11:00:00Z',
        signatureHashHex: 'aa',
      }),
    ).toThrow(JsaFinalizationError);
  });

  it('JSA con blocker: throw VALIDATION_FAILED', () => {
    expect(() =>
      finalize({
        draft: draft({ taskTitle: 'X' }), // blocker
        approverUid: 'sup-1',
        signedAtIso: '2026-05-14T11:00:00Z',
        signatureHashHex: 'aa',
      }),
    ).toThrow(JsaFinalizationError);
  });
});
