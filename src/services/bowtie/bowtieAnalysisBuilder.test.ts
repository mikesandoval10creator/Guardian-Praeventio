import { describe, it, expect } from 'vitest';
import {
  buildBowtie,
  BowtieValidationError,
  listUnprotectedThreats,
  recommendNextBarrierType,
  type Barrier,
  type BuildBowtieInput,
  type Consequence,
  type Threat,
} from './bowtieAnalysisBuilder.js';

const NOW = new Date('2026-05-12T10:00:00Z');

function barrier(over: Partial<Barrier> = {}): Barrier {
  return {
    id: `b-${Math.random().toString(36).slice(2, 8)}`,
    description: 'Procedimiento de trabajo en altura',
    type: 'administrative',
    status: 'in_place',
    effectiveness: 0.7,
    ...over,
  };
}

function baseInput(): BuildBowtieInput {
  const t1: Threat = {
    id: 't1',
    description: 'Andamio mal armado',
    preventiveBarriers: [barrier({ id: 'pb1', type: 'engineering', effectiveness: 0.8 })],
  };
  const t2: Threat = {
    id: 't2',
    description: 'Trabajador sin capacitación',
    preventiveBarriers: [barrier({ id: 'pb2', type: 'administrative', effectiveness: 0.6 })],
  };
  const c1: Consequence = {
    id: 'c1',
    description: 'Lesión grave por caída',
    severity: 'high',
    mitigatingBarriers: [barrier({ id: 'mb1', type: 'ppe', effectiveness: 0.5 })],
  };
  const c2: Consequence = {
    id: 'c2',
    description: 'Muerte por caída',
    severity: 'catastrophic',
    mitigatingBarriers: [barrier({ id: 'mb2', type: 'engineering', effectiveness: 0.9 })],
  };
  return {
    diagramId: 'bt-1',
    tenantId: 'tenant-a',
    hazardousEvent: {
      id: 'he-fall',
      description: 'Caída desde altura',
      category: 'fall_from_height',
    },
    threats: [t1, t2],
    consequences: [c1, c2],
    now: NOW,
  };
}

describe('buildBowtie', () => {
  it('construye diagrama válido con métricas', () => {
    const d = buildBowtie(baseInput());
    expect(d.diagramId).toBe('bt-1');
    expect(d.tenantId).toBe('tenant-a');
    expect(d.metrics.totalBarriers).toBe(4);
    expect(d.metrics.barriersInPlace).toBe(4);
    expect(d.metrics.unprotectedThreatIds).toEqual([]);
    expect(d.metrics.unmitigatedConsequenceIds).toEqual([]);
    expect(d.createdAt).toBe(NOW.toISOString());
  });

  it('detecta amenazas sin barrera in_place', () => {
    const inp = baseInput();
    inp.threats[0].preventiveBarriers[0].status = 'missing';
    const d = buildBowtie(inp);
    expect(d.metrics.unprotectedThreatIds).toEqual(['t1']);
    expect(d.metrics.residualRiskScore).toBe('medium');
  });

  it('eleva a critical cuando consecuencia catastrófica está sin mitigar', () => {
    const inp = baseInput();
    inp.consequences[1].mitigatingBarriers[0].status = 'missing';
    const d = buildBowtie(inp);
    expect(d.metrics.unmitigatedConsequenceIds).toContain('c2');
    expect(d.metrics.residualRiskScore).toBe('critical');
  });

  it('rechaza diagrama sin amenazas', () => {
    expect(() =>
      buildBowtie({ ...baseInput(), threats: [] }),
    ).toThrow(BowtieValidationError);
  });

  it('rechaza ids duplicados entre amenazas y consecuencias', () => {
    const inp = baseInput();
    inp.consequences[0].id = 't1';
    expect(() => buildBowtie(inp)).toThrow(BowtieValidationError);
  });

  it('rechaza efectividad fuera de rango', () => {
    const inp = baseInput();
    inp.threats[0].preventiveBarriers[0].effectiveness = 1.5;
    expect(() => buildBowtie(inp)).toThrow(BowtieValidationError);
  });

  it('listUnprotectedThreats devuelve amenazas correctas', () => {
    const inp = baseInput();
    inp.threats[1].preventiveBarriers[0].status = 'degraded';
    const d = buildBowtie(inp);
    const list = listUnprotectedThreats(d);
    expect(list.map((t) => t.id)).toEqual(['t2']);
  });

  it('recommendNextBarrierType sigue jerarquía de control', () => {
    const t: Threat = {
      id: 'tx',
      description: 'x',
      preventiveBarriers: [barrier({ type: 'ppe' }), barrier({ type: 'administrative' })],
    };
    expect(recommendNextBarrierType(t)).toBe('elimination');
  });

  it('es determinista', () => {
    const a = buildBowtie(baseInput());
    const b = buildBowtie(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
