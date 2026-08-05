// Praeventio Guard — aristas con peso y validez temporal (tarea
// [Mejora-ZK] Aristas con peso + validez temporal = salud de barrera medible).
//
// Hoy ZkEdge es binaria (la relación existe o no). Para que el Asesor
// razone por GRADOS y el modelo de queso suizo (Salud de barrera) mida
// agujeros con tamaño = 1 - weight, las aristas necesitan:
//   - weight ∈ [0, 1] (fuerza/confianza, 0 = no aplica, 1 = pleno)
//   - validFrom / validUntil (alcance temporal)
//   - decayFn (cómo cae el peso con el tiempo: linear, exp, none)
//   - effectiveWeight(edge, now) = peso EFFECTIVO (para el razonamiento)
//
// El id debe CAMBIAR cuando el peso cambia (idempotencia por contenido
// completo, no solo por terna). Eso evita duplicados al actualizar pesos.

import { describe, it, expect } from 'vitest';
import {
  computeEdgeId,
  buildEdge,
  effectiveWeight,
  EDGE_TYPES,
  EdgeValidationError,
  type ZkEdge,
  type EdgeType,
} from './edges.js';

const NOW = new Date('2026-08-04T12:00:00Z').getTime();

const baseInput = {
  fromNodeId: 'control-1',
  toNodeId: 'risk-1',
  type: 'mitigates' as const,
  tenantId: 'tenant-A',
  createdBy: 'system',
};

describe('ZkEdge — peso y validez temporal', () => {
  it('buildEdge acepta weight válido + validFrom/validUntil', () => {
    const edge = buildEdge({
      ...baseInput,
      weight: 0.85,
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z',
      decayFn: 'linear',
    });
    expect(edge.weight).toBe(0.85);
    expect(edge.validFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(edge.validUntil).toBe('2027-01-01T00:00:00.000Z');
    expect(edge.decayFn).toBe('linear');
  });

  it('weight default = 1.0 (verde pleno) cuando no se especifica', () => {
    const edge = buildEdge({ ...baseInput });
    expect(edge.weight).toBe(1);
    expect(edge.decayFn).toBe('none');
  });

  it('buildEdge rechaza weight fuera de [0, 1]', () => {
    expect(() => buildEdge({ ...baseInput, weight: -0.1 })).toThrow(
      EdgeValidationError,
    );
    expect(() => buildEdge({ ...baseInput, weight: 1.1 })).toThrow(
      EdgeValidationError,
    );
  });

  it('buildEdge rechaza validUntil <= validFrom', () => {
    expect(() =>
      buildEdge({
        ...baseInput,
        validFrom: '2027-01-01T00:00:00.000Z',
        validUntil: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(EdgeValidationError);
  });

  it('computeEdgeId cambia con el peso (idempotencia por contenido completo)', () => {
    const idLight = computeEdgeId(
      'control-1',
      'risk-1',
      'mitigates',
      0.5,
      undefined,
      undefined,
    );
    const idHeavy = computeEdgeId(
      'control-1',
      'risk-1',
      'mitigates',
      0.85,
      undefined,
      undefined,
    );
    expect(idLight).not.toBe(idHeavy);
  });

  it('computeEdgeId cambia con validFrom (mismo peso)', () => {
    const a = computeEdgeId(
      'control-1',
      'risk-1',
      'mitigates',
      0.85,
      '2026-01-01T00:00:00.000Z',
      undefined,
    );
    const b = computeEdgeId(
      'control-1',
      'risk-1',
      'mitigates',
      0.85,
      '2026-06-01T00:00:00.000Z',
      undefined,
    );
    expect(a).not.toBe(b);
  });

  it('computeEdgeId es determinístico (mismas entradas → mismo id)', () => {
    const a = computeEdgeId(
      'control-1',
      'risk-1',
      'mitigates',
      0.85,
      '2026-01-01T00:00:00.000Z',
      undefined,
    );
    const b = computeEdgeId(
      'control-1',
      'risk-1',
      'mitigates',
      0.85,
      '2026-01-01T00:00:00.000Z',
      undefined,
    );
    expect(a).toBe(b);
  });
});

describe('effectiveWeight', () => {
  it('peso lineal: cae a 0 al expirar validUntil', () => {
    const edge = buildEdge({
      ...baseInput,
      weight: 1,
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-07-01T00:00:00.000Z',
      decayFn: 'linear',
    });
    // 4 meses en 6 meses → queda 2/6 = 0.333
    expect(effectiveWeight(edge, new Date('2026-05-01T00:00:00Z').getTime())).toBeCloseTo(1 / 3, 2);
    // Expirado = 0
    expect(effectiveWeight(edge, new Date('2027-01-01T00:00:00Z').getTime())).toBe(0);
    // Antes de validFrom = 0
    expect(effectiveWeight(edge, new Date('2025-12-01T00:00:00Z').getTime())).toBe(0);
  });

  it('peso exp: decae siguiendo t/half-life configurable', () => {
    const edge = buildEdge({
      ...baseInput,
      weight: 1,
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z',
      decayFn: 'exp',
      decayHalfLifeMs: 1000 * 60 * 60 * 24 * 90, // 90 días
    });
    // 90 días después: weight * 0.5
    const t = new Date('2026-04-01T00:00:00.000Z').getTime();
    expect(effectiveWeight(edge, t)).toBeCloseTo(0.5, 2);
  });

  it('decayFn=none: peso fijo, no decae con el tiempo', () => {
    const edge = buildEdge({
      ...baseInput,
      weight: 0.7,
      decayFn: 'none',
    });
    expect(effectiveWeight(edge, NOW)).toBe(0.7);
  });
});
