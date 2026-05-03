// SPDX-License-Identifier: MIT
// C.15 — Dispersión de nube de gas + zona de exclusión dinámica (Pasquill-Gifford).

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { windSpeedKmhToMs } from '../../physics/bernoulliEngine';

export interface GasLeak {
  id: string;
  /** Tasa de fuga (kg/s). */
  releaseRateKgS: number;
  /** Concentración IDLH (mg/m³). NIOSH. */
  idlhMgM3: number;
  /** Densidad relativa del gas. */
  relativeDensity: number;
}

export interface DispersionWeather {
  windKmh: number;
  /** Clase de estabilidad Pasquill-Gifford (A más inestable, F más estable). */
  pasquillStability: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}

export interface DispersionTerrain {
  id: string;
  /** Rugosidad (m). Urbano ≈ 1.0; campo ≈ 0.05. */
  roughnessM: number;
}

/** Coeficientes simplificados Pasquill-Gifford para σy a 1 km, planicie. */
const SIGMA_Y_COEFF: Record<DispersionWeather['pasquillStability'], number> = {
  A: 213, B: 156, C: 104, D: 68, E: 50.5, F: 34,
};

/**
 * Genera nodo `gas-dispersion` modelando una pluma Gaussiana simplificada.
 * Calcula radio de exclusión donde C ≥ IDLH. Ref.: DS 144/1961, MINSAL ATSDR.
 */
export function generateGasDispersionNode(
  leak: GasLeak,
  weather: DispersionWeather,
  terrain: DispersionTerrain,
): RiskNodePayload | null {
  if (leak.releaseRateKgS <= 0 || leak.idlhMgM3 <= 0) return null;
  if (weather.windKmh <= 0) return null;

  const vMs = windSpeedKmhToMs(weather.windKmh);
  const sigmaYCoeff = SIGMA_Y_COEFF[weather.pasquillStability];
  const roughnessFactor = Math.max(1, Math.log10(terrain.roughnessM * 100 + 1));

  // Radio de exclusión: distancia hasta donde C ≈ IDLH (mg/m³).
  // Aproximación: r = √(Q·1e6 / (π·v·IDLH·σy/100·roughness)).
  const idlhKgM3 = leak.idlhMgM3 / 1e6;
  const denom = Math.PI * vMs * idlhKgM3 * (sigmaYCoeff / 100) * roughnessFactor;
  if (denom <= 0) return null;
  const exclusionRadiusM = Math.sqrt(leak.releaseRateKgS / denom);

  if (!Number.isFinite(exclusionRadiusM) || exclusionRadiusM < 5) return null;

  const severity: RiskNodeSeverity = exclusionRadiusM > 200
    ? 'critical'
    : exclusionRadiusM > 50 ? 'high' : 'medium';

  return {
    title: 'Zona de exclusión dinámica por dispersión de gas tóxico',
    description: [
      `Fuga ${leak.id}: ${leak.releaseRateKgS.toFixed(3)} kg/s, ρ_rel=${leak.relativeDensity}.`,
      `Viento ${weather.windKmh} km/h, estabilidad Pasquill ${weather.pasquillStability}, terreno ${terrain.id} (z₀=${terrain.roughnessM} m).`,
      `Radio de exclusión IDLH: ${exclusionRadiusM.toFixed(0)} m.`,
      'Ref.: DS 144/1961, MINSAL ATSDR.',
    ].join('\n'),
    type: 'gas-dispersion',
    severity,
    metadata: {
      windMs: vMs,
      sigmaYCoeff,
      exclusionRadiusM,
      idlhMgM3: leak.idlhMgM3,
    },
    connections: [leak.id, terrain.id],
    references: ['DS 144/1961', 'MINSAL ATSDR'],
  };
}
