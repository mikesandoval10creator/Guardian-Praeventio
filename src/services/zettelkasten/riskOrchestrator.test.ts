import { describe, it, expect } from 'vitest';
import { suggestEdgesForRisk } from './riskOrchestrator.js';

describe('suggestEdgesForRisk', () => {
  it('matches trabajo en altura → arnés + casco + capacitación altura', () => {
    const sugs = suggestEdgesForRisk({
      riskNodeId: 'risk-1',
      riskType: 'trabajo en altura sobre 1.8m',
    });

    const eppLabels = sugs.filter((s) => s.toNodeRef.kind === 'EPP').map((s) => s.toNodeRef.label);
    expect(eppLabels).toContain('Arnés seguridad');
    expect(eppLabels).toContain('Casco');

    const trainings = sugs.filter((s) => s.toNodeRef.kind === 'TRAINING').map((s) => s.toNodeRef.label);
    expect(trainings).toContain('trabajo_altura_r1');
    expect(trainings).toContain('rescate_altura_basico');

    // Todas las sugerencias tienen rationale con cita normativa
    for (const s of sugs) {
      expect(s.rationale).toMatch(/DS 594|altura/i);
    }
  });

  it('matches espacios confinados → respirador + rescate confinados', () => {
    const sugs = suggestEdgesForRisk({
      riskNodeId: 'risk-2',
      riskType: 'trabajo en espacio confinado',
    });
    const trainings = sugs.filter((s) => s.toNodeRef.kind === 'TRAINING').map((s) => s.toNodeRef.label);
    expect(trainings).toContain('espacios_confinados');
    expect(trainings).toContain('rescate_confinados');
  });

  it('matches eléctrico → LOTO + EPP dieléctrico', () => {
    const sugs = suggestEdgesForRisk({
      riskNodeId: 'risk-3',
      riskType: 'mantenimiento eléctrico baja tensión',
    });
    const epp = sugs.filter((s) => s.toNodeRef.kind === 'EPP').map((s) => s.toNodeRef.label);
    expect(epp).toContain('Casco dieléctrico');
    expect(epp).toContain('Guantes aislantes');
    const trainings = sugs.filter((s) => s.toNodeRef.kind === 'TRAINING').map((s) => s.toNodeRef.label);
    expect(trainings).toContain('loto_bloqueo');
  });

  it('matches sílice → respirador + vigilancia', () => {
    const sugs = suggestEdgesForRisk({
      riskNodeId: 'risk-4',
      riskType: 'exposición a polvo respirable con sílice',
    });
    const trainings = sugs.filter((s) => s.toNodeRef.kind === 'TRAINING').map((s) => s.toNodeRef.label);
    expect(trainings).toContain('exposicion_silice');
  });

  it('falls back to industry EPP when no rule matches', () => {
    const sugs = suggestEdgesForRisk({
      riskNodeId: 'risk-5',
      riskType: 'condición ambiental genérica no clasificada',
      industryPrefix: 'GP-MIN',
    });
    const epp = sugs.filter((s) => s.toNodeRef.kind === 'EPP').map((s) => s.toNodeRef.label);
    // EPP_BY_SECTOR['GP-MIN'] contiene Casco minero, Guantes, etc.
    expect(epp).toContain('Casco minero');
    expect(epp).toContain('Respirador gases');

    // Sin match, no hay trainings sugeridos (solo regla específica los aporta)
    const trainings = sugs.filter((s) => s.toNodeRef.kind === 'TRAINING');
    expect(trainings).toHaveLength(0);
  });

  it('falls back to EPP_DEFAULT when industryPrefix missing AND no match', () => {
    const sugs = suggestEdgesForRisk({
      riskNodeId: 'risk-6',
      riskType: 'riesgo no clasificado',
    });
    const epp = sugs.filter((s) => s.toNodeRef.kind === 'EPP').map((s) => s.toNodeRef.label);
    // EPP_DEFAULT = ['Casco', 'Guantes', 'Lentes', 'Botas']
    expect(epp).toContain('Casco');
    expect(epp).toContain('Guantes');
  });

  it('suggests WORKER training-gap edges para workers sin training', () => {
    const sugs = suggestEdgesForRisk({
      riskNodeId: 'risk-7',
      riskType: 'trabajo en altura nivel 4',
      assignedWorkers: [
        { uid: 'worker-1', activeTrainings: ['trabajo_altura_r1'] }, // tiene altura
        { uid: 'worker-2', activeTrainings: [] }, // no tiene nada
      ],
    });

    const workerGaps = sugs.filter(
      (s) => s.type === 'assigned_to' && s.toNodeRef.kind === 'TRAINING',
    );
    // worker-1: falta solo 'rescate_altura_basico'
    // worker-2: faltan ambos trainings → 2 edges
    const w1Gaps = workerGaps.filter((s) => s.fromNodeId === 'worker-1');
    const w2Gaps = workerGaps.filter((s) => s.fromNodeId === 'worker-2');
    expect(w1Gaps).toHaveLength(1);
    expect(w1Gaps[0].toNodeRef.label).toBe('rescate_altura_basico');
    expect(w2Gaps).toHaveLength(2);
  });

  it('all edges have type=requires for EPP/TRAINING (vs assigned_to para workers)', () => {
    const sugs = suggestEdgesForRisk({
      riskNodeId: 'risk-8',
      riskType: 'trabajo en altura',
      assignedWorkers: [{ uid: 'w-no-training', activeTrainings: [] }],
    });
    const eppEdges = sugs.filter((s) => s.toNodeRef.kind === 'EPP');
    const trainingEdges = sugs.filter((s) => s.toNodeRef.kind === 'TRAINING' && s.fromNodeId === 'risk-8');
    const workerGapEdges = sugs.filter((s) => s.fromNodeId === 'w-no-training');
    for (const e of eppEdges) expect(e.type).toBe('requires');
    for (const e of trainingEdges) expect(e.type).toBe('requires');
    for (const e of workerGapEdges) expect(e.type).toBe('assigned_to');
  });
});
