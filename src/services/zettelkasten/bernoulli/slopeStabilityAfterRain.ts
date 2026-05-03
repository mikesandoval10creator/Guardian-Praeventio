// SPDX-License-Identifier: MIT
// C.12 — Estabilidad de talud post-lluvia (ángulo de reposo + hidrostática).

import type { RiskNodePayload, RiskNodeSeverity } from '../types';

const G_M_S2 = 9.80665;

export interface SlopeMaterial {
  id: string;
  /** Ángulo de reposo seco (rad). Arena: ~0.61; grava: ~0.64. Eurocódigo 7. */
  dryReposeAngleRad: number;
  /** Reducción del ángulo por saturación (rad). */
  saturationReductionRad: number;
}

export interface SlopeGeometry {
  id: string;
  /** Ángulo del talud (rad). */
  slopeAngleRad: number;
  /** Altura del talud (m). */
  heightM: number;
}

export interface HydrostaticContext {
  /** Profundidad de la napa freática desde la superficie (m). */
  waterTableDepthM: number;
  /** Densidad del agua (kg/m³). */
  waterDensityKgM3: number;
}

/**
 * Genera nodo si el ángulo del talud excede el ángulo de reposo saturado
 * o si la presión hidrostática a profundidad de napa supera 50 kPa
 * (umbral conservador para suelos cohesivos). Ref.: DS 132 Art. 32, Eurocódigo 7.
 */
export function generateSlopeStabilityNode(
  material: SlopeMaterial,
  slope: SlopeGeometry,
  hydrostatic: HydrostaticContext,
): RiskNodePayload | null {
  if (slope.heightM <= 0) return null;
  if (hydrostatic.waterDensityKgM3 <= 0) return null;

  const saturatedReposeRad = material.dryReposeAngleRad - material.saturationReductionRad;
  const slopeOverRepose = slope.slopeAngleRad > saturatedReposeRad;
  const submergedDepth = Math.max(slope.heightM - hydrostatic.waterTableDepthM, 0);
  const hydrostaticPa = hydrostatic.waterDensityKgM3 * G_M_S2 * submergedDepth;
  const hydrostaticHigh = hydrostaticPa > 50000;

  if (!slopeOverRepose && !hydrostaticHigh) return null;

  const severity: RiskNodeSeverity = slopeOverRepose && hydrostaticHigh ? 'critical' : 'high';

  return {
    title: 'Talud inestable post-lluvia: ángulo o presión hidrostática críticos',
    description: [
      `Material ${material.id} en talud ${slope.id} (h=${slope.heightM} m).`,
      `Ángulo talud=${(slope.slopeAngleRad * 180 / Math.PI).toFixed(1)}° vs reposo saturado=${(saturatedReposeRad * 180 / Math.PI).toFixed(1)}°.`,
      `Presión hidrostática (z=${submergedDepth.toFixed(1)} m): ${(hydrostaticPa / 1000).toFixed(1)} kPa.`,
      'Ref.: DS 132 Art. 32, Eurocódigo 7.',
    ].join('\n'),
    type: 'slope-stability',
    severity,
    metadata: {
      saturatedReposeRad,
      slopeOverRepose,
      hydrostaticPa,
      hydrostaticHigh,
      submergedDepthM: submergedDepth,
    },
    connections: [material.id, slope.id],
    references: ['DS 132 Art. 32', 'Eurocódigo 7'],
  };
}
