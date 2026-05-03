// SPDX-License-Identifier: MIT
// A.3 — Estabilidad de cubiertas y andamios: succión por viento.

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { windLoadOnSurface, windSpeedKmhToMs } from '../../physics/bernoulliEngine';

const AIR_DENSITY_KG_M3 = 1.225; // NIST sea-level air, 15°C

export interface ScaffoldSurface {
  id: string;
  /** Área expuesta al viento (m²). */
  areaM2: number;
  /** Coeficiente de presión negativo (succión); típico hasta -1.5 en cubiertas curvas (NCh 432). */
  pressureCoefficient: number;
}

export interface ScaffoldWeather {
  /** Velocidad del viento en km/h. */
  windKmh: number;
}

export interface ScaffoldAnchorage {
  /** Capacidad declarada de los anclajes (N). */
  ratedCapacityN: number;
  /** Cantidad de puntos de anclaje. */
  anchorCount: number;
}

/**
 * Genera un nodo Zettelkasten si la fuerza de succión sobre la lona/malla del
 * andamio supera la capacidad de anclaje declarada. `F = q·A·Cp` con Cp negativo
 * (succión). Ref.: NCh 432 Of.71, DS 594 Art. 78, OSHA 29 CFR 1926.451.
 */
export function generateScaffoldUpliftNode(
  scaffold: ScaffoldSurface,
  weather: ScaffoldWeather,
  anchorage: ScaffoldAnchorage,
): RiskNodePayload | null {
  if (scaffold.areaM2 <= 0) return null;
  if (anchorage.anchorCount <= 0 || anchorage.ratedCapacityN <= 0) return null;
  if (weather.windKmh <= 0) return null;

  const vMs = windSpeedKmhToMs(weather.windKmh);
  // Forzamos Cp negativo (succión) en magnitud absoluta para comparar fuerzas.
  const cpMagnitude = Math.abs(scaffold.pressureCoefficient);
  const upliftN = windLoadOnSurface(scaffold.areaM2, vMs, cpMagnitude, AIR_DENSITY_KG_M3);
  const totalCapacityN = anchorage.ratedCapacityN * anchorage.anchorCount;

  if (upliftN <= totalCapacityN) return null;

  const overloadRatio = upliftN / totalCapacityN;
  const severity: RiskNodeSeverity = overloadRatio > 1.5 ? 'critical' : 'high';

  return {
    title: 'Succión de viento supera capacidad de anclaje del andamio/lona',
    description: [
      `Andamio ${scaffold.id}: F_succión=${(upliftN / 1000).toFixed(2)} kN (Cp=${scaffold.pressureCoefficient}, A=${scaffold.areaM2} m², v=${weather.windKmh} km/h).`,
      `Capacidad anclajes: ${(totalCapacityN / 1000).toFixed(2)} kN (${anchorage.anchorCount}×${(anchorage.ratedCapacityN / 1000).toFixed(2)} kN).`,
      `Sobrecarga: ${(overloadRatio * 100).toFixed(0)}% — bloquear faena en zona.`,
      'Ref.: NCh 432 Of.71, DS 594 Art. 78, OSHA 29 CFR 1926.451.',
    ].join('\n'),
    type: 'scaffold-uplift',
    severity,
    metadata: {
      upliftN,
      totalCapacityN,
      overloadRatio,
      windMs: vMs,
    },
    connections: [scaffold.id],
    references: ['NCh 432 Of.71', 'DS 594 Art. 78', 'OSHA 29 CFR 1926.451'],
  };
}
