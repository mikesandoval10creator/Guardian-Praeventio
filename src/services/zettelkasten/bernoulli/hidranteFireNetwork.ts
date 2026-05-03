// SPDX-License-Identifier: MIT
// A.1 — Hidrante / red de incendio. Pure Bernoulli-based node generator.

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { dynamicPressure, windSpeedKmhToMs } from '../../physics/bernoulliEngine';

// Constants per NCh 1646 Of.98 (hidrantes) y NFPA 14 (standpipe).
const WATER_DENSITY_KG_M3 = 1000; // NIST water at 20°C
const G_M_S2 = 9.80665; // NIST standard gravity
/** Caudal mínimo aceptable para combatir un fuego en altura: 380 L/min ≈ 6.33e-3 m³/s. */
const MIN_FLOW_M3_S = 380 / 60000;

export interface HidranteNetwork {
  id: string;
  /** Presión estática en la red de hidrantes (Pa). */
  networkPressurePa: number;
  /** Diámetro de la boquilla (m). */
  nozzleDiameterM: number;
  /** Coeficiente de descarga típico boquilla 0.95 (NFPA 14). */
  dischargeCoefficient: number;
}

export interface HidranteTarget {
  id: string;
  /** Altura objetivo del chorro (m). */
  reachHeightM: number;
  /** Ángulo del chorro respecto a la horizontal (rad). */
  jetAngleRad: number;
}

export interface AtmosphericContext {
  /** Presión atmosférica local (Pa). NIST sea-level = 101 325 Pa. */
  ambientPressurePa: number;
}

/**
 * Genera un nodo Zettelkasten cuando la presión dinámica en la boquilla del
 * hidrante NO alcanza la velocidad crítica para extinguir un fuego en altura.
 * Aplica `v = √(2ΔP/ρ)` (Torricelli, derivado de Bernoulli) y verifica el
 * alcance vertical `h = v²·sin²(θ)/(2g)`. Ref.: NCh 1646 Of.98, NFPA 14, DS 594 Art. 41.
 */
export function generateHidrantePressureNode(
  network: HidranteNetwork,
  target: HidranteTarget,
  atmospheric: AtmosphericContext,
): RiskNodePayload | null {
  if (network.nozzleDiameterM <= 0 || network.dischargeCoefficient <= 0) return null;
  if (target.reachHeightM <= 0) return null;

  const deltaP = network.networkPressurePa - atmospheric.ambientPressurePa;
  if (deltaP <= 0) return null;

  const vMs = Math.sqrt((2 * deltaP) / WATER_DENSITY_KG_M3);
  const areaM2 = Math.PI * Math.pow(network.nozzleDiameterM / 2, 2);
  const flowM3S = network.dischargeCoefficient * areaM2 * vMs;
  const sinTheta = Math.sin(target.jetAngleRad);
  const reachM = (vMs * vMs * sinTheta * sinTheta) / (2 * G_M_S2);

  const reaches = reachM >= target.reachHeightM;
  const meetsFlow = flowM3S >= MIN_FLOW_M3_S;
  if (reaches && meetsFlow) return null;

  const severity: RiskNodeSeverity = !meetsFlow ? 'critical' : 'high';

  return {
    title: 'Presión insuficiente en hidrante para alcance vertical objetivo',
    description: [
      `Red ${network.id} → objetivo ${target.id}.`,
      `ΔP boquilla: ${(deltaP / 1000).toFixed(1)} kPa, v=${vMs.toFixed(1)} m/s.`,
      `Caudal estimado: ${(flowM3S * 60000).toFixed(0)} L/min (mín NCh 1646: ${(MIN_FLOW_M3_S * 60000).toFixed(0)} L/min).`,
      `Alcance calculado: ${reachM.toFixed(1)} m vs objetivo ${target.reachHeightM.toFixed(1)} m.`,
      'Ref.: NCh 1646 Of.98 / NFPA 14 / DS 594 Art. 41.',
    ].join('\n'),
    type: 'hidrante-pressure',
    severity,
    metadata: {
      deltaPPa: deltaP,
      jetVelocityMs: vMs,
      flowM3S,
      reachM,
      reachesTarget: reaches,
      meetsFlow,
    },
    connections: [network.id, target.id],
    references: ['NCh 1646 Of.98', 'NFPA 14', 'DS 594 Art. 41'],
  };
}

// Re-export of helper (used in tests for windspeed sanity checks at fire scenes).
export const _kmhToMs = windSpeedKmhToMs;
// Re-export to keep dynamicPressure tree-shake-friendly for downstream consumers.
export const _dynPressure = dynamicPressure;
