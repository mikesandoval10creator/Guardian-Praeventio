// SPDX-License-Identifier: MIT
// B.8 — Cargas de viento en estructuras (wrap NCh 432).

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { windLoadOnSurface, windSpeedKmhToMs } from '../../physics/bernoulliEngine';

const AIR_DENSITY_KG_M3 = 1.225;

export interface Structure {
  id: string;
  areaM2: number;
  /** Cp típico fachada barlovento NCh 432 = 0.8. */
  pressureCoefficient: number;
}

export interface StructWeather {
  windKmh: number;
}

export interface NChLimit {
  /** Fuerza máxima admisible declarada (N). */
  maxForceN: number;
}

/**
 * Genera nodo cuando `F = Cp·½ρv²·A` supera el límite NCh 432 declarado.
 */
export function generateStructuralWindNode(
  structure: Structure,
  weather: StructWeather,
  nchLimit: NChLimit,
): RiskNodePayload | null {
  if (structure.areaM2 <= 0 || nchLimit.maxForceN <= 0) return null;
  if (weather.windKmh <= 0) return null;

  const vMs = windSpeedKmhToMs(weather.windKmh);
  const forceN = windLoadOnSurface(
    structure.areaM2,
    vMs,
    structure.pressureCoefficient,
    AIR_DENSITY_KG_M3,
  );
  if (forceN <= nchLimit.maxForceN) return null;

  const ratio = forceN / nchLimit.maxForceN;
  const severity: RiskNodeSeverity = ratio > 1.5 ? 'critical' : 'high';

  return {
    title: 'Carga de viento NCh 432 superada en estructura',
    description: [
      `Estructura ${structure.id}: F=${(forceN / 1000).toFixed(2)} kN vs límite ${(nchLimit.maxForceN / 1000).toFixed(2)} kN (×${ratio.toFixed(2)}).`,
      `v=${weather.windKmh} km/h, A=${structure.areaM2} m², Cp=${structure.pressureCoefficient}.`,
      'Ref.: NCh 432 Of.71.',
    ].join('\n'),
    type: 'structural-wind',
    severity,
    metadata: { forceN, ratio, vMs },
    connections: [structure.id],
    references: ['NCh 432 Of.71'],
  };
}
