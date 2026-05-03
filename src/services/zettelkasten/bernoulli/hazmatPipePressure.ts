// SPDX-License-Identifier: MIT
// B.7 — Presión en tuberías hazmat + cavitación check.

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { staticPressureDelta } from '../../physics/bernoulliEngine';

const G_M_S2 = 9.80665;

export interface HazmatPipeSegment {
  id: string;
  /** Velocidad upstream (m/s). */
  velocityInMs: number;
  /** Velocidad downstream / garganta (m/s). */
  velocityOutMs: number;
  /** Diferencia cota (m). */
  heightDeltaM: number;
}

export interface HazmatFluid {
  id: string;
  /** Densidad (kg/m³). */
  densityKgM3: number;
  /** Presión de vapor a temperatura de operación (Pa). NIST. */
  vaporPressurePa: number;
}

export interface PumpHead {
  /** Presión a la salida de la bomba (Pa). */
  upstreamPressurePa: number;
}

/**
 * Calcula presión downstream con `P₂ = P₁ + ½ρ(v₁²−v₂²) − ρg·Δh` y verifica
 * cavitación (P₂ ≤ vapor pressure). Ref.: DS 43/2015, NFPA 30.
 */
export function generateHazmatPipeNode(
  pipe: HazmatPipeSegment,
  fluid: HazmatFluid,
  pumpHead: PumpHead,
): RiskNodePayload | null {
  if (fluid.densityKgM3 <= 0) return null;

  const dynamicTerm = staticPressureDelta(fluid.densityKgM3, pipe.velocityOutMs, pipe.velocityInMs);
  const hydrostatic = fluid.densityKgM3 * G_M_S2 * pipe.heightDeltaM;
  const downstreamPa = pumpHead.upstreamPressurePa + dynamicTerm - hydrostatic;
  const cavitates = downstreamPa <= fluid.vaporPressurePa;

  if (!cavitates && downstreamPa > 0) return null;

  const severity: RiskNodeSeverity = cavitates ? 'critical' : 'high';

  return {
    title: 'Riesgo de cavitación o presión negativa en tubería hazmat',
    description: [
      `Tramo ${pipe.id} (${fluid.id}).`,
      `P_downstream=${(downstreamPa / 1000).toFixed(1)} kPa vs P_vapor=${(fluid.vaporPressurePa / 1000).toFixed(1)} kPa.`,
      cavitates ? 'CAVITACIÓN: detener bomba y revisar NPSH.' : 'Presión negativa: ingreso de aire posible.',
      'Ref.: DS 43/2015, NFPA 30.',
    ].join('\n'),
    type: 'hazmat-pipe',
    severity,
    metadata: {
      downstreamPa,
      dynamicTermPa: dynamicTerm,
      hydrostaticPa: hydrostatic,
      cavitates,
    },
    connections: [pipe.id, fluid.id],
    references: ['DS 43/2015', 'NFPA 30'],
  };
}
