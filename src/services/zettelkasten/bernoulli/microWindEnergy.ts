// SPDX-License-Identifier: MIT
// C.11 — Micro-generación eólica para sensores autónomos (Betz 0.593).

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { windSpeedKmhToMs } from '../../physics/bernoulliEngine';

const AIR_DENSITY_KG_M3 = 1.225;
/** Límite de Betz (NIST): potencia teórica máxima extraíble del viento. */
const BETZ_LIMIT = 0.593;

export interface MicroWindGeography {
  id: string;
  /** Factor de embudo topográfico (1.0 = plano; 1.6 = paso de montaña). */
  funnelFactor: number;
  /** Área barrido del rotor (m²). */
  rotorAreaM2: number;
}

export interface MicroWindWeather {
  windKmh: number;
}

/** Presupuesto de potencia mínimo para un sensor BLE Man Down (W). */
const MIN_SENSOR_POWER_W = 0.05;

/**
 * Genera nodo `micro-wind-energy` cuando un punto topográfico TIENE potencial
 * suficiente (> presupuesto sensor). `P = ½ρv³A·Cp_betz·funnel`. Ref.: NCh
 * Elec.4/2003, IEC 61400-2.
 */
export function generateMicroWindNode(
  geography: MicroWindGeography,
  weather: MicroWindWeather,
): RiskNodePayload | null {
  if (geography.rotorAreaM2 <= 0 || geography.funnelFactor <= 0) return null;
  if (weather.windKmh <= 0) return null;

  const vMs = windSpeedKmhToMs(weather.windKmh) * geography.funnelFactor;
  const powerW = 0.5 * AIR_DENSITY_KG_M3 * vMs * vMs * vMs * geography.rotorAreaM2 * BETZ_LIMIT;

  if (powerW < MIN_SENSOR_POWER_W) return null;

  const severity: RiskNodeSeverity = 'info';

  return {
    title: 'Sitio con potencial micro-eólico para sensor autónomo',
    description: [
      `Geografía ${geography.id}: factor embudo ${geography.funnelFactor}, A=${geography.rotorAreaM2} m².`,
      `v_efectivo=${vMs.toFixed(1)} m/s, P_disponible=${(powerW * 1000).toFixed(1)} mW (Betz=${BETZ_LIMIT}).`,
      `Cubre presupuesto sensor BLE Man Down (≥ ${(MIN_SENSOR_POWER_W * 1000).toFixed(0)} mW).`,
      'Ref.: NCh Elec.4/2003, IEC 61400-2.',
    ].join('\n'),
    type: 'micro-wind-energy',
    severity,
    metadata: {
      effectiveVMs: vMs,
      powerW,
      betzLimit: BETZ_LIMIT,
    },
    connections: [geography.id],
    references: ['NCh Elec.4/2003', 'IEC 61400-2'],
  };
}
