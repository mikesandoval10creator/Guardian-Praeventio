// SPDX-License-Identifier: MIT
// A.5 — Detección de fugas en redes de gas industrial vía desviación Bernoulli.

import type { RiskNodePayload, RiskNodeSeverity } from '../types';

const G_M_S2 = 9.80665; // NIST standard gravity

export interface PipeNetworkPoint {
  id: string;
  /** Presión absoluta en el punto (Pa). */
  pressurePa: number;
  /** Velocidad del fluido (m/s). */
  velocityMs: number;
  /** Cota geométrica (m). */
  heightM: number;
}

export interface GasType {
  id: string;
  /** Densidad del gas (kg/m³). GLP ≈ 2.0; CH₄ ≈ 0.717; H₂ ≈ 0.0899. */
  densityKgM3: number;
  /** Pérdida por fricción esperada Darcy-Weisbach (J/kg) entre A y B. */
  expectedFrictionLossJKg: number;
  /** Límite explosivo inferior (% vol). GLP ≈ 1.8 %. */
  lelVolPercent: number;
}

/**
 * Tolerancia: 15 % de exceso sobre la pérdida esperada Darcy-Weisbach
 * dispara alerta pre-LEL (ANSI/API 1109).
 */
const ANOMALY_TOLERANCE = 0.15;

/**
 * Genera un nodo Zettelkasten cuando la energía Bernoulli entre dos puntos
 * de la red excede la pérdida esperada por fricción, indicando fuga.
 * `E = P/ρ + ½v² + gh`; `ΔE_anom = ΔE_observado − ΔE_friccion`.
 * Ref.: DS 66/2007, NCh Elec.4/2003, ANSI/API 1109.
 */
export function generateGasLeakNode(
  networkPointA: PipeNetworkPoint,
  networkPointB: PipeNetworkPoint,
  gasType: GasType,
): RiskNodePayload | null {
  if (gasType.densityKgM3 <= 0) return null;

  const eA = networkPointA.pressurePa / gasType.densityKgM3
    + 0.5 * networkPointA.velocityMs * networkPointA.velocityMs
    + G_M_S2 * networkPointA.heightM;
  const eB = networkPointB.pressurePa / gasType.densityKgM3
    + 0.5 * networkPointB.velocityMs * networkPointB.velocityMs
    + G_M_S2 * networkPointB.heightM;
  const deltaEObserved = eA - eB;
  const anomalyJKg = deltaEObserved - gasType.expectedFrictionLossJKg;
  const anomalyRatio = gasType.expectedFrictionLossJKg > 0
    ? anomalyJKg / gasType.expectedFrictionLossJKg
    : (anomalyJKg > 0 ? Number.POSITIVE_INFINITY : 0);

  if (anomalyRatio <= ANOMALY_TOLERANCE) return null;

  const severity: RiskNodeSeverity = anomalyRatio > 0.5 ? 'critical' : 'high';

  return {
    title: 'Anomalía de presión en red de gas — posible fuga pre-LEL',
    description: [
      `Tramo ${networkPointA.id} → ${networkPointB.id} (${gasType.id}).`,
      `ΔE observada: ${deltaEObserved.toFixed(1)} J/kg vs fricción esperada ${gasType.expectedFrictionLossJKg.toFixed(1)} J/kg.`,
      `Exceso: ${(anomalyRatio * 100).toFixed(0)}% — activar appMode='emergency' antes de alcanzar LEL ${gasType.lelVolPercent}% vol.`,
      'Ref.: DS 66/2007, NCh Elec.4/2003, ANSI/API 1109.',
    ].join('\n'),
    type: 'gas-leak-anomaly',
    severity,
    metadata: {
      eAJKg: eA,
      eBJKg: eB,
      deltaEObservedJKg: deltaEObserved,
      anomalyJKg,
      anomalyRatio,
      lelVolPercent: gasType.lelVolPercent,
    },
    connections: [networkPointA.id, networkPointB.id, gasType.id],
    references: ['DS 66/2007', 'NCh Elec.4/2003', 'ANSI/API 1109'],
  };
}
